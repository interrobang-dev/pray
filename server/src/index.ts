import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import type { Response } from 'express'
import type { HostMessage } from '@jk-corp/host/protocol'
import {
  addRoom,
  addTeam,
  addTeamMember,
  listTeams,
  readOffice,
  removeTeam,
  removeTeamMember,
  setSeat,
  updateRoom,
  type Room,
  type Seat,
  type Team,
} from '@jk-corp/host/hq'
import { setupFileLog } from '@jk-corp/host/runtime'
import { configDir, readConfig } from './config.js'
import { AuthStore, TOKEN_TTL_SECONDS, isLoopback, parseCookie } from './auth.js'
import { makeSendCode } from './mail.js'
import { applyHook, type HookPayload, type HookState } from './hookState.js'
import { findTranscript, listSessions, projectsDir } from './sessions.js'
import { HostClient } from './hostClient.js'
import { parseMessages } from './messages.js'
import { TranscriptWatcher } from './transcriptWatcher.js'
import { makeUsageCache } from './usage.js'
import { TaskConflictError, TaskStore } from './teamState.js'
import { leadExtraArgs } from './lead.js'

setupFileLog()
const PORT = 4710
const hookStates = new Map<string, HookState>()
const subscribers = new Set<Response>()
const host = new HostClient()
const tasks = new TaskStore()

const config = readConfig()
const auth = new AuthStore(config.loginEmails, join(configDir, 'auth-tokens.json'))
const sendCode = makeSendCode(config.smtp)
const COOKIE = 'jk_session'

const app = express()
app.use(express.json({ limit: '1mb' }))

// 로컬(127.0.0.1)은 무인증. 그 외는 로그인 쿠키 필요. 훅·인증 API 는 예외
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/hook') return next()
  if (isLoopback(req.socket.remoteAddress)) return next()
  if (auth.emailOf(parseCookie(req.headers.cookie, COOKIE))) return next()
  res.status(401).json({ message: '로그인 필요' })
})

app.get('/api/auth/me', (req, res) => {
  const isLocal = isLoopback(req.socket.remoteAddress)
  const email = auth.emailOf(parseCookie(req.headers.cookie, COOKIE))
  res.json({ isAuthenticated: isLocal || email !== null, isLocal, email, canLogin: sendCode !== null })
})

app.post('/api/auth/request', async (req, res) => {
  const { email } = req.body as { email?: string }
  if (typeof email !== 'string' || !sendCode) {
    res.status(400).json({ message: '메일 로그인이 설정되지 않음' })
    return
  }
  const { result, code } = auth.requestCode(email)
  if (result === 'too-soon') {
    res.status(429).json({ message: '잠시 후 다시 요청하세요' })
    return
  }
  // 허용되지 않은 주소에도 같은 응답 (주소 유출 방지)
  if (result === 'sent' && code) {
    try {
      await sendCode(email, code)
    } catch (error) {
      console.error('인증 메일 발송 실패', error)
      res.status(502).json({ message: '메일 발송 실패' })
      return
    }
  }
  res.json({})
})

app.post('/api/auth/verify', (req, res) => {
  const { email, code } = req.body as { email?: string; code?: string }
  if (typeof email !== 'string' || typeof code !== 'string') {
    res.status(400).end()
    return
  }
  const verified = auth.verifyCode(email, code)
  if (!verified.ok) {
    res.status(401).json({ message: verified.reason })
    return
  }
  res.setHeader('Set-Cookie', `${COOKIE}=${verified.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_TTL_SECONDS}`)
  res.json({})
})

app.post('/api/auth/logout', (req, res) => {
  auth.revoke(parseCookie(req.headers.cookie, COOKIE))
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.json({})
})

function openSse(res: Response): void {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()
}

function sendSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function snapshotPayload() {
  const webSessions = new Map(host.sessions.map((s) => [s.sessionId, s.cwd]))
  return {
    isHostReachable: host.isReachable,
    sessions: await listSessions(hookStates, webSessions, listTeams()),
  }
}

async function broadcast() {
  if (subscribers.size === 0) return
  const payload = await snapshotPayload()
  for (const res of subscribers) sendSse(res, 'sessions', payload)
}

app.get('/api/sessions', async (_req, res) => {
  res.json(await snapshotPayload())
})

/** teamName 이 있으면 팀장 세션: 팀을 만들고 팀장 지침·권한 인자를 붙여 띄운다 */
app.post('/api/sessions', (req, res) => {
  const { cwd, prompt, teamName } = req.body as { cwd?: string; prompt?: string; teamName?: string }
  if (!cwd) {
    res.status(400).json({ message: 'cwd 필요' })
    return
  }
  if (!host.isReachable) {
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  const sessionId = randomUUID()
  let extraArgs: string[] | undefined
  if (teamName?.trim()) {
    const team: Team = {
      id: randomUUID().slice(0, 8),
      name: teamName.trim(),
      cwd,
      leadSessionId: sessionId,
      createdAt: new Date().toISOString(),
      members: [],
    }
    addTeam(team)
    extraArgs = leadExtraArgs(team)
  }
  host.send({ type: 'spawn', sessionId, cwd, prompt: prompt || undefined, extraArgs })
  res.json({ sessionId })
})

app.get('/api/sessions/:id/messages', async (req, res) => {
  const jsonl = await findTranscript(req.params.id)
  res.json(jsonl ? parseMessages(jsonl) : [])
})

app.delete('/api/sessions/:id', (req, res) => {
  host.send({ type: 'kill', sessionId: req.params.id })
  res.json({})
})

app.post('/api/sessions/:id/input', (req, res) => {
  const { data } = req.body as { data?: string }
  if (typeof data !== 'string') {
    res.status(400).end()
    return
  }
  host.send({ type: 'input', sessionId: req.params.id, data })
  res.json({})
})

app.post('/api/sessions/:id/resize', (req, res) => {
  const { cols, rows } = req.body as { cols?: number; rows?: number }
  if (typeof cols !== 'number' || typeof rows !== 'number') {
    res.status(400).end()
    return
  }
  host.send({ type: 'resize', sessionId: req.params.id, cols, rows })
  res.json({})
})

app.get('/api/sessions/:id/stream', (req, res) => {
  const sessionId = req.params.id
  openSse(res)
  const onMessage = (message: HostMessage) => {
    if (!('sessionId' in message) || message.sessionId !== sessionId) return
    if (message.type === 'snapshot' || message.type === 'output') sendSse(res, message.type, message.data)
    if (message.type === 'exit') sendSse(res, 'exit', message.exitCode)
    if (message.type === 'error') sendSse(res, 'error', message.message)
  }
  host.on('message', onMessage)
  req.on('close', () => host.off('message', onMessage))
  if (!host.send({ type: 'attach', sessionId })) sendSse(res, 'error', '세션 호스트에 연결되지 않음')
})

function broadcastOffice(): void {
  const office = readOffice()
  for (const res of subscribers) sendSse(res, 'office', office)
}

const readUsage = makeUsageCache(60_000)

// 계정 사용량 (5시간·주간 한도). 비공식 OAuth 엔드포인트, 60초 캐시
app.get('/api/usage', async (_req, res) => {
  res.json(await readUsage())
})

// ---------- 팀 (팀장 세션이 MCP 도구로 호출) ----------

const MAX_WAIT_SECONDS = 600
const MEMBER_FIRST_INPUT_DELAY_MS = 4_000

function findTeam(teamId: string): Team | undefined {
  return listTeams().find((t) => t.id === teamId)
}

/** task 를 만들고 팀원 터미널에 지시문을 입력한다 */
function assignTask(team: Team, sessionId: string, instruction: string, res: Response): void {
  if (!team.members.some((m) => m.sessionId === sessionId)) {
    res.status(404).json({ message: '팀원 아님' })
    return
  }
  let task
  try {
    task = tasks.assign(team.id, sessionId, instruction)
  } catch (error) {
    if (error instanceof TaskConflictError) {
      res.status(409).json({ message: error.message })
      return
    }
    throw error
  }
  if (!host.send({ type: 'input', sessionId, data: `${instruction}\r` })) {
    tasks.markExited(sessionId)
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  res.json(task)
}

app.post('/api/team', (req, res) => {
  const { name, cwd, leadSessionId } = req.body as { name?: string; cwd?: string; leadSessionId?: string }
  if (!name?.trim() || !cwd || !leadSessionId) {
    res.status(400).json({ message: 'name, cwd, leadSessionId 필요' })
    return
  }
  const team: Team = {
    id: randomUUID().slice(0, 8),
    name: name.trim(),
    cwd,
    leadSessionId,
    createdAt: new Date().toISOString(),
    members: [],
  }
  addTeam(team)
  res.json(team)
  void broadcast()
})

app.get('/api/team/:teamId', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { sessions } = await snapshotPayload()
  const members = team.members.map((member) => {
    const session = sessions.find((s) => s.id === member.sessionId)
    return {
      ...member,
      status: session?.status ?? 'unknown',
      isAlive: session?.isAlive ?? false,
      lastAssistantText: session?.lastAssistantText ?? null,
      pendingTool: session?.pendingTool ?? null,
    }
  })
  res.json({ ...team, members, tasks: tasks.listByTeam(team.id) })
})

app.delete('/api/team/:teamId', (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  for (const member of team.members) host.send({ type: 'kill', sessionId: member.sessionId })
  removeTeam(team.id)
  res.json({})
  void broadcast()
})

app.post('/api/team/:teamId/members', (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { name, cwd, instruction, permissionMode } = req.body as {
    name?: string
    cwd?: string
    instruction?: string
    permissionMode?: string
  }
  if (!name?.trim() || !cwd) {
    res.status(400).json({ message: 'name, cwd 필요' })
    return
  }
  const sessionId = randomUUID()
  const extraArgs = ['--name', name.trim(), '--permission-mode', permissionMode ?? 'bypassPermissions']
  if (!host.send({ type: 'spawn', sessionId, cwd, extraArgs })) {
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  const member = { sessionId, name: name.trim(), cwd, createdAt: new Date().toISOString() }
  addTeamMember(team.id, member)
  void broadcast()
  if (!instruction) {
    res.json({ member, task: null })
    return
  }
  // claude 가 뜨기 전에 입력하면 사라진다. 첫 프롬프트는 호스트가 띄운 뒤 보내도록 지연
  setTimeout(() => {
    const task = tasks.assign(team.id, sessionId, instruction)
    host.send({ type: 'input', sessionId, data: `${instruction}\r` })
    res.json({ member, task })
  }, MEMBER_FIRST_INPUT_DELAY_MS)
})

app.delete('/api/team/:teamId/members/:sessionId', (req, res) => {
  const team = removeTeamMember(req.params.teamId, req.params.sessionId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  host.send({ type: 'kill', sessionId: req.params.sessionId })
  tasks.markExited(req.params.sessionId)
  res.json({})
  void broadcast()
})

app.post('/api/team/:teamId/tasks', (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { sessionId, instruction } = req.body as { sessionId?: string; instruction?: string }
  if (!sessionId || !instruction?.trim()) {
    res.status(400).json({ message: 'sessionId, instruction 필요' })
    return
  }
  assignTask(team, sessionId, instruction.trim(), res)
})

/** task 완료까지 롱폴링. taskId 가 'any' 면 팀의 아무 task 하나. 타임아웃·모르는 task 는 { task: null } */
app.get('/api/team/:teamId/tasks/:taskId/wait', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const requested = Number(req.query.timeoutSec ?? MAX_WAIT_SECONDS)
  const timeoutSec = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number.isFinite(requested) ? requested : MAX_WAIT_SECONDS))
  req.socket.setTimeout(0)
  const taskId = req.params.taskId === 'any' ? null : req.params.taskId
  const task = await tasks.wait(team.id, taskId, timeoutSec * 1000)
  res.json({ task })
})

app.get('/api/office', (_req, res) => {
  res.json(readOffice())
})

app.post('/api/rooms', (req, res) => {
  const { name } = req.body as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ message: '이름 필요' })
    return
  }
  res.json(addRoom(name.trim()))
  broadcastOffice()
})

app.patch('/api/rooms/:id', (req, res) => {
  const room = updateRoom(req.params.id, req.body as Partial<Omit<Room, 'id'>>)
  if (!room) {
    res.status(404).end()
    return
  }
  res.json(room)
  broadcastOffice()
})

app.put('/api/seats/:sessionId', (req, res) => {
  const seat = req.body as Seat
  if (typeof seat?.roomId !== 'string' || typeof seat.x !== 'number' || typeof seat.y !== 'number') {
    res.status(400).end()
    return
  }
  setSeat(req.params.sessionId, { roomId: seat.roomId, x: seat.x, y: seat.y, label: seat.label })
  res.json({})
  broadcastOffice()
})

app.post('/api/hook', (req, res) => {
  const payload = req.body as HookPayload
  if (!payload?.session_id || !payload.hook_event_name) {
    res.status(400).end()
    return
  }
  const next = applyHook(hookStates.get(payload.session_id), payload)
  if (next) hookStates.set(payload.session_id, next)
  tasks.applyHook(payload)
  res.json({})
  void broadcast()
})

app.get('/api/events', (req, res) => {
  openSse(res)
  subscribers.add(res)
  req.on('close', () => subscribers.delete(res))
  void broadcast()
})

host.on('reachable', () => void broadcast())
host.on('message', (message: HostMessage) => {
  if (message.type === 'exit') tasks.markExited(message.sessionId)
  if (message.type === 'sessions' || message.type === 'exit') void broadcast()
})
host.start()

const watcher = new TranscriptWatcher(projectsDir)
watcher.on('change', (sessionId: string) => {
  for (const res of subscribers) sendSse(res, 'transcript', { sessionId })
})

setInterval(() => void broadcast(), 5000)
setInterval(() => tasks.expireUnacknowledged(), 1000)

// 빌드된 웹이 있으면 서버 하나로 화면까지 제공한다 (개발 중에는 Vite 4711 을 쓴다)
const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('/{*path}', (_req, res) => res.sendFile(join(webDist, 'index.html')))
}

app.listen(PORT, config.bind, () => {
  console.log(`jk-corp server http://${config.bind}:${PORT} (메일 로그인 ${sendCode ? '사용' : '미설정'})`)
})
