import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import compression from 'compression'
import express from 'express'
import type { Response } from 'express'
import type { HostMessage } from '@jk-corp/host/protocol'
import {
  addGroup,
  addPart,
  addTeam,
  listSessionNames,
  listTeams,
  readOffice,
  setSessionName,
  removeTeam,
  setDesk,
  GroupNotEmptyError,
  GroupNotFoundError,
  removeGroup,
  removePart,
  setPartOf,
  OrderMismatchError,
  PartNotFoundError,
  reorderGroups,
  reorderTeams,
  TeamConflictError,
  WorktreePartError,
  updateGroup,
  updatePart,
  updateTeam,
  type Group,
  type Part,
  type PartPatch,
  type Team,
  type TeamPatch,
} from '@jk-corp/host/hq'
import { normalizeCwd } from '@jk-corp/host/team'
import { setupFileLog } from '@jk-corp/host/runtime'
import { configDir, readConfig } from './config.js'
import { AuthStore, TOKEN_TTL_SECONDS, isLoopback, parseCookie } from './auth.js'
import { makeSendCode } from './mail.js'
import { applyHook, applyQuestionDenied, type HookPayload, type HookState } from './hookState.js'
import { findTranscript, listSessions, projectsDir } from './sessions.js'
import { contentTypeOf, findScratchpad, isSessionId, listScratchpad, resolveScratchpadFile } from './scratchpad.js'
import { summarizeTranscript } from './transcript.js'
import { HostClient } from './hostClient.js'
import { attachInstructions, parseInstructionLog, parseMessages, queuedPrompts } from './messages.js'
import { TranscriptWatcher } from './transcriptWatcher.js'
import { makeUsageCache } from './usage.js'
import { TaskConflictError, TaskStore } from './teamState.js'
import { leadExtraArgs } from './lead.js'
import { createWorktree, markFolderTrusted, markTrusted, worktreeSlug, WorktreeError } from './worktree.js'
import {
  allowDecision,
  buildAnswers,
  CANCEL_MESSAGE,
  chatMessage,
  denyDecision,
  parseQuestions,
  type PermissionDecision,
} from './askQuestion.js'
import type { AskQuestion } from './types.js'
import { serialRunner } from './serialRunner.js'
import { applySuggestion } from './suggestion.js'
import { answerBox, decideOutcome, judgeQueue, type QueueJudgement, type UnqueueProgress } from './unqueue.js'

setupFileLog()
const PORT = 4710
const hookStates = new Map<string, HookState>()
const subscribers = new Set<Response>()
const host = new HostClient()
const tasks = new TaskStore()
/** exit 한 웹 세션의 이름 (hq.json 에서는 지운다). 메모리라 서버 재시작 때 사라지지만 휴무 목록도 메모리의 훅 상태 기반이라 같이 비워지므로 수명이 같다 */
const exitedSessionNames = new Map<string, string>()
/**
 * 웹 세션의 AskUserQuestion PermissionRequest 훅 요청을 응답하지 않고 붙잡아 둔 것 (세션당 하나).
 * 답하기 API 가 이 응답으로 결정을 돌려준다. 터미널 화면과 경쟁해 먼저 결정한 쪽이 이긴다
 */
const heldQuestions = new Map<
  string,
  { questions: AskQuestion[]; toolInput: Record<string, unknown>; res: Response; at: string }
>()
/** 웹 세션 입력칸의 Claude Code 다음 입력 제안 (mod 가 POST /api/hook/suggestion 으로 보낸다). 메모리에만 */
const suggestions = new Map<string, string>()
/** 진행 중인 대기 메시지 취소 (세션당 하나). mod 의 입력칸 알림(POST /api/hook/prompt-box)이 단계를 넘긴다. 메모리에만 */
const unqueues = new Map<string, UnqueueProgress>()

const config = readConfig()
const auth = new AuthStore(config.loginEmails, join(configDir, 'auth-tokens.json'))
const sendCode = makeSendCode(config.smtp)
const COOKIE = 'jk_session'
/** 팀원에게 보낸 지시 기록 (한 줄 = InstructionRecord). 대화 탭이 사람 입력과 구분하는 데 쓴다 */
const instructionLogPath = join(configDir, 'instructions.jsonl')
/** 지휘 단위에 팀장·파트장이 없을 때 지시 말풍선에 쓰는 이름 */
const NO_LEAD_NAME = '팀 API'

const app = express()
// SSE 는 압축하면 압축 버퍼에 쌓여 이벤트가 늦게 가거나 안 가므로 뺀다 (Express 가 `; charset=utf-8` 을 붙여 앞부분으로 비교)
app.use(
  compression({
    filter: (req, res) =>
      !String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream') && compression.filter(req, res),
  }),
)
app.use(express.json({ limit: '1mb' }))

// 로컬(127.0.0.1)은 무인증. 그 외는 로그인 쿠키 필요. 훅·인증 API 는 예외
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/hook' || req.path === '/hook/ask') return next()
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

/** 사용자 지정 세션 이름 (exit 한 웹 세션 것 포함) */
function sessionNames(): Record<string, string> {
  return { ...Object.fromEntries(exitedSessionNames), ...listSessionNames() }
}

async function snapshotPayload() {
  const webSessions = new Map(host.sessions.map((s) => [s.sessionId, s.cwd]))
  const names = sessionNames()
  const questions = new Map([...heldQuestions].map(([id, held]) => [id, held.questions]))
  return {
    isHostReachable: host.isReachable,
    sessions: await listSessions(hookStates, webSessions, listTeams(), names, questions, suggestions),
  }
}

/**
 * 붙잡은 질문 훅에 응답하고 지운다 (기본 {} = 결정 없음, 터미널 화면에 맡김). 없으면 false.
 * 이벤트 처리기(호스트 exit 등)에서도 부르므로 던지지 않는다. 화면 갱신(broadcast)은 부른 쪽이 한다
 */
function releaseQuestion(sessionId: string, decision: PermissionDecision | Record<string, never> = {}): boolean {
  const held = heldQuestions.get(sessionId)
  if (!held) return false
  heldQuestions.delete(sessionId)
  try {
    if (!held.res.headersSent) held.res.json(decision)
  } catch (error) {
    console.error(`질문 훅 응답 실패 (${sessionId.slice(0, 8)}): ${error}`)
  }
  return true
}

/** hq.json 을 못 읽어 갱신을 건너뛰는 중. 5초마다 같은 로그가 쌓이지 않게 상태가 바뀔 때만 로그를 남긴다 */
let isBroadcastFailing = false

/**
 * 세션 목록을 모든 구독자에게 보낸다. 요청 처리 밖(5초 주기·SSE 접속·훅·호스트 이벤트)에서 `void` 로 불리므로 던지지 않는다.
 * 겹쳐 돌면 먼저 시작한 옛 스냅숏이 나중에 끝나 새 스냅숏을 덮어써서(질문이 붙잡힌 직후 question: null 이 온 적이 있다)
 * 한 번에 하나만 돌리고, 도는 중에 온 요청은 끝난 뒤 한 번으로 합쳐 최신 상태로 다시 돈다
 */
const broadcast = serialRunner(broadcastOnce, (error) => console.error(`세션 목록 보내기 실패: ${error}`))

/** hq.json 을 못 읽으면 그 회차만 건너뛴다 */
async function broadcastOnce(): Promise<void> {
  if (subscribers.size === 0) return
  const payload = await snapshotPayload().catch((error: unknown) => {
    if (!isBroadcastFailing) console.error(`hq.json 을 읽지 못해 갱신 건너뜀: ${error}`)
    isBroadcastFailing = true
    return null
  })
  if (!payload) return
  if (isBroadcastFailing) console.log('갱신 복구')
  isBroadcastFailing = false
  for (const res of subscribers) sendSse(res, 'sessions', payload)
}

app.get('/api/sessions', async (_req, res) => {
  res.json(await snapshotPayload())
})

/**
 * teamId 가 있으면 그 팀 폴더로 띄운다. partId 가 있으면 그 파트로 (worktree 파트면 그 폴더).
 * isLead 면 그 지휘 단위의 지시자로 (팀장 또는 파트장. 살아 있는 지시자가 이미 있으면 거부)
 */
app.post('/api/sessions', async (req, res) => {
  const { cwd: rawCwd, teamId, partId, prompt, isLead, name } = req.body as {
    cwd?: string
    teamId?: string
    partId?: string
    prompt?: string
    isLead?: boolean
    name?: string
  }
  const team = teamId ? findTeam(teamId) : undefined
  if (teamId && !team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const part = team ? unitPart(team, partId) : null
  if (part === undefined || (partId && !team)) {
    res.status(404).json({ message: '파트 없음' })
    return
  }
  const cwd = part?.worktree?.cwd ?? team?.cwd ?? rawCwd
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
    const currentLeadId = part ? part.leadSessionId : team.leadSessionId
    if (currentLeadId) {
      const { sessions } = await snapshotPayload()
      if (sessions.some((s) => s.id === currentLeadId && s.isAlive)) {
        res.status(409).json({ message: part ? '이 파트에는 이미 파트장이 있음' : '이 팀에는 이미 팀장이 있음' })
        return
      }
    }
  }
  const sessionId = randomUUID()
  if (isLead && team) {
    if (part) updatePart(team.id, part.id, { leadSessionId: sessionId })
    else updateTeam(team.id, { leadSessionId: sessionId })
    extraArgs = leadExtraArgs(
      part ? team : { ...team, leadSessionId: sessionId },
      part ? { ...part, leadSessionId: sessionId } : null,
      `http://127.0.0.1:${PORT}`,
    )
  }
  // worktree 없는 파트는 폴더로 구분이 안 되므로 소속을 기록한다
  if (team && part && !part.worktree) setPartOf(team.id, sessionId, part.id)
  if (name?.trim()) setSessionName(sessionId, name)
  // 신뢰 확인 창(기본 "No, exit")에 막혀 세션이 꺼지지 않게 띄우기 전에 폴더를 신뢰로 기록한다. 실패해도 띄우고 화면이 경고한다
  const isTrustFailed = markFolderTrusted(cwd) === false
  host.send({ type: 'spawn', sessionId, cwd, prompt: prompt || undefined, extraArgs })
  res.json({ sessionId, isTrustFailed })
  if (isLead || part) broadcastOffice()
})

/** 세션 화면 이름: 사용자 지정 → 자동 제목(ai-title) → ID 앞 8자리 */
async function displayNameOf(sessionId: string, names: Record<string, string>): Promise<string> {
  if (names[sessionId]) return names[sessionId]
  const jsonl = await findTranscript(sessionId)
  return (jsonl ? summarizeTranscript(jsonl).title : null) ?? sessionId.slice(0, 8)
}

/** 대화 메시지. 서버가 보낸 팀장·파트장 지시(instructions.jsonl)와 내용이 같은 user 메시지에는 from 이 붙는다 */
app.get('/api/sessions/:id/messages', async (req, res) => {
  const jsonl = await findTranscript(req.params.id)
  if (!jsonl) {
    res.json([])
    return
  }
  const messages = parseMessages(jsonl)
  const log = await readFile(instructionLogPath, 'utf8').catch(() => '')
  const records = parseInstructionLog(log, req.params.id)
  if (records.length === 0) {
    res.json(messages)
    return
  }
  const names = sessionNames()
  const fromIds = [...new Set(records.map((r) => r.fromSessionId).filter((id): id is string => id !== null))]
  const fromNames = new Map(await Promise.all(fromIds.map(async (id) => [id, await displayNameOf(id, names)] as const)))
  res.json(attachInstructions(messages, records, (id) => (id ? (fromNames.get(id) ?? id.slice(0, 8)) : NO_LEAD_NAME)))
})

/** 세션 작업 폴더(scratchpad)의 파일 목록. 하위 폴더 포함, 상한 MAX_FILES. 폴더가 없으면 빈 목록 */
app.get('/api/sessions/:id/files', async (req, res) => {
  if (!isSessionId(req.params.id)) {
    res.status(400).json({ message: '세션 ID 형식 오류' })
    return
  }
  const scratchpad = await findScratchpad(req.params.id)
  res.json(scratchpad ? await listScratchpad(scratchpad) : { files: [], isTruncated: false })
})

/**
 * scratchpad 파일 하나 (?path=상대 경로, ?download=1 이면 내려받기). Range·ETag 는 sendFile 이 처리한다.
 * 로컬 접속은 무인증이라 파일 안 스크립트가 이 서버 API 를 부르면 안 된다: HTML·SVG·XML 은 CSP sandbox(allow-scripts 없음)로 내보낸다.
 * no-transform 은 압축을 끄려고 — 압축 미들웨어가 206(Range) 응답까지 압축하면 Content-Range 와 바이트가 어긋난다
 */
app.get('/api/sessions/:id/files/raw', async (req, res) => {
  const { path } = req.query
  if (!isSessionId(req.params.id) || typeof path !== 'string') {
    res.status(400).json({ message: '세션 ID 또는 path 형식 오류' })
    return
  }
  const scratchpad = await findScratchpad(req.params.id)
  const file = scratchpad ? await resolveScratchpadFile(scratchpad, path) : null
  if (!file) {
    res.status(404).json({ message: '파일 없음' })
    return
  }
  const { type, isActive } = contentTypeOf(file)
  // attachment() 가 Content-Type 도 바꾸므로 먼저 부르고 아래에서 덮어쓴다
  if (req.query.download === '1') res.attachment(basename(file))
  res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache, no-transform' })
  if (isActive) res.set('Content-Security-Policy', 'sandbox')
  res.sendFile(file, { dotfiles: 'allow' })
})

/** 세션 이름 지정. 빈 문자열이면 지워서 자동 제목(ai-title)으로 돌아간다. 외부 세션에도 붙일 수 있다 */
app.patch('/api/sessions/:id', (req, res) => {
  const { name } = req.body as { name?: unknown }
  if (typeof name !== 'string') {
    res.status(400).json({ message: 'name 필요 (빈 문자열이면 삭제)' })
    return
  }
  setSessionName(req.params.id, name)
  res.json({})
  void broadcast()
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
  // 대기 메시지 취소가 입력칸을 다루는 동안 다른 키가 끼면 꺼낸 글·다시 넣는 글과 섞인다
  if (unqueues.has(req.params.id)) {
    res.status(409).json({ message: '대기 메시지를 취소하는 중' })
    return
  }
  host.send({ type: 'input', sessionId: req.params.id, data })
  res.json({})
})

/** 빈 입력칸의 ↑: 사람이 친 대기 메시지를 전부 입력칸에 꺼낸다 (Esc·Ctrl+C 는 작업 중인 차례를 멈추므로 쓰지 않는다) */
const UP_KEY = '\x1b[A'
/** ↑ 뒤 꺼냄 알림을 기다리는 시간. 안 오면(이미 받아서 꺼낼 게 없었거나 mod 가 안 붙음) jsonl 로만 판정한다 */
const UNQUEUE_POP_TIMEOUT_MS = 3_000
/** 다시 넣기까지 전체 시간. 넘으면 실패로 끝내고 진행 상태를 비운다 */
const UNQUEUE_TIMEOUT_MS = 10_000
/** 진행이 끝난 뒤 jsonl 에 꺼냄·받아들임이 적히기를 기다리는 시간 */
const UNQUEUE_RECORD_TIMEOUT_MS = 3_000
const UNQUEUE_POLL_MS = 100

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * 대기 중인 마지막 메시지 취소. body { text } = 화면의 마지막 "대기 중" 말풍선 글 (jsonl 의 마지막 대기 글과 같아야 한다).
 * pty 에 ↑ 를 보내 대기 글을 전부 입력칸에 꺼내고, mod 의 입력칸 알림에 답해 마지막 것만 빼고 하나씩 다시 넣는다 (unqueue.ts).
 * 끝나면 { outcome: cancelled·accepted·stuck·failed }. 진행 중에는 그 세션의 /input 을 409 로 막는다
 */
app.post('/api/sessions/:id/queue/cancel-last', async (req, res) => {
  const sessionId = req.params.id
  const { text } = (req.body ?? {}) as { text?: unknown }
  if (typeof text !== 'string' || !text) {
    res.status(400).json({ message: 'text 필요' })
    return
  }
  if (!host.sessions.some((s) => s.sessionId === sessionId)) {
    res.status(404).json({ message: '웹 세션이 아님' })
    return
  }
  if (hookStates.get(sessionId)?.status !== 'working' || heldQuestions.has(sessionId)) {
    res.status(409).json({ message: 'claude 가 작업 중일 때만 취소할 수 있음' })
    return
  }
  const jsonl = (await findTranscript(sessionId)) ?? ''
  // 위 await 사이에 다른 취소가 시작됐을 수 있어 여기서 본다
  if (unqueues.has(sessionId)) {
    res.status(409).json({ message: '이미 취소하는 중' })
    return
  }
  const queued = queuedPrompts(jsonl)
  if (queued.at(-1)?.text !== text) {
    res.status(409).json({ message: '대기열의 마지막 메시지가 아님 (이미 받았을 수 있음)' })
    return
  }
  const progress: UnqueueProgress = { queued: queued.map((item) => item.raw), step: { kind: 'popping' } }
  const target = progress.queued.at(-1)!
  // 마지막 조각이 쓰다 만 줄이면 그 줄부터 본다 (↑ 직전의 받아들임일 수 있다)
  const fromLine = jsonl.split('\n').length - 1
  unqueues.set(sessionId, progress)
  try {
    if (!host.send({ type: 'input', sessionId, data: UP_KEY })) {
      res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
      return
    }
    const startedAt = Date.now()
    while (unqueues.get(sessionId) === progress) {
      const { kind } = progress.step
      const elapsed = Date.now() - startedAt
      if (kind === 'done' || kind === 'stuck' || elapsed >= UNQUEUE_TIMEOUT_MS) break
      if (kind === 'popping' && elapsed >= UNQUEUE_POP_TIMEOUT_MS) break
      await sleep(UNQUEUE_POLL_MS)
    }
    // 여기서 비워야 늦게 온 알림이 Enter 를 보내지 않는다
    if (unqueues.get(sessionId) === progress) unqueues.delete(sessionId)
    const step = progress.step
    let judgement: QueueJudgement = 'unknown'
    const deadline = Date.now() + UNQUEUE_RECORD_TIMEOUT_MS
    while (step.kind !== 'stuck') {
      judgement = judgeQueue((await findTranscript(sessionId)) ?? '', fromLine, target)
      if (judgement !== 'unknown' || Date.now() >= deadline) break
      await sleep(UNQUEUE_POLL_MS)
    }
    res.json({ outcome: decideOutcome(step, judgement) })
  } finally {
    if (unqueues.get(sessionId) === progress) unqueues.delete(sessionId)
  }
})

/**
 * 붙잡은 AskUserQuestion 에 답한다. { answers: { [질문문]: string[] } } = 고른 라벨·직접 입력한 글,
 * { cancel: true } = 질문 취소, { chat: true } = 선택지 대신 대화로 답하기 (둘 다 deny)
 */
app.post('/api/sessions/:id/answer', (req, res) => {
  const sessionId = req.params.id
  const held = heldQuestions.get(sessionId)
  if (!held) {
    res.status(409).json({ message: '답할 질문 없음' })
    return
  }
  const { answers, cancel, chat } = (req.body ?? {}) as { answers?: unknown; cancel?: unknown; chat?: unknown }
  let decision: PermissionDecision
  if (cancel === true) decision = denyDecision(CANCEL_MESSAGE)
  else if (chat === true) decision = denyDecision(chatMessage(held.questions))
  else {
    const built = buildAnswers(held.questions, answers)
    if (!built.ok) {
      res.status(400).json({ message: built.message })
      return
    }
    decision = allowDecision(held.toolInput, built.answers)
  }
  releaseQuestion(sessionId, decision)
  // deny 에는 PostToolUse 가 오지 않아 Stop 까지 needs-approval(질문 없음)로 남으므로 바로 working 으로 돌린다
  if (decision.hookSpecificOutput.decision.behavior === 'deny') {
    const next = applyQuestionDenied(hookStates.get(sessionId))
    if (next) hookStates.set(sessionId, next)
  }
  res.json({})
  void broadcast()
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
/** 지시문 전송 뒤 pty 출력이 이 시간 동안 없으면 "붙여넣기 처리가 끝났다" 로 보고 Enter 를 보낸다 */
const SUBMIT_QUIET_MS = 700
/** 출력이 계속 나와도 이 시간이 지나면 Enter 를 보낸다 */
const SUBMIT_MAX_WAIT_MS = 8_000
const SUBMIT_POLL_MS = 100
/** 세션별 마지막 pty 출력 시각 (ms). 아래 host.on('message') 에서 기록 */
const lastOutputAt = new Map<string, number>()

/**
 * 지시문을 팀원 터미널에 입력하고 제출한다. 지시문과 Enter 를 한 번에 보내면 긴 글을 Claude Code TUI 가
 * 붙여넣기로 묶어 끝의 \r 까지 흡수해 제출되지 않고, 고정 간격(300ms~2초)도 불안정했다. TUI 가 붙여넣기를
 * 처리하는 동안은 출력이 이어지므로, 출력이 SUBMIT_QUIET_MS 동안 멈춘 뒤 \r 을 보낸다 (상한 SUBMIT_MAX_WAIT_MS).
 * 반환값은 지시문 전송 성공 여부 (호스트 연결 끊김이면 false)
 */
function submitInstruction(sessionId: string, instruction: string): boolean {
  if (!host.send({ type: 'input', sessionId, data: instruction })) return false
  const sentAt = Date.now()
  const timer = setInterval(() => {
    const now = Date.now()
    const quietSince = Math.max(lastOutputAt.get(sessionId) ?? 0, sentAt)
    if (now - quietSince < SUBMIT_QUIET_MS && now - sentAt < SUBMIT_MAX_WAIT_MS) return
    clearInterval(timer)
    host.send({ type: 'input', sessionId, data: '\r' })
  }, SUBMIT_POLL_MS)
  return true
}

/** 팀원에게 보낸 지시를 instructions.jsonl 에 남긴다. 요청 처리 안에서 부르고, 실패해도 로그만 남겨 지시는 그대로 진행한다 */
function recordInstruction(sessionId: string, fromSessionId: string | null, text: string): void {
  try {
    appendFileSync(instructionLogPath, `${JSON.stringify({ sessionId, fromSessionId, text, at: new Date().toISOString() })}\n`)
  } catch (error) {
    console.error(`지시 기록 실패 (${sessionId.slice(0, 8)}): ${error}`)
  }
}

function findTeam(teamId: string): Team | undefined {
  return listTeams().find((t) => t.id === teamId)
}

/** 요청의 지휘 단위. partId 가 없으면 null (팀 직속), 있으면 그 파트, 모르는 파트면 undefined */
function unitPart(team: Team, partId: unknown): Part | null | undefined {
  if (typeof partId !== 'string' || !partId) return null
  return team.parts.find((p) => p.id === partId)
}

/** 팀 API 공통: 팀과 ?partId= 지휘 단위를 찾는다. 없으면 404 를 보내고 null */
function findUnit(teamId: string, partId: unknown, res: Response): { team: Team; part: Part | null } | null {
  const team = findTeam(teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return null
  }
  const part = unitPart(team, partId)
  if (part === undefined) {
    res.status(404).json({ message: '파트 없음' })
    return null
  }
  return { team, part }
}

/** task 를 만들고 팀원 터미널에 지시문을 입력한다. 팀원 = 같은 지휘 단위의 웹 세션 */
async function assignTask(team: Team, part: Part | null, sessionId: string, instruction: string, res: Response): Promise<void> {
  const { sessions } = await snapshotPayload()
  const member = sessions.find((s) => s.id === sessionId)
  if (!member || member.teamId !== team.id) {
    res.status(404).json({ message: '이 팀의 세션이 아님' })
    return
  }
  if (member.partId !== (part?.id ?? null)) {
    res.status(403).json({ message: '다른 지휘 단위(팀 직속·다른 파트)의 세션에는 지시할 수 없음' })
    return
  }
  if (member.role !== 'member') {
    res.status(404).json({ message: '팀원(웹 세션)이 아님' })
    return
  }
  let task
  try {
    task = tasks.assign(team.id, sessionId, instruction, part?.id ?? null)
  } catch (error) {
    if (error instanceof TaskConflictError) {
      res.status(409).json({ message: error.message })
      return
    }
    throw error
  }
  if (!submitInstruction(sessionId, instruction)) {
    tasks.markExited(sessionId)
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  recordInstruction(sessionId, (part ? part.leadSessionId : team.leadSessionId) ?? null, instruction)
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

/** 지휘 단위(?partId= 없으면 팀 직속)의 세션과 task. 팀장·파트장 MCP 의 jk_status 가 부른다 */
app.get('/api/team/:teamId', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { team, part } = unit
  const { sessions } = await snapshotPayload()
  const members = sessions
    .filter((s) => s.teamId === team.id && s.partId === (part?.id ?? null))
    .map((s) => ({
      sessionId: s.id,
      name: s.name ?? s.title ?? s.id.slice(0, 8),
      kind: s.kind,
      role: s.role,
      status: s.status,
      isAlive: s.isAlive,
      lastAssistantText: s.lastAssistantText,
      pendingTool: s.pendingTool,
    }))
  res.json({ ...team, part, members, tasks: tasks.listByUnit(team.id, part?.id ?? null) })
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

/** 지휘 단위로 팀원 세션을 띄운다. 팀 직속·worktree 파트는 cwd 판정으로 자동 합류, worktree 없는 파트는 소속을 기록 */
app.post('/api/team/:teamId/members', (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { team, part } = unit
  const cwd = part?.worktree?.cwd ?? team.cwd
  const { name, instruction, permissionMode } = req.body as { name?: string; instruction?: string; permissionMode?: string }
  if (!name?.trim()) {
    res.status(400).json({ message: 'name 필요' })
    return
  }
  const sessionId = randomUUID()
  const extraArgs = ['--name', name.trim(), '--permission-mode', permissionMode ?? 'bypassPermissions']
  if (part && !part.worktree) setPartOf(team.id, sessionId, part.id)
  // 신뢰 기록은 POST /api/sessions 와 같다. 실패는 결과로 지시자에게 알린다
  const isTrustFailed = markFolderTrusted(cwd) === false
  if (!host.send({ type: 'spawn', sessionId, cwd, extraArgs })) {
    if (part && !part.worktree) setPartOf(team.id, sessionId, null)
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  // 지시자가 붙인 팀원 이름을 화면에도 보이게
  setSessionName(sessionId, name)
  const member = { sessionId, name: name.trim(), cwd }
  if (!instruction) {
    res.json({ member, task: null, isTrustFailed })
    return
  }
  // 아래 타이머 안에서 던지면 서버가 죽으므로 기록은 요청 처리 중인 여기서 남긴다
  recordInstruction(sessionId, (part ? part.leadSessionId : team.leadSessionId) ?? null, instruction)
  // claude 가 뜨기 전에 입력하면 사라진다. 첫 프롬프트는 호스트가 띄운 뒤 보내도록 지연
  setTimeout(() => {
    const task = tasks.assign(team.id, sessionId, instruction, part?.id ?? null)
    submitInstruction(sessionId, instruction)
    res.json({ member, task, isTrustFailed })
  }, MEMBER_FIRST_INPUT_DELAY_MS)
})

/** 팀원 세션 종료 */
app.delete('/api/team/:teamId/members/:sessionId', (req, res) => {
  host.send({ type: 'kill', sessionId: req.params.sessionId })
  tasks.markExited(req.params.sessionId)
  res.json({})
})

app.post('/api/team/:teamId/tasks', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { sessionId, instruction } = req.body as { sessionId?: string; instruction?: string }
  if (!sessionId || !instruction?.trim()) {
    res.status(400).json({ message: 'sessionId, instruction 필요' })
    return
  }
  await assignTask(unit.team, unit.part, sessionId, instruction.trim(), res)
})

/** task 완료까지 롱폴링. taskId 가 'any' 면 지휘 단위의 아무 task 하나. 타임아웃·모르는 task 는 { task: null } */
app.get('/api/team/:teamId/tasks/:taskId/wait', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const requested = Number(req.query.timeoutSec ?? MAX_WAIT_SECONDS)
  const timeoutSec = Math.min(MAX_WAIT_SECONDS, Math.max(1, Number.isFinite(requested) ? requested : MAX_WAIT_SECONDS))
  req.socket.setTimeout(0)
  const taskId = req.params.taskId === 'any' ? null : req.params.taskId
  const task = await tasks.wait(unit.team.id, taskId, timeoutSec * 1000, unit.part?.id ?? null)
  res.json({ task })
})

// ---------- 파트 (팀 안의 선택적 지휘 단위) ----------

/** 파트를 만든다. isWorktree 면 저장소 옆 형제 폴더에 worktree·브랜치를 만들고 ~/.claude.json 에 신뢰 표시를 남긴다 */
app.post('/api/team/:teamId/parts', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { name, isWorktree } = req.body as { name?: string; isWorktree?: boolean }
  if (!name?.trim()) {
    res.status(400).json({ message: 'name 필요' })
    return
  }
  let worktree: Part['worktree']
  let isTrusted = false
  if (isWorktree) {
    try {
      worktree = await createWorktree(team.cwd, worktreeSlug(name, randomUUID().slice(0, 8)))
    } catch (error) {
      if (error instanceof WorktreeError) {
        res.status(error.status).json({ message: error.message })
        return
      }
      throw error
    }
    isTrusted = markTrusted(worktree.cwd)
  }
  const part = addPart(team.id, { name, worktree })
  res.json({ part, isTrusted })
  broadcastOffice()
})

app.patch('/api/team/:teamId/parts/:partId', (req, res) => {
  const part = updatePart(req.params.teamId, req.params.partId, req.body as PartPatch)
  if (!part) {
    res.status(404).json({ message: '파트 없음' })
    return
  }
  res.json(part)
  broadcastOffice()
})

/** 파트 기록과 소속 기록만 지운다. worktree 폴더·브랜치는 남긴다 (병합 안 된 작업 보호) */
app.delete('/api/team/:teamId/parts/:partId', (req, res) => {
  if (!removePart(req.params.teamId, req.params.partId)) {
    res.status(404).json({ message: '파트 없음' })
    return
  }
  res.json({})
  broadcastOffice()
  void broadcast()
})

/** 팀 폴더 세션의 파트 이동 (partId null = 팀 직속). worktree 세션은 폴더로 정해지고, 지시자는 옮기면 지휘를 잃어 거부 */
app.put('/api/team/:teamId/partOf/:sessionId', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: '팀 없음' })
    return
  }
  const { partId } = req.body as { partId?: unknown }
  if (partId !== null && typeof partId !== 'string') {
    res.status(400).json({ message: 'partId 필요 (null 이면 팀 직속)' })
    return
  }
  const sessionId = req.params.sessionId
  const { sessions } = await snapshotPayload()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session || session.teamId !== team.id) {
    res.status(404).json({ message: '이 팀의 세션이 아님' })
    return
  }
  if (normalizeCwd(session.cwd) !== normalizeCwd(team.cwd)) {
    res.status(409).json({ message: 'worktree 폴더의 세션은 폴더로 소속이 정해져 옮길 수 없음' })
    return
  }
  if (team.leadSessionId === sessionId || team.parts.some((p) => p.leadSessionId === sessionId)) {
    res.status(409).json({ message: '팀장·파트장은 옮길 수 없음 (먼저 해제)' })
    return
  }
  try {
    setPartOf(team.id, sessionId, partId)
  } catch (error) {
    if (error instanceof PartNotFoundError) {
      res.status(404).json({ message: error.message })
      return
    }
    if (error instanceof WorktreePartError) {
      res.status(409).json({ message: error.message })
      return
    }
    throw error
  }
  res.json({})
  broadcastOffice()
  void broadcast()
})

/** 호스트에게 스스로 종료하라고 보낸다. 트레이 앱이 새 코드로 다시 띄운다 (작업 스케줄러 방식에서는 다시 뜨지 않음) */
app.post('/api/host/restart', (_req, res) => {
  if (!host.send({ type: 'restart' })) {
    res.status(503).json({ message: '세션 호스트에 연결되지 않음' })
    return
  }
  res.json({})
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

/** 목록의 그룹 순서. ids 는 지금 있는 그룹 전부 (다르면 400) */
app.put('/api/groups/order', (req, res) => {
  const { ids } = req.body as { ids?: unknown }
  if (!isIdList(ids)) {
    res.status(400).json({ message: 'ids(문자열 배열) 필요' })
    return
  }
  try {
    res.json(reorderGroups(ids))
  } catch (error) {
    if (error instanceof OrderMismatchError) {
      res.status(400).json({ message: error.message })
      return
    }
    throw error
  }
  broadcastOffice()
})

/** 목록의 한 그룹 안 팀 순서. ids 는 그 그룹 팀 전부 (다르면 400, 그룹이 없으면 404) */
app.put('/api/groups/:groupId/teams/order', (req, res) => {
  const { ids } = req.body as { ids?: unknown }
  if (!isIdList(ids)) {
    res.status(400).json({ message: 'ids(문자열 배열) 필요' })
    return
  }
  try {
    const teams = reorderTeams(req.params.groupId, ids)
    if (!teams) {
      res.status(404).json({ message: '그룹 없음' })
      return
    }
    res.json(teams)
  } catch (error) {
    if (error instanceof OrderMismatchError) {
      res.status(400).json({ message: error.message })
      return
    }
    throw error
  }
  broadcastOffice()
})

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string')
}

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
  // 질문 도구가 끝났거나(터미널에서 먼저 답한 경우 포함) 차례·세션이 끝나면 붙잡은 질문은 쓸모없다
  const event = payload.hook_event_name
  if ((event === 'PostToolUse' && payload.tool_name === 'AskUserQuestion') || event === 'Stop' || event === 'SessionEnd') {
    releaseQuestion(payload.session_id)
  }
  res.json({})
  void broadcast()
})

/**
 * 입력칸의 Claude Code 다음 입력 제안. 웹 세션에 불러온 mod(mod/hooks/register.ts)가 제안이 놓일 때 글을, 보낼 때 null 을 보낸다.
 * 위 인증 미들웨어의 예외가 아니다 — mod 는 같은 PC 에서 와 loopback 으로 통과하고, 예외로 두면 다른 PC 가 아무 세션 제안이나 써넣는다
 */
app.post('/api/hook/suggestion', (req, res) => {
  const update = applySuggestion(suggestions, new Set(host.sessions.map((s) => s.sessionId)), req.body)
  if (update === 'invalid') {
    res.status(400).end()
    return
  }
  res.status(204).end()
  if (update === 'changed') void broadcast()
})

/**
 * mod 가 알리는 입력칸 변경 (↑ 로 꺼냄·자기 fill·빈 입력칸) `{ sessionId, text, origin }`. 대기 메시지 취소가 진행 중일 때만 답한다:
 * { fill } = 입력칸을 그 글로 바꿔라. fill 한 글이 그대로 들어온 것을 확인하면 서버가 pty 에 Enter 를 보낸다.
 * 진행 중인 취소가 없으면 {} (평소에는 아무 일도 없다). suggestion 과 같은 이유로 인증 예외가 아니다 (mod 는 loopback 으로 통과)
 */
app.post('/api/hook/prompt-box', (req, res) => {
  const { sessionId, text, origin } = (req.body ?? {}) as { sessionId?: unknown; text?: unknown; origin?: unknown }
  if (typeof sessionId !== 'string' || typeof text !== 'string' || typeof origin !== 'string') {
    res.status(400).end()
    return
  }
  const progress = unqueues.get(sessionId)
  if (!progress) {
    res.json({})
    return
  }
  const answer = answerBox(progress, text, origin)
  progress.step = answer.step
  if (answer.isEnterNeeded) host.send({ type: 'input', sessionId, data: '\r' })
  res.json(answer.reply)
})

/**
 * PermissionRequest(matcher AskUserQuestion) 훅. 웹 세션이면 응답하지 않고 붙잡아 두고 답하기 API 를 기다린다
 * (훅 timeout 1시간). 외부 세션은 관찰만이라 바로 {} (결정 없음 → 터미널 화면이 받는다)
 */
app.post('/api/hook/ask', (req, res) => {
  const payload = (req.body ?? {}) as Partial<HookPayload> & { tool_input?: unknown }
  const sessionId = payload.session_id
  const questions = parseQuestions(payload.tool_input)
  const isAsk = payload.hook_event_name === 'PermissionRequest' && payload.tool_name === 'AskUserQuestion'
  const isWeb = host.sessions.some((s) => s.sessionId === sessionId)
  if (!sessionId || !isAsk || !questions || !isWeb) {
    res.json({})
    return
  }
  req.socket.setTimeout(0)
  releaseQuestion(sessionId)
  heldQuestions.set(sessionId, {
    questions,
    toolInput: payload.tool_input as Record<string, unknown>,
    res,
    at: new Date().toISOString(),
  })
  // 응답 전에 연결이 닫히면(훅 timeout·Claude Code 가 요청 취소) 지우기만 한다. 응답한 뒤의 close 는 이미 지워져 무시된다
  res.on('close', () => {
    if (heldQuestions.get(sessionId)?.res !== res) return
    heldQuestions.delete(sessionId)
    void broadcast()
  })
  void broadcast()
})

app.get('/api/events', (req, res) => {
  openSse(res)
  subscribers.add(res)
  req.on('close', () => subscribers.delete(res))
  void broadcast()
})

host.on('reachable', (isReachable: boolean) => {
  // 연결이 끊기면 웹 세션 목록도 빈다. 호스트가 재시작했으면 세션이 --resume 으로 새로 떠 옛 제안은 쓸모없다
  if (!isReachable) {
    suggestions.clear()
    unqueues.clear()
  }
  void broadcast()
})
host.on('message', (message: HostMessage) => {
  if (message.type === 'output') lastOutputAt.set(message.sessionId, Date.now())
  if (message.type === 'exit') {
    lastOutputAt.delete(message.sessionId)
    suggestions.delete(message.sessionId)
    unqueues.delete(message.sessionId)
    tasks.markExited(message.sessionId)
    releaseQuestion(message.sessionId)
    // 이벤트 처리기라 던지면 서버가 죽는다. 실패하면 이름이 hq.json 에 남는다
    try {
      const name = listSessionNames()[message.sessionId]
      if (name) exitedSessionNames.set(message.sessionId, name)
      setSessionName(message.sessionId, null)
    } catch (error) {
      console.error(`hq.json 을 읽거나 쓰지 못해 종료한 세션의 이름 정리 건너뜀 (${message.sessionId}): ${error}`)
    }
  }
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
