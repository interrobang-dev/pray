import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import type { Response } from 'express'
import type { HostMessage } from '@jk-corp/host/protocol'
import {
  addGroup,
  addTeam,
  listTeams,
  readOffice,
  removeTeam,
  setDesk,
  GroupNotEmptyError,
  GroupNotFoundError,
  removeGroup,
  TeamConflictError,
  updateGroup,
  updateTeam,
  type Group,
  type Team,
  type TeamPatch,
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
/** teamId 가 있으면 그 팀 폴더로 띄운다. isLead 면 그 팀의 팀장으로 (살아 있는 팀장이 이미 있으면 거부) */
app.post('/api/sessions', async (req, res) => {
  const { cwd: rawCwd, teamId, prompt, isLead } = req.body as { cwd?: string; teamId?: string; prompt?: string; isLead?: boolean }
  const team = teamId ? findTeam(teamId) : undefined
  if (teamId && !team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const cwd = team?.cwd ?? rawCwd
  if (!cwd) {
    res.status(400).json({ message: 'cwd 또는 teamId 필요' })
    return
  }
  if (!host.isReachable) {
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  let extraArgs: string[] | undefined
  if (isLead) {
    if (!team) {
      res.status(400).json({ message: '팀장은 팀을 골라야 함' })
      return
    }
    if (team.leadSessionId) {
      const { sessions } = await snapshotPayload()
      if (sessions.some((s) => s.id === team.leadSessionId && s.isAlive)) {
        res.status(409).json({ message: '이 팀에는 이미 팀장이 있음' })
        return
      }
    }
  }
  const sessionId = randomUUID()
  if (isLead && team) {
    updateTeam(team.id, { leadSessionId: sessionId })
    extraArgs = leadExtraArgs({ ...team, leadSessionId: sessionId }, `http://127.0.0.1:${PORT}`)
  }
  host.send({ type: 'spawn', sessionId, cwd, prompt: prompt || undefined, extraArgs })
  res.json({ sessionId })
  if (isLead) broadcastOffice()
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

// ---------- 팀 (같은 폴더의 세션 묶음. 팀장 세션이 MCP 도구로도 호출) ----------

const MAX_WAIT_SECONDS = 600
const MEMBER_FIRST_INPUT_DELAY_MS = 4_000

function findTeam(teamId: string): Team | undefined {
  return listTeams().find((t) => t.id === teamId)
}

/** task 를 만들고 팀원 터미널에 지시문을 입력한다. 팀원 = 그 팀 폴더의 웹 세션 */
async function assignTask(team: Team, sessionId: string, instruction: string, res: Response): Promise<void> {
  const { sessions } = await snapshotPayload()
  const member = sessions.find((s) => s.id === sessionId)
  if (!member || member.teamId !== team.id || member.role !== 'member') {
    res.status(404).json({ message: '이 팀의 팀원(웹 세션)이 아님' })
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
  const { name, cwd, groupId } = req.body as { name?: string; cwd?: string; groupId?: string }
  if (!name?.trim() || !cwd?.trim() || !groupId) {
    res.status(400).json({ message: 'name, cwd, groupId 필요' })
    return
  }
  try {
    res.json(addTeam({ name: name.trim(), cwd: cwd.trim(), groupId }))
  } catch (error) {
    if (error instanceof TeamConflictError) {
      res.status(409).json({ message: error.message })
      return
    }
    if (error instanceof GroupNotFoundError) {
      res.status(400).json({ message: error.message })
      return
    }
    throw error
  }
  broadcastOffice()
})

app.get('/api/team/:teamId', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { sessions } = await snapshotPayload()
  const members = sessions
    .filter((s) => s.teamId === team.id)
    .map((s) => ({
      sessionId: s.id,
      name: s.title ?? s.id.slice(0, 8),
      kind: s.kind,
      role: s.role,
      status: s.status,
      isAlive: s.isAlive,
      lastAssistantText: s.lastAssistantText,
      pendingTool: s.pendingTool,
    }))
  res.json({ ...team, members, tasks: tasks.listByTeam(team.id) })
})

app.patch('/api/team/:teamId', (req, res) => {
  const team = updateTeam(req.params.teamId, req.body as TeamPatch)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  res.json(team)
  broadcastOffice()
})

/** 팀 기록만 지운다. 세션은 그대로 (무소속이 됨) */
app.delete('/api/team/:teamId', (req, res) => {
  if (!removeTeam(req.params.teamId)) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  res.json({})
  broadcastOffice()
})

app.put('/api/team/:teamId/desks/:sessionId', (req, res) => {
  const { dx, dy } = req.body as { dx?: number; dy?: number }
  if (typeof dx !== 'number' || typeof dy !== 'number') {
    res.status(400).end()
    return
  }
  if (!setDesk(req.params.teamId, req.params.sessionId, { dx, dy })) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  res.json({})
  broadcastOffice()
})

/** 팀 폴더로 세션을 띄운다. cwd 판정으로 자동 합류 */
app.post('/api/team/:teamId/members', (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { name, instruction, permissionMode } = req.body as { name?: string; instruction?: string; permissionMode?: string }
  if (!name?.trim()) {
    res.status(400).json({ message: 'name 필요' })
    return
  }
  const sessionId = randomUUID()
  const extraArgs = ['--name', name.trim(), '--permission-mode', permissionMode ?? 'bypassPermissions']
  if (!host.send({ type: 'spawn', sessionId, cwd: team.cwd, extraArgs })) {
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  const member = { sessionId, name: name.trim(), cwd: team.cwd }
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

/** 팀원 세션 종료 */
app.delete('/api/team/:teamId/members/:sessionId', (req, res) => {
  host.send({ type: 'kill', sessionId: req.params.sessionId })
  tasks.markExited(req.params.sessionId)
  res.json({})
})

app.post('/api/team/:teamId/tasks', async (req, res) => {
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
  await assignTask(team, sessionId, instruction.trim(), res)
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

/** 팀이 없는 그룹만 지운다 (팀이 있으면 409) */
app.delete('/api/groups/:id', (req, res) => {
  try {
    if (!removeGroup(req.params.id)) {
      res.status(404).json({ message: '그룹 없음' })
      return
    }
  } catch (error) {
    if (error instanceof GroupNotEmptyError) {
      res.status(409).json({ message: error.message })
      return
    }
    throw error
  }
  res.json({})
  broadcastOffice()
})

app.post('/api/groups', (req, res) => {
  const { name } = req.body as { name?: string }
  if (!name?.trim()) {
    res.status(400).json({ message: '이름 필요' })
    return
  }
  res.json(addGroup(name.trim()))
  broadcastOffice()
})

app.patch('/api/groups/:id', (req, res) => {
  const group = updateGroup(req.params.id, req.body as Partial<Omit<Group, 'id'>>)
  if (!group) {
    res.status(404).end()
    return
  }
  res.json(group)
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
