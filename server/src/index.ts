import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { freemem, hostname, totalmem } from 'node:os'
import { basename, join, relative } from 'node:path'
import compression from 'compression'
import express from 'express'
import type { Request, Response } from 'express'
import type { HostMessage } from '@pray/host/protocol'
import {
  addGroup,
  addPart,
  addTeam,
  listCharacters,
  listGenders,
  listOffDuty,
  listPositions,
  listSessionNames,
  listTeams,
  listWebSessions,
  readOffice,
  setCharacter,
  setGender,
  setPosition,
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
  addTodo,
  migrateGroupTodosToTeams,
  migratePositionNames,
  migrateWaitingNotes,
  parseTodoText,
  removeTodo,
  clearDoneTodos,
  reorderTodos,
  TodoNotFoundError,
  updateTodo,
  updateGroup,
  updatePart,
  updateTeam,
  type Group,
  type Part,
  type PartPatch,
  type SessionCharacter,
  type SessionGender,
  type Team,
  type TeamPatch,
} from '@pray/host/hq'
import { normalizeCwd } from '@pray/host/team'
import { setupFileLog } from '@pray/host/runtime'
import { dataDir } from '@pray/host/dataDir'
import { readConfig } from './config.js'
import { AuthStore, TOKEN_TTL_SECONDS, isLoopback, parseCookie } from './auth.js'
import { isAllowedHost, isSameOriginRequest } from './requestGuard.js'
import { makeSendCode } from './mail.js'
import { applyHook, applyInterrupted, applyQuestionDenied, type HookPayload, type HookState } from './hookState.js'
import { answerInterruptBox, decideInterrupt, isAwaitingFirstResponse, judgeInterrupt, type InterruptBox, type InterruptJudgement } from './interrupt.js'
import { findLiveSession, findTranscript, findTranscriptAnalysis, findTranscriptFile, findTranscriptSummary, isLiveSession, listSessions, projectsDir, sessionStatus } from './sessions.js'
import {
  contentTypeOf,
  findScratchpad,
  isSessionId,
  listScratchpad,
  resolveScratchpadFile,
  resolveSessionTempFile,
  saveAttachment,
} from './scratchpad.js'
import { hasWakingTask, parseShells, readTail, runningBackgroundTasks, runningShells } from './shells.js'
import { findFiles, isValidRequestPath, listFolder, makeFileIndexCache, readWorkspaceFile, resolveWorkspacePath } from './workspaceFiles.js'
import { diffChange, listChanges, makeChangesCache, VcsCommandError } from './workspaceChanges.js'
import { commitDetail, commitFileDiff, historyFilePath, listHistory, REV_PATTERN } from './workspaceHistory.js'
import { buildSearchPattern, MAX_MATCHES, parseSearchQuery, runSearchWorker, SEARCH_TIME_LIMIT_MS, SearchPatternError } from './workspaceSearch.js'
import { editBlockReason, isLocalPageRequest, isVcsMetaPath, saveTextFile } from './workspaceSave.js'
import { HostClient } from './hostClient.js'
import { detectVcs, makeVcsCache } from './vcs.js'
import {
  createFolder,
  folderNameError,
  folderState,
  GitInitError,
  gitInitRejection,
  listDrives,
  listSubfolders,
  normalizeFolderPath,
  parentFolderOf,
  runGitInit,
  teamNameMap,
} from './folderPicker.js'
import { openFolderRejection, openInExplorer } from './openFolder.js'
import { attachInstructions, queuedPrompts, withoutQueued, type ChatMessage } from './messages.js'
import { InstructionLogCache, MessageVersions, messageJsons, TranscriptMessageCache } from './messageCache.js'
import { TranscriptWatcher } from './transcriptWatcher.js'
import { makeUsageCache } from './usage.js'
import { AccountError, accountErrorBody, makeAccountStore } from './accountStore.js'
import { makeLoginManager, runClaudeAuth } from './accountLogin.js'
import { FlowError, makeFlowClient, makeFlowPoller, type AlarmQuery } from './flow.js'
import { TaskConflictError, TaskStore, type RestoredMember } from './teamState.js'
import { idleSinceOf, teamStatusMembers, teamStatusTasks } from './teamMembers.js'
import { type MemberLookup, taskDetailOf, taskHistoryOf } from './teamTaskHistory.js'
import { TeamTaskLog } from './teamTaskFile.js'
import { parseWaitRequest, respondJsonAfter } from './taskWait.js'
import { leadExtraArgs } from './lead.js'
import { formatHandoff, HANDOFF_LIMIT, handoffMessage, leadTranscriptPath, readHandoffSource, type LeadKind } from './leadHandoff.js'
import {
  givenNameOf,
  nameAndPosition,
  parseGender,
  parseMemberRole,
  parsePositionInput,
  pickMemberName,
  withPosition,
} from './memberName.js'
import { memberExtraArgs, modelSettingOf, parseMemberModelChoice, withModelSetting } from './memberModel.js'
import {
  createWorktree,
  markFolderTrusted,
  markTrusted,
  removeWorktree,
  worktreeSlug,
  WorktreeError,
  type BranchChoice,
} from './worktree.js'
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
import { makeCharacterSheetReader, parseCharacter } from './character.js'
import { assignCharacter, CHARACTER_SHEET, charactersInUse, type CharacterInUse } from '@pray/host/dotCharacter'
import { answerBox, decideOutcome, judgeQueue, type QueueJudgement, type UnqueueProgress } from './unqueue.js'
import { hasBusyWebSessions, switchImpact } from './switchImpact.js'
import { BTW_TIMEOUT_MESSAGE, BTW_TIMEOUT_MS, BtwStore, parseBtwQuestion, parseBtwResult } from './btw.js'

setupFileLog()
const PORT = 4710
const hookStates = new Map<string, HookState>()
const subscribers = new Set<Response>()
const host = new HostClient()
/**
 * 팀 task. `~/.claude/pray/team-tasks.json` 에 저장해 서버 재시작에도 남는다 (teamTaskFile.ts). 끝나면 그 팀원의 문맥 크기를 기록한다.
 * onChange·onFinish 는 훅·타이머에서도 불리므로 던지지 않는다
 */
const tasks = new TaskStore(undefined, {
  onChange: () => taskLog.save(),
  onFinish: (task) => {
    findTranscriptSummary(task.memberSessionId)
      .then((summary) => tasks.setEndContextTokens(task.id, summary?.contextTokens ?? null))
      .catch((error: unknown) => console.error(`task 끝 문맥 크기 읽기 실패 (${task.id}): ${error}`))
  },
})
const taskLog = new TeamTaskLog(join(dataDir(), 'team-tasks.json'), tasks)
taskLog.load()
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
/**
 * 진행 중인 중지 (Esc 를 보내고 jsonl 결말을 기다리는 세션)와 그 사이 입력칸 상태 (응답 전 중지로 돌아온 글. interrupt.ts).
 * 그동안 같은 세션의 중지·대기 메시지 취소를 막는다. 메모리에만
 */
const interrupts = new Map<string, InterruptBox>()
/** 곁가지 질문(btw) 문답 (btw.ts). 세션마다 최근 20개. 메모리에만 */
const btw = new BtwStore()
/** 답을 기다리는 btw 요청의 시간 초과 타이머 (요청 ID → 세션·타이머) */
const btwTimers = new Map<string, { sessionId: string; timer: ReturnType<typeof setTimeout> }>()
/** `/pray-btw <ID>` 를 쓰고 Enter 를 보내기 전인 세션. 그 사이 중지의 Esc·대기 취소의 ↑ 가 입력칸의 명령 글과 섞이지 않게 막는다 */
const btwTyping = new Set<string>()

const config = readConfig()
const auth = new AuthStore(config.loginEmails, join(dataDir(), 'auth-tokens.json'))
const sendCode = makeSendCode(config.smtp)
const COOKIE = 'jk_session'
/** 팀원에게 보낸 지시 기록 (한 줄 = InstructionRecord). 대화 탭이 사람 입력과 구분하는 데 쓴다 */
const instructionLogPath = join(dataDir(), 'instructions.jsonl')
/**
 * 대화 API 의 해석 캐시·보낸 버전·지시 기록 캐시 (messageCache.ts). 개수는 메모리 상한:
 * 가장 큰 세션(jsonl 173MB·2,730 메시지)이 해석 캐시 약 12.5MB·버전 기록 약 8MB 라 8개 세션이면 최악 약 160MB
 */
const transcriptMessages = new TranscriptMessageCache(8)
const messageVersions = new MessageVersions(8, 8)
const instructionLog = new InstructionLogCache(instructionLogPath)
/** 지휘 단위에 팀장·파트장이 없을 때 지시 말풍선에 쓰는 이름 */
const NO_LEAD_NAME = 'Team API'
/** 세션 역할(position) 꼴이 틀렸을 때 (parsePositionInput) */
const POSITION_FORMAT_MESSAGE = 'position must be 1–12 characters with no [ ] or line breaks (e.g. FE, BE, Lead)'

const app = express()
/** 이 PC 이름. 다른 PC 가 `http://<PC 이름>:4710` 으로 열 때의 Host */
const machineName = hostname()
// DNS rebinding 막기: Host 이름이 IP 숫자 주소·localhost·이 PC 이름일 때만 (정적 파일·SSE 포함 모든 요청. 공격 사이트 도메인으로 연 화면은 처음부터 안 뜬다)
app.use((req, res, next) => {
  if (isAllowedHost(req.headers.host, machineName)) return next()
  res.status(403).json({ message: 'Host name not allowed' })
})
// CSRF 막기: 쓰기 요청의 Origin 이 있으면 같은 출처여야 한다 (본문을 읽기 전에 거절)
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
app.use('/api', (req, res, next) => {
  if (SAFE_METHODS.has(req.method) || isSameOriginRequest(req.headers.origin, req.headers.host)) return next()
  res.status(403).json({ message: 'Cross-site request blocked' })
})
// SSE 는 압축하면 압축 버퍼에 쌓여 이벤트가 늦게 가거나 안 가므로 뺀다 (Express 가 `; charset=utf-8` 을 붙여 앞부분으로 비교)
app.use(
  compression({
    filter: (req, res) =>
      !String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream') && compression.filter(req, res),
  }),
)
const jsonBody = express.json({ limit: '1mb' })
/** 첨부 API 경로 (Express 라우팅처럼 대소문자·끝 슬래시 무시). 본문이 파일 바이트 그대로라 .json 파일이 JSON 파서에 먼저 읽히면 안 된다 */
const ATTACHMENT_PATH = /^\/api\/sessions\/[^/]+\/attachments\/?$/i
/** 작업 폴더 파일 저장(PUT) 경로. 1MB 파일의 글이 JSON 이스케이프로 1MB 를 조금 넘을 수 있어 이 경로만 상한이 크다 (파일 1MB 상한은 저장할 때 따로 본다) */
const WORKSPACE_FILE_PATH = /^\/api\/sessions\/[^/]+\/file\/?$/i
const largeJsonBody = express.json({ limit: '4mb' })
app.use((req, res, next) => {
  if (req.method === 'POST' && ATTACHMENT_PATH.test(req.path)) return next()
  if (req.method === 'PUT' && WORKSPACE_FILE_PATH.test(req.path)) return largeJsonBody(req, res, next)
  return jsonBody(req, res, next)
})

/** claude 의 http 훅 경로 (Express 라우팅처럼 대소문자·끝 슬래시 무시). 이 PC 의 claude 만 보내므로 loopback 소켓만 받는다 — 다른 PC 가 가짜 Stop 으로 팀원 task 결과를 꾸미지 못하게 */
const CLAUDE_HOOK_PATH = /^\/hook(?:\/ask)?\/?$/i
// 로컬(127.0.0.1)은 무인증. 그 외는 로그인 쿠키 필요. 인증 API 는 예외, 훅은 로컬만 (로그인한 다른 PC 도 403)
app.use('/api', (req, res, next) => {
  if (CLAUDE_HOOK_PATH.test(req.path)) {
    if (isLoopback(req.socket.remoteAddress)) return next()
    res.status(403).json({ message: 'Hooks are accepted only from this PC' })
    return
  }
  if (req.path.startsWith('/auth/')) return next()
  if (isLoopback(req.socket.remoteAddress)) return next()
  if (auth.emailOf(parseCookie(req.headers.cookie, COOKIE))) return next()
  res.status(401).json({ message: 'Login required' })
})

app.get('/api/auth/me', (req, res) => {
  const isLocal = isLoopback(req.socket.remoteAddress)
  const email = auth.emailOf(parseCookie(req.headers.cookie, COOKIE))
  res.json({ isAuthenticated: isLocal || email !== null, isLocal, email, canLogin: sendCode !== null })
})

app.post('/api/auth/request', async (req, res) => {
  const { email } = req.body as { email?: string }
  if (typeof email !== 'string' || !sendCode) {
    res.status(400).json({ message: 'Email login is not set up' })
    return
  }
  const { result, code } = auth.requestCode(email)
  if (result === 'too-soon') {
    res.status(429).json({ message: 'Try again in a moment' })
    return
  }
  // 허용되지 않은 주소에도 같은 응답 (주소 유출 방지)
  if (result === 'sent' && code) {
    try {
      await sendCode(email, code)
    } catch (error) {
      console.error('인증 메일 발송 실패', error)
      res.status(502).json({ message: 'Failed to send email' })
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
  const names = listSessionNames()
  const questions = new Map([...heldQuestions].map(([id, held]) => [id, held.questions]))
  return {
    isHostReachable: host.isReachable,
    sessions: await listSessions(
      hookStates,
      webSessions,
      listTeams(),
      names,
      questions,
      suggestions,
      listWebSessions(),
      listOffDuty(),
      listCharacters(),
      listGenders(),
      listPositions(),
      (sessionId) => tasks.latestOf(sessionId) ?? null,
    ),
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

app.get('/api/system/memory', (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.json({ totalBytes: totalmem(), freeBytes: freemem() })
})

app.get('/api/sessions', async (_req, res) => {
  res.json(await snapshotPayload())
})

/** 화면과 같은 인물 목록 (정면 아틀라스 meta). 빌드 결과가 아니라 원본을 읽는다 — 서버는 web/dist 없이도 뜬다 */
const readCharacterSheet = makeCharacterSheetReader(join(import.meta.dirname, '..', '..', 'web', 'public', 'office', `${CHARACTER_SHEET}.json`))
/** 방금 배정한 인물. 호스트가 띄워 세션 목록에 들기 전에 다음 배정이 오면(팀장이 팀원을 연달아 띄움) 같은 인물을 주지 않게 */
const recentCharacters = new Map<string, CharacterInUse>()
const RECENT_CHARACTER_MS = 60_000

/**
 * 새 세션(또는 인물 고르기에서 "Auto" 로 돌아간 세션)에 줄 도트 인물: 근무·휴식 세션(외부 포함)이 지금 보이는 인물 + 방금 배정한 것을 피해 고른다 (규칙은 assignCharacter).
 * 아틀라스를 못 읽거나 목록을 못 읽으면 null (배정 없이 화면이 해시로 고른다 — 세션 띄우기를 막지 않는다).
 * 고른 것은 recentCharacters 에 넣는다 — 띄우지 못하면 부른 쪽이 지운다
 */
async function autoCharacterFor(target: { id: string; isLead: boolean; gender: SessionGender | null; teamId: string | null }): Promise<SessionCharacter | null> {
  const characters = readCharacterSheet()
  if (!characters) return null
  try {
    const { sessions } = await snapshotPayload()
    const listed = new Set(sessions.map((s) => s.id))
    const inUse = [
      ...charactersInUse(sessions.filter((s) => s.attendance !== 'off'), characters),
      ...[...recentCharacters.values()].filter((recent) => !listed.has(recent.sessionId)),
    ]
    // 목록을 기다린 뒤 고르고 넣기까지는 동기라 동시에 온 요청도 서로의 배정을 본다
    const look = assignCharacter(target, characters, inUse)
    if (!look) return null
    recentCharacters.set(target.id, { sessionId: target.id, teamId: target.teamId, look })
    setTimeout(() => recentCharacters.delete(target.id), RECENT_CHARACTER_MS)
    return { ...look, isAuto: true }
  } catch (error) {
    console.error(`인물 자동 배정 실패 (${target.id.slice(0, 8)}): ${error}`)
    return null
  }
}

/**
 * teamId 가 있으면 그 팀 폴더로 띄운다. partId 가 있으면 그 파트로 (worktree 파트면 그 폴더).
 * isLead 면 그 지휘 단위의 지시자로 (팀장 또는 파트장. 살아 있는 지시자가 이미 있으면 거부).
 * name·position 은 세션 이름과 역할 (빼거나 빈 글이면 없음. 이름이 옛 꼴 "[역할] 이름" 이면 나눈다).
 * carryOverHistory 면 지시자로 띄운 뒤 직전 지시자의 인계 글을 첫 메시지로 보낸다 (handOverHistory)
 */
app.post('/api/sessions', async (req, res) => {
  const { cwd: rawCwd, teamId, partId, prompt, isLead, name, gender, position, carryOverHistory } = req.body as {
    cwd?: string
    teamId?: string
    partId?: string
    prompt?: string
    isLead?: boolean
    name?: unknown
    /** 이름 추천 API 가 준 성별. 화면은 추천 이름을 그대로 쓸 때만 넘긴다 */
    gender?: unknown
    position?: unknown
    carryOverHistory?: unknown
  }
  if (carryOverHistory !== undefined && typeof carryOverHistory !== 'boolean') {
    res.status(400).json({ message: 'carryOverHistory must be true or false' })
    return
  }
  const team = teamId ? findTeam(teamId) : undefined
  if (teamId && !team) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  const part = team ? unitPart(team, partId) : null
  if (part === undefined || (partId && !team)) {
    res.status(404).json({ message: 'Part not found' })
    return
  }
  const cwd = part?.worktree?.cwd ?? team?.cwd ?? rawCwd
  if (!cwd) {
    res.status(400).json({ message: 'cwd or teamId required' })
    return
  }
  const parsedPosition = parsePositionInput(position)
  if (parsedPosition === undefined) {
    res.status(400).json({ message: POSITION_FORMAT_MESSAGE })
    return
  }
  if (!host.isReachable) {
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  let extraArgs: string[] | undefined
  // 직전 지시자: 아래에서 leadSessionId 를 새 ID 로 바꾸기 전에 잡아 둔다 (살아 있으면 409 라 여기까지 오면 끝난 세션이다)
  let previousLeadId: string | null = null
  if (isLead) {
    if (!team) {
      res.status(400).json({ message: 'Choose a team for the lead' })
      return
    }
    const currentLeadId = part ? part.leadSessionId : team.leadSessionId
    previousLeadId = currentLeadId ?? null
    if (currentLeadId) {
      const { sessions } = await snapshotPayload()
      if (sessions.some((s) => s.id === currentLeadId && s.isAlive)) {
        res.status(409).json({ message: part ? 'This part already has a part lead' : 'This team already has a lead' })
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
  const label = nameAndPosition(typeof name === 'string' ? name : null, parsedPosition)
  const sessionGender = label.name ? (parseGender(gender) ?? null) : null
  if (label.name) {
    setSessionName(sessionId, label.name)
    if (sessionGender) setGender(sessionId, sessionGender)
  }
  if (label.position) setPosition(sessionId, label.position)
  const character = await autoCharacterFor({ id: sessionId, isLead: Boolean(isLead && team), gender: sessionGender, teamId: team?.id ?? null })
  if (character) setCharacter(sessionId, character)
  // 신뢰 확인 창(기본 "No, exit")에 막혀 세션이 꺼지지 않게 띄우기 전에 폴더를 신뢰로 기록한다. 실패해도 띄우고 화면이 경고한다
  const isTrustFailed = markFolderTrusted(cwd) === false
  const isSpawnSent = host.send({ type: 'spawn', sessionId, cwd, prompt: prompt || undefined, extraArgs })
  res.json({ sessionId, isTrustFailed })
  if (isLead || part) broadcastOffice()
  if (isSpawnSent && carryOverHistory === true && previousLeadId) void handOverHistory(sessionId, previousLeadId, part ? 'part-lead' : 'lead')
})

/**
 * 새 지시자에게 직전 지시자 jsonl 로 만든 인계 글(leadHandoff.ts)을 첫 메시지로 보낸다. 팀원 첫 지시처럼 spawn 뒤 MEMBER_FIRST_INPUT_DELAY_MS 를
 * 기다리고(jsonl 읽기와 겹친다) instructions.jsonl 에 남겨 새 지시자 대화에 직전 지시자가 보낸 지시 말풍선으로 보인다.
 * jsonl 이 없거나 인계할 글이 없으면 아무것도 안 보낸다. 응답을 보낸 뒤 도니 예외는 로그만 (던지면 서버가 죽는다)
 */
async function handOverHistory(sessionId: string, previousLeadId: string, kind: LeadKind): Promise<void> {
  const spawnedAt = Date.now()
  try {
    const file = await findTranscriptFile(previousLeadId)
    const source = file ? await readHandoffSource(file.path) : null
    // 이름은 역할 없이 (글 안에서 "이전 팀장(Pray)" 로 읽히게)
    const previousName = await displayNameOf(previousLeadId, listSessionNames(), {})
    const body = source ? formatHandoff(source, HANDOFF_LIMIT) : null
    console.log(`인계 글 (${sessionId.slice(0, 8)} ← ${previousLeadId.slice(0, 8)}): ${body ? `${body.length}자` : '없음'}, ${Date.now() - spawnedAt}ms`)
    if (!body) return
    const message = handoffMessage(kind, previousName, body)
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, MEMBER_FIRST_INPUT_DELAY_MS - (Date.now() - spawnedAt))))
    recordInstruction(sessionId, previousLeadId, message)
    if (!submitInstruction(sessionId, message)) console.error(`인계 글 보내기 실패 (${sessionId.slice(0, 8)}): 호스트 연결 없음`)
  } catch (error) {
    console.error(`인계 글 실패 (${sessionId.slice(0, 8)}): ${error}`)
  }
}

/**
 * 세션 화면 이름: 사용자 지정 → 자동 제목(ai-title) → ID 앞 8자리. 역할이 있으면 앞에 "[역할] " 을 붙인다
 * (지시 말풍선의 지시자 이름은 글 하나로만 가서 화면이 역할을 따로 붙일 수 없다)
 */
async function displayNameOf(sessionId: string, names: Record<string, string>, positions: Record<string, string>): Promise<string> {
  // 자동 제목은 세션 목록과 같은 요약 캐시로 (팀장 jsonl 은 크다)
  const title = names[sessionId] ? null : ((await findTranscriptSummary(sessionId))?.title ?? null)
  const name = names[sessionId] ?? title ?? sessionId.slice(0, 8)
  return withPosition(name, positions[sessionId] ?? null)
}

/**
 * 대화 메시지. 서버가 보낸 팀장·파트장 지시(instructions.jsonl)와 내용이 같은 user 메시지에는 from 이 붙는다.
 * 근무 중(호스트 목록·pid 기록)이 아닌 세션이면 대기 중 메시지를 뺀다 (대기열은 프로세스와 함께 사라졌다)
 */
async function chatMessagesOf(sessionId: string): Promise<ChatMessage[]> {
  const file = await findTranscriptFile(sessionId)
  let messages = file ? await transcriptMessages.read(file.path, file.size, file.mtimeMs) : null
  if (!messages) return []
  // 대기 중 메시지가 있을 때만 근무를 판정한다 (pid 기록 읽기는 호스트 목록에 없을 때만)
  if (messages.some((m) => m.isQueued)) {
    const isPresent = host.sessions.some((s) => s.sessionId === sessionId) || (await isLiveSession(sessionId))
    if (!isPresent) messages = withoutQueued(messages)
  }
  const records = await instructionLog.recordsOf(sessionId)
  if (records.length === 0) return messages
  const names = listSessionNames()
  const positions = listPositions()
  const fromIds = [...new Set(records.map((r) => r.fromSessionId).filter((id): id is string => id !== null))]
  const fromNames = new Map(await Promise.all(fromIds.map(async (id) => [id, await displayNameOf(id, names, positions)] as const)))
  return attachInstructions(messages, records, (id) => (id ? (fromNames.get(id) ?? id.slice(0, 8)) : NO_LEAD_NAME))
}

/**
 * 쿼리가 없으면 메시지 배열 그대로 + ETag(내용의 버전). If-None-Match 가 맞으면 304.
 * `?since=<버전>` 이면 `{ version, fromIndex, total, messages }`: since 버전 목록과 처음 달라진 자리부터 끝까지만 (모르는 버전이면 0 부터 전부).
 * 화면은 갖고 있던 목록의 fromIndex 앞을 그대로 두고 뒤를 바꿔 끼운다. 옛 서버는 since 를 무시하고 배열을 준다
 */
app.get('/api/sessions/:id/messages', async (req, res) => {
  const sessionId = req.params.id
  const jsons = messageJsons(await chatMessagesOf(sessionId))
  const since = typeof req.query.since === 'string' ? req.query.since : null
  const { version, fromIndex } = messageVersions.update(sessionId, jsons, since)
  if (since === null) {
    // 약한 ETag: 압축하면 바이트가 달라진다. no-cache = 브라우저가 캐시를 쓰기 전에 늘 ETag 로 물어본다
    res.set({ 'Cache-Control': 'no-cache', ETag: `W/"${version}"` })
    if (req.fresh) {
      res.status(304).end()
      return
    }
    res.type('json').send(`[${jsons.join(',')}]`)
    return
  }
  // 주소마다 다른 응답이라 브라우저에 남기지 않는다
  res.set('Cache-Control', 'no-store')
  res.type('json').send(`{"version":"${version}","fromIndex":${fromIndex},"total":${jsons.length},"messages":[${jsons.slice(fromIndex).join(',')}]}`)
})

/** 세션 작업 폴더(scratchpad)의 파일 목록. 하위 폴더 포함, 상한 MAX_FILES. 폴더가 없으면 빈 목록 */
app.get('/api/sessions/:id/files', async (req, res) => {
  if (!isSessionId(req.params.id)) {
    res.status(400).json({ message: 'Invalid session ID' })
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
    res.status(400).json({ message: 'Invalid session ID or path' })
    return
  }
  const scratchpad = await findScratchpad(req.params.id)
  const file = scratchpad ? await resolveScratchpadFile(scratchpad, path) : null
  if (!file) {
    res.status(404).json({ message: 'File not found' })
    return
  }
  const { type, isActive } = contentTypeOf(file)
  // attachment() 가 Content-Type 도 바꾸므로 먼저 부르고 아래에서 덮어쓴다
  if (req.query.download === '1') res.attachment(basename(file))
  res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache, no-transform' })
  if (isActive) res.set('Content-Security-Policy', 'sandbox')
  res.sendFile(file, { dotfiles: 'allow' })
})

/**
 * 작업 폴더 API(Files 탭)의 기준 폴더: 세션 목록(listSessions)과 같은 순서로 정한 cwd 의 realpath.
 * 근무 중이면 pid 기록 → 훅 → 호스트 목록, 아니면 hq 기록(휴식·퇴근). 외부 세션도 읽기는 된다.
 * 목록에 없는 세션(끝난 외부 세션 등)·cwd 가 없거나 폴더가 아니면 null
 */
async function workspaceRootOf(sessionId: string): Promise<string | null> {
  const live = await findLiveSession(sessionId)
  const hostEntry = host.sessions.find((s) => s.sessionId === sessionId)
  const cwd =
    live || hostEntry
      ? (live?.cwd ?? hookStates.get(sessionId)?.cwd ?? hostEntry?.cwd)
      : (listWebSessions().find((r) => r.sessionId === sessionId) ?? listOffDuty().find((r) => r.sessionId === sessionId))?.cwd
  if (!cwd) return null
  try {
    const root = await realpath(cwd)
    return (await stat(root)).isDirectory() ? root : null
  } catch {
    return null
  }
}

/**
 * 작업 폴더 API 공통: 세션 ID·path 꼴 검사(400) → 기준 폴더(없으면 404) → path 를 기준 안 실제 경로로(밖·없음 404).
 * 응답을 보냈으면 null
 */
async function resolveWorkspaceRequest(req: Request, res: Response, allowRoot: boolean): Promise<{ root: string; target: string } | null> {
  const path = req.query.path ?? ''
  if (!isSessionId(req.params.id as string) || typeof path !== 'string' || !isValidRequestPath(path, allowRoot)) {
    res.status(400).json({ message: 'Invalid session ID or path' })
    return null
  }
  const root = await workspaceRootOf(req.params.id as string)
  if (!root) {
    res.status(404).json({ message: 'Session folder not found' })
    return null
  }
  const target = await resolveWorkspacePath(root, path)
  if (!target) {
    res.status(404).json({ message: 'Not found' })
    return null
  }
  return { root, target }
}

/** 작업 폴더 한 단계 목록 (?path= 상대 경로, 빼면 기준 폴더) → { entries, hiddenCount, isTruncated }. 폴더 먼저·이름순 */
app.get('/api/sessions/:id/tree', async (req, res) => {
  const resolved = await resolveWorkspaceRequest(req, res, true)
  if (!resolved) return
  // 확인한 뒤 지워졌거나 권한이 없는 폴더(System Volume Information 등)도 404
  const listing = (await stat(resolved.target).catch(() => null))?.isDirectory()
    ? await listFolder(resolved.root, resolved.target).catch(() => null)
    : null
  if (!listing) {
    res.status(404).json({ message: 'Not a folder, or it could not be read' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json(listing)
})

/**
 * 작업 폴더 파일 하나 (?path=) → 글이면 { kind: 'text', text, size, mtime, hash(sha1), language, encoding, editBlockReason }
 * (editBlockReason = 이 접속에서 편집할 수 없는 이유, 되면 null — 다른 PC·.git 안·EUC-KR),
 * 1MB 넘으면 { kind: 'too-large', isTooLarge, size, mtime }, NUL 바이트가 있으면 { kind: 'binary', isBinary, size, mtime }
 */
app.get('/api/sessions/:id/file', async (req, res) => {
  const resolved = await resolveWorkspaceRequest(req, res, false)
  if (!resolved) return
  const file = (await stat(resolved.target).catch(() => null))?.isFile() ? await readWorkspaceFile(resolved.target).catch(() => null) : null
  if (!file) {
    res.status(404).json({ message: 'Not a file, or it could not be read' })
    return
  }
  res.set('Cache-Control', 'no-store')
  if (file.kind !== 'text') {
    res.json(file)
    return
  }
  const isLocal = isLoopback(req.socket.remoteAddress)
  res.json({ ...file, editBlockReason: editBlockReason({ isLocal, path: relative(resolved.root, resolved.target), encoding: file.encoding }) })
})

/**
 * 작업 폴더의 기존 글 파일 덮어쓰기 (Files 탭 편집, ?path= · 본문 { text, hash }). 규칙은 workspaceSave.ts.
 * **이 PC(소켓 주소가 loopback)에서만** — X-Forwarded-For 같은 머리는 보지 않는다. CSRF: Origin(없으면 Referer)·Host 가 loopback 주소이고
 * JSON 일 때만 (다른 사이트의 form·no-cors 요청은 JSON 을 못 보내고, fetch 로 보내면 CORS 사전 요청에서 막힌다).
 * hash = 열었을 때의 sha1. 지금 파일과 다르면 409 { message, current: { hash, mtime, size } }. 성공 { hash, mtime, size }
 */
app.put('/api/sessions/:id/file', async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) {
    res.status(403).json({ message: 'Editing works only on this PC (open it at 127.0.0.1)' })
    return
  }
  if (!isLocalPageRequest({ origin: req.get('origin'), referer: req.get('referer'), host: req.get('host') })) {
    res.status(403).json({ message: 'Save requests must come from this app on this PC' })
    return
  }
  if (!req.is('application/json')) {
    res.status(415).json({ message: 'Expected a JSON body' })
    return
  }
  const { text, hash } = (req.body ?? {}) as { text?: unknown; hash?: unknown }
  if (typeof text !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{40}$/.test(hash)) {
    res.status(400).json({ message: 'Invalid text or hash' })
    return
  }
  const resolved = await resolveWorkspaceRequest(req, res, false)
  if (!resolved) return
  if (isVcsMetaPath(String(req.query.path)) || isVcsMetaPath(relative(resolved.root, resolved.target))) {
    res.status(403).json({ message: "Files inside .git, .svn or .hg can't be edited" })
    return
  }
  if (!(await stat(resolved.target).catch(() => null))?.isFile()) {
    res.status(404).json({ message: 'Not a file' })
    return
  }
  try {
    const result = await saveTextFile(resolved.target, text, hash)
    if (result.kind === 'conflict') {
      res.status(409).json({ message: 'The file changed on disk since you opened it', current: { hash: result.hash, mtime: result.mtime, size: result.size } })
    } else if (result.kind === 'rejected') {
      res.status(result.status).json({ message: result.message })
    } else {
      res.json({ hash: result.hash, mtime: result.mtime, size: result.size })
    }
  } catch (error) {
    // 읽기 전용(EPERM)·다른 프로그램이 잠금(EBUSY) 등. 원래 바이트로 되돌려 쓰기를 시도한 뒤다
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    console.error('작업 폴더 파일 저장 실패', resolved.target, error)
    res.status(500).json({ message: `Couldn't save the file (${code})` })
  }
})

/**
 * 작업 폴더의 그림 파일 그대로 (?path=). 그림만 준다 — 그 밖은 404. 응답 머리는 scratchpad raw 와 같다
 * (nosniff, SVG 는 CSP sandbox, 압축을 끄는 no-transform)
 */
app.get('/api/sessions/:id/file/raw', async (req, res) => {
  const resolved = await resolveWorkspaceRequest(req, res, false)
  if (!resolved) return
  const { type, isActive } = contentTypeOf(resolved.target)
  if (!type.startsWith('image/') || !(await stat(resolved.target).catch(() => null))?.isFile()) {
    res.status(404).json({ message: 'Not an image' })
    return
  }
  res.set({ 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache, no-transform' })
  if (isActive) res.set('Content-Security-Policy', 'sandbox')
  res.sendFile(resolved.target, { dotfiles: 'allow' })
})

const MAX_FIND_RESULTS = 100
const MAX_FIND_QUERY = 200
const workspaceIndexOf = makeFileIndexCache()

/**
 * 작업 폴더 파일 이름 빠른 찾기 (?q=) → { paths, total, isIndexPartial, fileCount, elapsedMs }.
 * 기준 폴더 아래를 숨긴 폴더·링크 빼고 훑은 목록(5만 개·3초 상한, 30초 캐시)에서 맞는 것 최대 100개
 */
app.get('/api/sessions/:id/find', async (req, res) => {
  const { q } = req.query
  if (!isSessionId(req.params.id) || typeof q !== 'string' || q.length > MAX_FIND_QUERY) {
    res.status(400).json({ message: 'Invalid session ID or query' })
    return
  }
  const root = await workspaceRootOf(req.params.id)
  if (!root) {
    res.status(404).json({ message: 'Session folder not found' })
    return
  }
  const index = await workspaceIndexOf(root)
  const { paths, total } = findFiles(index.paths, q, MAX_FIND_RESULTS)
  res.set('Cache-Control', 'no-store')
  res.json({ paths, total, isIndexPartial: index.isPartial, fileCount: index.paths.length, elapsedMs: index.elapsedMs })
})

/** 세션별로 도는 내용 찾기 (새 검색이 오면 앞 것을 끊는다) */
const runningSearches = new Map<string, AbortController>()
/** 여러 세션이 동시에 찾을 수 있는 수 (찾기 하나가 CPU 코어 하나를 쓴다) */
const MAX_RUNNING_SEARCHES = 4
/** worker 에 남겨 주는 최소 시간 (파일 목록 받기가 상한을 거의 다 썼어도) */
const MIN_SEARCH_WORKER_MS = 500

/**
 * 작업 폴더 전체 내용 찾기 (?q=&case=&word=&regex=) → { files: [{ path, matchCount, matches: [{ line, column, text, ranges, hasMoreAfter }] }],
 * matchCount, fileCount, searchedFileCount, isTruncated, isIndexPartial, elapsedMs }. 규칙은 workspaceSearch.ts.
 * 파일은 빠른 찾기와 같은 목록(숨긴 폴더·링크 제외, 5만 개)에서 1MB 넘는 것·바이너리를 뺀 것. 찾기는 worker 스레드라 나쁜 정규식도 이벤트 루프를 막지 않는다.
 * 같은 세션의 새 검색이 오면 앞 요청은 409, 요청이 끊기면 worker 를 끝낸다
 */
app.get('/api/sessions/:id/search', async (req, res) => {
  const startedAt = Date.now()
  if (!isSessionId(req.params.id)) {
    res.status(400).json({ message: 'Invalid session ID' })
    return
  }
  const options = parseSearchQuery(req.query)
  if ('message' in options) {
    res.status(400).json({ message: options.message })
    return
  }
  try {
    buildSearchPattern(options)
  } catch (error) {
    if (!(error instanceof SearchPatternError)) throw error
    res.status(400).json({ message: error.message })
    return
  }
  const root = await workspaceRootOf(req.params.id)
  if (!root) {
    res.status(404).json({ message: 'Session folder not found' })
    return
  }
  const sessionId = req.params.id
  runningSearches.get(sessionId)?.abort()
  runningSearches.delete(sessionId)
  if (runningSearches.size >= MAX_RUNNING_SEARCHES) {
    res.status(503).json({ message: 'Too many searches are running. Try again in a moment' })
    return
  }
  const controller = new AbortController()
  runningSearches.set(sessionId, controller)
  // 화면이 요청을 끊으면(새 글자·탭 닫기) worker 도 끝낸다. req 의 close 는 GET 본문을 다 읽으면 바로 와서 res 로 본다
  res.on('close', () => !res.writableFinished && controller.abort())
  try {
    const index = await workspaceIndexOf(root)
    if (controller.signal.aborted) {
      if (!res.writableEnded) res.status(409).json({ message: 'A newer search replaced this one' })
      return
    }
    const timeLimitMs = Math.max(MIN_SEARCH_WORKER_MS, SEARCH_TIME_LIMIT_MS - (Date.now() - startedAt))
    const result = await runSearchWorker({ root, paths: index.paths, options, maxMatches: MAX_MATCHES, timeLimitMs }, controller.signal)
    if (res.writableEnded || res.destroyed) return
    if (result.isCancelled) {
      res.status(409).json({ message: 'A newer search replaced this one' })
      return
    }
    res.set('Cache-Control', 'no-store')
    res.json({
      files: result.files,
      matchCount: result.matchCount,
      fileCount: result.files.length,
      searchedFileCount: result.searchedFileCount,
      isTruncated: result.isTruncated,
      isIndexPartial: index.isPartial,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error('작업 폴더 내용 찾기 실패', root, error)
    if (!res.writableEnded) res.status(500).json({ message: 'Search failed' })
  } finally {
    if (runningSearches.get(sessionId) === controller) runningSearches.delete(sessionId)
  }
})

const workspaceChangesOf = makeChangesCache()

/**
 * 작업 폴더의 형상관리 변경 목록 (읽기만, 규칙은 workspaceChanges.ts) → { kind: 'none' } 또는
 * { kind: git·svn, branch, files: [{ path, status, oldPath }], isTruncated, hiddenCount, error }. 명령이 없거나 실패해도 200 + error
 */
app.get('/api/sessions/:id/changes', async (req, res) => {
  if (!isSessionId(req.params.id)) {
    res.status(400).json({ message: 'Invalid session ID' })
    return
  }
  const root = await workspaceRootOf(req.params.id)
  if (!root) {
    res.status(404).json({ message: 'Session folder not found' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json(await listChanges(workspaceChangesOf, root))
})

/**
 * 변경 목록에 있는 파일 하나의 diff (?path= cwd 상대) → { kind: diff·binary·too-large·empty, path, status, oldPath, hunks, encoding, hasPropertyChanges }.
 * 목록에 없는 경로는 404, diff 명령 실패는 502 + 영어 문구
 */
app.get('/api/sessions/:id/changes/diff', async (req, res) => {
  const { path } = req.query
  if (!isSessionId(req.params.id) || typeof path !== 'string' || !isValidRequestPath(path, false)) {
    res.status(400).json({ message: 'Invalid session ID or path' })
    return
  }
  const root = await workspaceRootOf(req.params.id)
  if (!root) {
    res.status(404).json({ message: 'Session folder not found' })
    return
  }
  try {
    const diff = await diffChange(workspaceChangesOf, root, path)
    if (!diff) {
      res.status(404).json({ message: 'Not a changed file' })
      return
    }
    res.set('Cache-Control', 'no-store')
    res.json(diff)
  } catch (error) {
    if (!(error instanceof VcsCommandError)) throw error
    res.status(502).json({ message: error.message })
  }
})

/**
 * 작업 폴더의 git 커밋 히스토리 한 쪽 (읽기만, 규칙은 workspaceHistory.ts. ?skip= 앞에서 건너뛸 수, ?path= cwd 상대면 그 파일만 --follow) →
 * { kind: git·svn·none, commits: [{ hash, shortHash, subject, authorName, authorDate, refs, isHead }], hasMore, error }. git 명령 실패는 200 + error
 */
app.get('/api/sessions/:id/history', async (req, res) => {
  const { skip = '0', path } = req.query
  const filePath = typeof path === 'string' && isValidRequestPath(path, false) ? historyFilePath(path) : null
  if (!isSessionId(req.params.id) || typeof skip !== 'string' || !/^\d{1,7}$/.test(skip) || (path !== undefined && filePath === null)) {
    res.status(400).json({ message: 'Invalid session ID, skip or path' })
    return
  }
  const root = await workspaceRootOf(req.params.id)
  if (!root) {
    res.status(404).json({ message: 'Session folder not found' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json(await listHistory(root, { skip: Number(skip), path: filePath }))
})

/** 히스토리 API 공통: 세션 ID·rev(4~64자 hex) 꼴(400) → 기준 폴더(404). 응답을 보냈으면 null */
async function resolveHistoryRequest(req: Request, res: Response): Promise<string | null> {
  if (!isSessionId(req.params.id as string) || !REV_PATTERN.test(req.params.rev as string)) {
    res.status(400).json({ message: 'Invalid session ID or commit' })
    return null
  }
  const root = await workspaceRootOf(req.params.id as string)
  if (!root) res.status(404).json({ message: 'Session folder not found' })
  return root
}

/**
 * 커밋 하나 → { hash, shortHash, subject, body, authorName, authorEmail, authorDate, parents, files: [{ path, status, oldPath }], outsideCount, isTruncated }.
 * 파일은 cwd 아래만(첫 부모 대비). 없는 커밋·git 이 아님 404, git 실패 502
 */
app.get('/api/sessions/:id/history/:rev', async (req, res) => {
  const root = await resolveHistoryRequest(req, res)
  if (!root) return
  try {
    const detail = await commitDetail(root, req.params.rev)
    if (!detail) {
      res.status(404).json({ message: 'Commit not found' })
      return
    }
    res.set('Cache-Control', 'no-store')
    res.json(detail)
  } catch (error) {
    if (!(error instanceof VcsCommandError)) throw error
    res.status(502).json({ message: error.message })
  }
})

/** 커밋의 파일 하나 diff (?path= cwd 상대) → Changes diff 와 같은 꼴. 그 커밋의 파일 목록에 없으면 404 */
app.get('/api/sessions/:id/history/:rev/diff', async (req, res) => {
  const { path } = req.query
  if (typeof path !== 'string' || !isValidRequestPath(path, false)) {
    res.status(400).json({ message: 'Invalid path' })
    return
  }
  const root = await resolveHistoryRequest(req, res)
  if (!root) return
  try {
    const diff = await commitFileDiff(root, req.params.rev, path)
    if (!diff) {
      res.status(404).json({ message: 'Not a file in this commit' })
      return
    }
    res.set('Cache-Control', 'no-store')
    res.json(diff)
  } catch (error) {
    if (!(error instanceof VcsCommandError)) throw error
    res.status(502).json({ message: error.message })
  }
})

/** Claude Code 백그라운드 작업 ID 꼴 (실제는 b + 영문·숫자 8자) */
const SHELL_ID = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_SHELL_LINES = 20
const MAX_SHELL_LINES = 200

/**
 * 백그라운드 shell 출력의 마지막 ?lines= 줄 (기본 20, 최대 200) → { lines, isTruncated, size }.
 * 파일 경로는 jsonl 에 적힌 그 shell 의 것만 쓰고, 그 세션의 Claude Code 임시 폴더 안인지 realpath 로 확인한다.
 * 이미 끝난 shell 도 jsonl 에 있으면 준다 (목록에서 막 빠진 것을 눌렀을 때)
 */
app.get('/api/sessions/:id/shells/:shellId/output', async (req, res) => {
  const { id: sessionId, shellId } = req.params
  const rawLines = req.query.lines
  const count = rawLines === undefined ? DEFAULT_SHELL_LINES : typeof rawLines === 'string' ? Number(rawLines) : NaN
  if (!isSessionId(sessionId) || !SHELL_ID.test(shellId) || !Number.isInteger(count) || count < 1) {
    res.status(400).json({ message: 'Invalid session ID, shell ID or lines (positive integer)' })
    return
  }
  const jsonl = await findTranscript(sessionId)
  const shell = jsonl ? parseShells(jsonl).find((s) => s.id === shellId) : undefined
  const file = shell?.outputPath ? await resolveSessionTempFile(sessionId, shell.outputPath) : null
  // 확인한 뒤 읽기 전에 지워졌을 수도 있다
  const tail = file ? await readTail(file, Math.min(count, MAX_SHELL_LINES)).catch(() => null) : null
  if (!tail) {
    res.status(404).json({ message: 'Shell or output file not found' })
    return
  }
  res.json(tail)
})

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
/** 첨부 본문 = 파일 바이트 그대로. Content-Type 은 파일 형식이라 무엇이든 받는다 */
const attachmentBody = express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES })

/** 첨부 본문을 다 읽는다. 크기 초과(413)·읽기 오류는 body-parser 오류(status 포함)로 던진다 */
function readAttachmentBody(req: Request, res: Response): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    attachmentBody(req, res, (error?: unknown) =>
      error ? reject(error) : resolve(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)),
    )
  })
}

/**
 * 대화 첨부: 본문(파일 바이트 그대로, 20MB 까지)을 세션 scratchpad 의 attachments/ 에 새 파일로 저장한다 (?name= 파일 이름).
 * scratchpad 는 Claude Code 가 확인 창 없이 읽는 곳이라 응답 path 를 그대로 claude 에게 넘기면 된다. 근무 중인 웹 세션만
 */
app.post('/api/sessions/:id/attachments', async (req, res) => {
  const sessionId = req.params.id
  if (!isSessionId(sessionId)) {
    res.status(400).json({ message: 'Invalid session ID' })
    return
  }
  if (!host.sessions.some((s) => s.sessionId === sessionId)) {
    res.status(409).json({ message: 'Not an on-duty web session' })
    return
  }
  // Claude Code 가 세션을 시작할 때 만든다. 없으면 claude 가 확인 창 없이 읽는 곳이 아니므로 만들지 않는다
  const scratchpad = await findScratchpad(sessionId)
  if (!scratchpad) {
    res.status(409).json({ message: 'Session scratchpad not found' })
    return
  }
  let data: Buffer
  try {
    data = await readAttachmentBody(req, res)
  } catch (error) {
    const isTooLarge = (error as { status?: unknown }).status === 413
    res.status(isTooLarge ? 413 : 400).json({ message: isTooLarge ? 'File is over 20MB' : "Couldn't read the file" })
    return
  }
  const name = typeof req.query.name === 'string' ? req.query.name : ''
  res.json(await saveAttachment(scratchpad, name, data))
})

/**
 * 세션 이름·역할 `{ name?, position? }`. 준 것만 바꾸고, 빈 글·null 이면 지운다 (이름은 자동 제목(ai-title)으로). 외부 세션에도 붙일 수 있다.
 * 이름이 옛 꼴 "[역할] 이름" 이면 나눠 역할도 바꾼다 (따로 준 역할이 있으면 그것이 이긴다)
 */
app.patch('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id
  const { name, position } = req.body as { name?: unknown; position?: unknown }
  const isNameGiven = name !== undefined
  const isPositionGiven = position !== undefined
  if (!isNameGiven && !isPositionGiven) {
    res.status(400).json({ message: 'name or position required (an empty string clears it)' })
    return
  }
  if (isNameGiven && name !== null && typeof name !== 'string') {
    res.status(400).json({ message: 'name must be a string (an empty string clears it)' })
    return
  }
  const parsedPosition = isPositionGiven ? parsePositionInput(position) : null
  if (parsedPosition === undefined) {
    res.status(400).json({ message: POSITION_FORMAT_MESSAGE })
    return
  }
  if (isNameGiven) {
    const label = nameAndPosition(name as string | null, parsedPosition)
    // 역할만 바뀌면 성별을 두고, 이름이 바뀌거나 지우면 성별도 지운다 (새 이름과 성별이 안 맞을 수 있어서)
    const oldName = listSessionNames()[sessionId]
    if (oldName !== undefined && (!label.name || givenNameOf(oldName) !== givenNameOf(label.name))) setGender(sessionId, null)
    setSessionName(sessionId, label.name)
    if (isPositionGiven || label.position) setPosition(sessionId, label.position)
  } else {
    setPosition(sessionId, parsedPosition)
  }
  res.json({})
  void broadcast()
})

/**
 * 도트 사무실 인물 고르기 `{ id, hair?, top? }` (색은 '#rrggbb' 또는 null = 기본색). 화면은 지시자에게만 연다.
 * `{ id: null }` 이면 "Auto": 지금 목록 기준으로 새로 배정한다 (목록에 없거나 아틀라스를 못 읽으면 기록을 지워 화면이 해시로 고른다)
 */
app.put('/api/sessions/:id/character', async (req, res) => {
  const character = parseCharacter(req.body)
  if (character === undefined) {
    res.status(400).json({ message: 'id (1–40 lowercase letters, digits or hyphens, or null) and hair/top (#rrggbb or null) required' })
    return
  }
  const sessionId = req.params.id
  if (character) setCharacter(sessionId, character)
  else {
    const session = (await snapshotPayload()).sessions.find((s) => s.id === sessionId)
    const auto = session ? await autoCharacterFor({ id: sessionId, isLead: session.role === 'lead', gender: session.gender, teamId: session.teamId }) : null
    setCharacter(sessionId, auto)
  }
  res.json({})
  void broadcast()
})

/** 웹 세션 종료. 호스트가 기록을 정리됨(dismissed) 퇴근으로 옮긴다 */
app.delete('/api/sessions/:id', (req, res) => {
  host.send({ type: 'kill', sessionId: req.params.id })
  res.json({})
})

/**
 * 퇴근한 웹 세션 다시 출근: 호스트가 퇴근 기록의 cwd·extraArgs 그대로 --resume 한다.
 * 팀장·파트장(--mcp-config 가 있는 것)은 지금도 그 팀·파트의 지시자일 때만 — 옛 팀장이 팀장 도구를 들고 돌아오지 않게
 */
app.post('/api/sessions/:id/resume', async (req, res) => {
  const sessionId = req.params.id
  const record = listOffDuty().find((r) => r.sessionId === sessionId)
  if (!record) {
    res.status(404).json({ message: 'No off-duty record' })
    return
  }
  const { sessions } = await snapshotPayload()
  if (sessions.some((s) => s.id === sessionId && s.isAlive)) {
    res.status(409).json({ message: 'Already on duty' })
    return
  }
  if (!existsSync(record.cwd)) {
    res.status(409).json({ message: `Folder not found: ${record.cwd}` })
    return
  }
  if (!host.isReachable) {
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  const isCommander = record.extraArgs?.includes('--mcp-config') ?? false
  const teams = listTeams()
  const isStillCommander = teams.some(
    (t) => t.leadSessionId === sessionId || t.parts.some((p) => p.leadSessionId === sessionId),
  )
  if (isCommander && !isStillCommander) {
    res.status(409).json({ message: "Can't clock in: the lead has changed" })
    return
  }
  if (!host.send({ type: 'resume', sessionId })) {
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  res.json({})
})

/** 퇴근 기록을 지운다 (목록에서 빠짐). 호스트가 그 세션 이름도 같이 지운다 */
app.delete('/api/sessions/:id/off-duty', (req, res) => {
  if (!listOffDuty().some((r) => r.sessionId === req.params.id)) {
    res.status(404).json({ message: 'No off-duty record' })
    return
  }
  if (!host.send({ type: 'forget', sessionId: req.params.id })) {
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
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
    res.status(409).json({ message: 'Cancelling a queued message' })
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
    res.status(400).json({ message: 'text required' })
    return
  }
  if (!host.sessions.some((s) => s.sessionId === sessionId)) {
    res.status(404).json({ message: 'Not a web session' })
    return
  }
  if (hookStates.get(sessionId)?.status !== 'working' || heldQuestions.has(sessionId)) {
    res.status(409).json({ message: 'Can only cancel while claude is working' })
    return
  }
  const jsonl = (await findTranscript(sessionId)) ?? ''
  // 위 await 사이에 다른 취소가 시작됐을 수 있어 여기서 본다
  if (unqueues.has(sessionId)) {
    res.status(409).json({ message: 'Already cancelling' })
    return
  }
  // 중지 중에 ↑ 가 들어가면 멈춘 뒤의 입력칸에서 이전 입력 기록을 불러온다
  if (interrupts.has(sessionId)) {
    res.status(409).json({ message: 'Stopping' })
    return
  }
  // 입력칸에 명령 글이 있으면 ↑ 가 대기열을 꺼내지 않는다
  if (btwTyping.has(sessionId)) {
    res.status(409).json({ message: 'Sending a side question' })
    return
  }
  const queued = queuedPrompts(jsonl)
  if (queued.at(-1)?.text !== text) {
    res.status(409).json({ message: 'Not the last queued message (claude may have received it)' })
    return
  }
  const progress: UnqueueProgress = { queued: queued.map((item) => item.raw), step: { kind: 'popping' } }
  const target = progress.queued.at(-1)!
  // 마지막 조각이 쓰다 만 줄이면 그 줄부터 본다 (↑ 직전의 받아들임일 수 있다)
  const fromLine = jsonl.split('\n').length - 1
  unqueues.set(sessionId, progress)
  try {
    if (!host.send({ type: 'input', sessionId, data: UP_KEY })) {
      res.status(503).json({ message: 'Not connected to session host' })
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

/** 중지 키. Claude Code CLI 에서 작업 중에 누르는 Esc 와 같다. Ctrl+C 는 두 번 들어가면 claude 가 종료돼 쓰지 않는다 */
const ESC_KEY = '\x1b'
/** Esc 뒤 jsonl 에 중지가 적히기를 기다리는 시간 (실측은 0.1초 안). 안 적히면 응답 전 중지였는지로 가린다 (interrupt.ts) */
const INTERRUPT_RECORD_TIMEOUT_MS = 3_000
const INTERRUPT_POLL_MS = 100

/**
 * 작업 중인 claude 를 멈춘다 (pty 에 Esc 하나). 근무 중인 웹 세션이 working 이고 승인 대기·질문 중·대기 메시지 취소 중이 아닐 때만
 * (승인 대기·질문에서 Esc 는 도구 거부·질문 거절이다). Claude Code 는 중지에 Stop 훅을 보내지 않으므로 jsonl 로 결말을 보고
 * 멈췄으면(stopped·restored) 서버가 상태를 my-turn 으로 돌린다. 팀원이면 running task 를 실패로 끝낸다.
 * 응답 전에 멈춰 보낸 글이 Claude Code 입력칸에 돌아오면 mod 의 입력칸 알림에 답해 그 입력칸을 비우고, 비운 것이 확인되면 그 글을 text 로 준다
 * (화면이 웹 입력칸에 넣는다. 안 비우면 다음에 보내는 글과 이어 붙는다).
 * 끝나면 { outcome: stopped·continued·restored·unknown, text? } (interrupt.ts). 화면은 /input 으로 Esc 를 직접 보내지 않는다
 */
app.post('/api/sessions/:id/interrupt', async (req, res) => {
  const sessionId = req.params.id
  if (!host.sessions.some((s) => s.sessionId === sessionId)) {
    res.status(404).json({ message: 'Not a web session' })
    return
  }
  const conflict = interrupts.has(sessionId) ? 'Already stopping' : interruptConflict(sessionId)
  if (conflict) {
    res.status(409).json({ message: conflict })
    return
  }
  const box: InterruptBox = { restoredText: null, isCleared: false }
  interrupts.set(sessionId, box)
  try {
    const jsonl = (await findTranscript(sessionId)) ?? ''
    // 위 await 사이에 차례가 끝났거나 질문·대기 취소가 시작됐을 수 있어 다시 본다
    const lateConflict = interruptConflict(sessionId)
    if (lateConflict) {
      res.status(409).json({ message: lateConflict })
      return
    }
    const turnStartedAt = hookStates.get(sessionId)?.workingSince ?? null
    // 마지막 조각이 쓰다 만 줄이면 그 줄부터 본다
    const fromLine = jsonl.split('\n').length - 1
    const wasAwaitingFirstResponse = isAwaitingFirstResponse(jsonl)
    if (!host.send({ type: 'input', sessionId, data: ESC_KEY })) {
      res.status(503).json({ message: 'Not connected to session host' })
      return
    }
    let judgement: InterruptJudgement = 'unknown'
    const deadline = Date.now() + INTERRUPT_RECORD_TIMEOUT_MS
    // 돌아온 글을 비웠으면 jsonl 에 남을 것이 없어 기다리지 않는다
    while (!box.isCleared) {
      judgement = judgeInterrupt((await findTranscript(sessionId)) ?? '', fromLine)
      if (judgement !== 'unknown' || Date.now() >= deadline) break
      await sleep(INTERRUPT_POLL_MS)
    }
    // 여기서 비워야 늦게 온 알림에 비우라고 답하지 않는다
    interrupts.delete(sessionId)
    const outcome = decideInterrupt(judgement, wasAwaitingFirstResponse, box.isCleared)
    // 대기 메시지로 이어서 일해도(continued) 지시받은 일은 멈췄다. 기록이 없으면(unknown) 멈췄는지 몰라 그대로 둔다
    if (outcome !== 'unknown') tasks.markInterrupted(sessionId)
    if (outcome === 'stopped' || outcome === 'restored') {
      const next = applyInterrupted(hookStates.get(sessionId), turnStartedAt)
      if (next) hookStates.set(sessionId, next)
    }
    // 비운 것이 확인된 글만 준다 (비우지 못했으면 아직 Claude Code 입력칸에 있어 화면에 넣으면 두 곳에 있게 된다)
    res.json(box.isCleared && box.restoredText !== null ? { outcome, text: box.restoredText } : { outcome })
    void broadcast()
  } finally {
    interrupts.delete(sessionId)
  }
})

/** 중지할 수 없는 이유 (409 문구). 없으면 null. 진행 중인 중지(interrupts)는 부르는 쪽이 본다 (중지 도중의 재확인에는 자기 자신이 들어 있다) */
function interruptConflict(sessionId: string): string | null {
  const status = hookStates.get(sessionId)?.status
  if (heldQuestions.has(sessionId) || status === 'needs-approval') return "Can't stop while it needs approval or is asking a question (Esc would reject the tool or question)"
  if (status !== 'working') return 'Can only stop while claude is working'
  if (unqueues.has(sessionId)) return 'Cancelling a queued message'
  if (btwTyping.has(sessionId)) return 'Sending a side question'
  return null
}

/** mod 가 실행하는 slash command (mod/hooks/register.ts 의 BTW_COMMAND) */
const BTW_COMMAND = 'pray-btw'
/** 명령 글을 쓰고 Enter 까지 (화면 대화 탭의 SUBMIT_ENTER_DELAY_MS 와 같다 — 이어 보내면 \r 이 줄바꿈이 된다) */
const BTW_ENTER_DELAY_MS = 300

/** 문답이 바뀌었다고 화면에 알린다. 화면은 그 세션 목록을 다시 받는다 */
function broadcastBtw(sessionId: string): void {
  for (const res of subscribers) sendSse(res, 'btw', { sessionId })
}

/** 그 세션의 문답과 시간 초과 타이머를 지운다 (exit·지우기). 지운 것이 있으면 true */
function clearBtw(sessionId: string): boolean {
  for (const [requestId, entry] of btwTimers) {
    if (entry.sessionId !== sessionId) continue
    clearTimeout(entry.timer)
    btwTimers.delete(requestId)
  }
  return btw.clear(sessionId)
}

/** 곁가지 질문을 보낼 수 없는 이유 (409 문구). 키를 pty 에 쓰므로 승인·질문 화면이나 입력칸을 다루는 동안은 막는다 */
function btwConflict(sessionId: string): string | null {
  if (heldQuestions.has(sessionId) || hookStates.get(sessionId)?.status === 'needs-approval') {
    return "Can't ask while claude needs approval or is asking a question"
  }
  if (unqueues.has(sessionId)) return "Can't ask while cancelling a queued message"
  if (interrupts.has(sessionId)) return "Can't ask while stopping"
  if (btwTyping.has(sessionId) || btw.hasPending(sessionId)) return 'Still answering the last side question'
  return null
}

/**
 * 곁가지 질문 `{ question }` (Claude Code /btw 와 같은 일. btw.ts). 근무 중인 웹 세션만. 작업 중에도 된다 — 명령이 immediate 라 차례를 멈추지 않는다.
 * pty 에 `/pray-btw <요청 ID>` 를 쓰고 300ms 뒤 Enter 를 보낸 다음 `{ requestId }` 로 답한다 (화면이 Enter 까지 기다려 다음 보내기와 섞이지 않게).
 * 답은 mod 가 `POST /api/hook/btw/:requestId` 로 보내고, BTW_TIMEOUT_MS 안에 안 오면 실패로 끝낸다. 바뀔 때마다 SSE `btw { sessionId }`
 */
app.post('/api/sessions/:id/btw', async (req, res) => {
  const sessionId = req.params.id
  const question = parseBtwQuestion(((req.body ?? {}) as { question?: unknown }).question)
  if (question === null) {
    res.status(400).json({ message: 'Question must be 1 to 4000 characters' })
    return
  }
  if (!host.sessions.some((s) => s.sessionId === sessionId)) {
    res.status(404).json({ message: 'Not an on-duty web session' })
    return
  }
  const conflict = btwConflict(sessionId)
  if (conflict) {
    res.status(409).json({ message: conflict })
    return
  }
  const requestId = randomUUID()
  btw.ask(sessionId, requestId, question)
  if (!host.send({ type: 'input', sessionId, data: `/${BTW_COMMAND} ${requestId}` })) {
    btw.remove(sessionId, requestId)
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  const timer = setTimeout(() => {
    btwTimers.delete(requestId)
    if (btw.settle(sessionId, requestId, { isAnswered: false, message: BTW_TIMEOUT_MESSAGE })) broadcastBtw(sessionId)
  }, BTW_TIMEOUT_MS)
  btwTimers.set(requestId, { sessionId, timer })
  broadcastBtw(sessionId)
  await sleep(BTW_ENTER_DELAY_MS)
  host.send({ type: 'input', sessionId, data: '\r' })
  res.json({ requestId })
})

/** 그 세션의 곁가지 문답 (오래된 것 먼저) */
app.get('/api/sessions/:id/btw', (req, res) => {
  res.json({ items: btw.list(req.params.id) })
})

/** 그 세션의 곁가지 문답을 지운다. 답을 기다리던 것도 지워 늦게 온 답은 버려진다 */
app.delete('/api/sessions/:id/btw', (req, res) => {
  if (clearBtw(req.params.id)) broadcastBtw(req.params.id)
  res.json({})
})

/**
 * 근무 중인 웹 세션의 모델·effort 바꾸기 `{ model, effort }` (model = haiku·sonnet·opus·fable, effort = low…max 또는 null = 사용자 전역 설정).
 * 세션 안에서 /model·/effort 를 보내면 사용자 전역 설정(~/.claude/settings.json)의 기본값까지 바뀌어서, 호스트가 hq 기록의 extraArgs 를
 * 바꿔 claude 를 --resume 으로 다시 띄운다 (restart-session). 지금 기록 값과 같으면 아무것도 안 하고 { isRestarted: false },
 * 다르면 다시 뜨기를 기다리지 않고 { isRestarted: true }. 끄면 사라지는 것(진행 중인 차례·대기 메시지·백그라운드 shell·MCP 호출·에이전트)이 있으면 409
 */
app.put('/api/sessions/:id/model', async (req, res) => {
  const sessionId = req.params.id
  if (!isSessionId(sessionId)) {
    res.status(400).json({ message: 'Invalid session ID' })
    return
  }
  // model 은 null 이 안 된다: --model 없이 resume 하면 마지막 응답의 모델이 그대로라 "기본값" 이 뜻이 없다
  const choice = parseMemberModelChoice((req.body ?? {}) as { model?: unknown; effort?: unknown })
  if (!choice?.model) {
    res.status(400).json({ message: 'model (haiku, sonnet, opus or fable) and effort (low, medium, high, xhigh, max or null) required' })
    return
  }
  if (!host.isReachable) {
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  if (!host.sessions.some((s) => s.sessionId === sessionId)) {
    res.status(404).json({ message: 'Not an on-duty web session' })
    return
  }
  // hq.json 을 못 읽으면 Express 5 가 500 으로 끝낸다
  const record = listWebSessions().find((r) => r.sessionId === sessionId)
  if (!record) {
    res.status(404).json({ message: 'No web session record' })
    return
  }
  const extraArgs = record.extraArgs ?? []
  const current = modelSettingOf(extraArgs)
  if (current.model === choice.model && current.effort === choice.effort) {
    res.json({ isRestarted: false })
    return
  }
  const jsonl = await findTranscript(sessionId)
  // 위 await 사이에 차례가 시작됐거나 질문·대기 취소·중지가 시작됐을 수 있어 그 뒤에 본다
  const conflict = modelChangeConflict(sessionId, jsonl)
  if (conflict) {
    res.status(409).json({ message: conflict })
    return
  }
  if (!host.send({ type: 'restart-session', sessionId, extraArgs: withModelSetting(extraArgs, choice) })) {
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  res.json({ isRestarted: true })
})

/**
 * 모델·effort 를 바꾸려고 claude 를 끌 수 없는 이유 (409 문구, 화면이 그대로 보인다). 없으면 null.
 * 끄면 진행 중인 차례·붙잡은 질문·대기 메시지(프로세스 메모리에만 있다)·백그라운드 작업(shell·MCP 호출·에이전트)이 사라진다
 */
function modelChangeConflict(sessionId: string, jsonl: string | null): string | null {
  const status = hookStates.get(sessionId)?.status
  if (heldQuestions.has(sessionId)) return "Can't change the model while claude is asking a question"
  if (status === 'working') return "Can't change the model while claude is working"
  if (status === 'needs-approval') return "Can't change the model while claude needs approval"
  if (unqueues.has(sessionId)) return "Can't change the model while cancelling a queued message"
  if (interrupts.has(sessionId)) return "Can't change the model while stopping"
  // 대화가 한 번도 없으면 jsonl 이 없어 resume 할 수 없다 (끄면 호스트가 기록을 지운다)
  if (!jsonl) return "Can't change the model before the first message"
  if (queuedPrompts(jsonl).length) return "Can't change the model while messages are queued"
  if (runningShells(jsonl).length) return "Can't change the model while background shells are running"
  // 백그라운드로 넘어간 MCP 호출(팀장의 team_wait 등)·백그라운드 에이전트도 프로세스와 같이 끝난다
  if (runningBackgroundTasks(jsonl).length) return "Can't change the model while background tasks are running"
  return null
}

/**
 * 붙잡은 AskUserQuestion 에 답한다. { answers: { [질문문]: string[] } } = 고른 라벨·직접 입력한 글,
 * { cancel: true } = 질문 취소, { chat: true } = 선택지 대신 대화로 답하기 (둘 다 deny)
 */
app.post('/api/sessions/:id/answer', (req, res) => {
  const sessionId = req.params.id
  const held = heldQuestions.get(sessionId)
  if (!held) {
    res.status(409).json({ message: 'No question to answer' })
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
  if (!host.send({ type: 'attach', sessionId })) sendSse(res, 'error', 'Not connected to session host')
})

/** 팀 폴더의 형상관리 판정(5분 캐시). 화면 전용 파생 필드라 hq.json 에는 저장하지 않는다 */
const vcsOf = makeVcsCache({ ttlMs: 5 * 60_000 })

/**
 * 팀·파트의 직전 지시자 jsonl 이 있는지 (화면이 "Carry over previous lead's history" 칸을 보일지. 파생 필드라 hq.json 에는 저장하지 않는다).
 * broadcast 마다 불려서 projects 폴더를 훑지 않고 지시자 폴더의 프로젝트 폴더에 파일이 있는지만 본다 (실제 인계는 handOverHistory 가 다시 찾는다)
 */
function hasPreviousLead(leadSessionId: string | undefined, cwd: string): boolean {
  return Boolean(leadSessionId) && existsSync(leadTranscriptPath(projectsDir, cwd, leadSessionId!))
}

function readOfficeWithVcs() {
  const office = readOffice()
  return {
    ...office,
    teams: office.teams.map((team) => ({
      ...team,
      vcs: vcsOf(team.cwd),
      hasPreviousLead: hasPreviousLead(team.leadSessionId, team.cwd),
      parts: team.parts.map((part) => ({ ...part, hasPreviousLead: hasPreviousLead(part.leadSessionId, part.worktree?.cwd ?? team.cwd) })),
    })),
  }
}

function broadcastOffice(): void {
  const office = readOfficeWithVcs()
  for (const res of subscribers) sendSse(res, 'office', office)
}

const readUsage = makeUsageCache(60_000)

// 계정 사용량 (5시간·주간 한도). 비공식 OAuth 엔드포인트, 60초 캐시
app.get('/api/usage', async (_req, res) => {
  res.json(await readUsage())
})

// ---------- Claude 계정 로그인·로그아웃·전환 (한 번에 한 계정이 기본 폴더에. 보관함 ~/.claude/pray/accounts.json) ----------

const accountStore = makeAccountStore({ runClaude: runClaudeAuth, onChange: () => readUsage.clear() })
const accountLogins = makeLoginManager({ saveLogin: (configDir) => accountStore.saveLogin(configDir) })
accountStore.startWatching()

/** AccountError 는 그 상태코드와 문구 그대로. 그 밖은 500 (토큰이 든 파일 내용은 오류 문구에 없다) */
function sendAccountError(res: Response, error: unknown): void {
  if (error instanceof AccountError) {
    res.status(error.status).json(accountErrorBody(error))
    return
  }
  console.error(`계정 요청 실패: ${(error as Error).message}`)
  res.status(500).json({ message: `Account request failed: ${(error as Error).message}` })
}

app.get('/api/accounts', async (_req, res) => {
  try {
    res.json(await accountStore.list())
  } catch (error) {
    sendAccountError(res, error)
  }
})

app.post('/api/accounts/login', async (_req, res) => {
  try {
    res.json(await accountLogins.start())
  } catch (error) {
    sendAccountError(res, error)
  }
})

app.post('/api/accounts/login/:loginId/code', async (req, res) => {
  const { code } = (req.body ?? {}) as { code?: unknown }
  try {
    res.json({ account: await accountLogins.submitCode(req.params.loginId, code) })
  } catch (error) {
    sendAccountError(res, error)
  }
})

app.delete('/api/accounts/login/:loginId', async (req, res) => {
  await accountLogins.cancel(req.params.loginId)
  res.status(204).end()
})

app.post('/api/accounts/logout', async (_req, res) => {
  try {
    await accountStore.logout()
    res.json({})
  } catch (error) {
    sendAccountError(res, error)
  }
})

/** 전환하면 프롬프트 캐시가 깨질 세션과 그 문맥 크기, 작업 중인 세션 (세션 정보만. 계정 파일은 읽지 않는다) */
app.get('/api/accounts/switch-impact', async (_req, res) => {
  let sessions
  try {
    sessions = (await snapshotPayload()).sessions
  } catch (error) {
    console.error(`전환 영향 계산 실패: ${error}`)
    res.status(500).json({ message: "Couldn't read the session list" })
    return
  }
  const candidates = await Promise.all(
    sessions
      .filter((s) => s.attendance === 'present')
      .map(async (s) => ({ ...s, contextTokens: (await findTranscriptSummary(s.id))?.contextTokens ?? null })),
  )
  res.json(switchImpact(candidates, Date.now()))
})

app.post('/api/accounts/:id/switch', async (req, res) => {
  try {
    const account = await accountStore.switchTo(req.params.id)
    // 전환을 마친 뒤 다시 센다. 근무 중인 웹 세션 = 호스트 목록 (hq.json 을 읽지 않아 전환 뒤에 실패하지 않는다)
    // 목록과 같은 표시 상태로 센다: 백그라운드 작업을 기다리는(waiting) 세션과 jsonl 로 일하는 중이라 본 세션(훅을 모를 때)도 바쁘다.
    // done·my-turn 의 구분은 여기서 필요 없어 팀원 task 는 보지 않는다
    const webSessions = await Promise.all(
      host.sessions.map(async (s) => {
        const hook = hookStates.get(s.sessionId)
        const analysis = await findTranscriptAnalysis(s.sessionId)
        const status = sessionStatus(
          hook,
          'present',
          () => ({
            hasRunningBackground: hasWakingTask(analysis?.backgroundTasks ?? []),
            latestTask: null,
            lastAssistantText: hook?.lastAssistantText ?? analysis?.summary.lastAssistantText ?? null,
          }),
          analysis?.summary.turn ?? null,
        )
        return { kind: 'web' as const, attendance: 'present' as const, status }
      }),
    )
    res.json({ account, hasBusyWebSessions: hasBusyWebSessions(webSessions) })
  } catch (error) {
    sendAccountError(res, error)
  }
})

app.delete('/api/accounts/:id', async (req, res) => {
  try {
    await accountStore.remove(req.params.id)
    res.json({})
  } catch (error) {
    sendAccountError(res, error)
  }
})

// ---------- 플로우(flow.team) 알림 중계. 키는 ~/.claude/flow-key.env ----------

const flow = makeFlowClient()
const FLOW_POLL_MS = 30_000
const flowPoller = makeFlowPoller(flow, (status) => {
  for (const res of subscribers) sendSse(res, 'flow', status)
})

function sendFlowError(res: Response, error: unknown): void {
  if (!(error instanceof FlowError)) throw error
  res.status(error.status).json({ message: error.message })
}

app.get('/api/flow', (_req, res) => {
  res.json(flowPoller.status())
})

// 공식 알림 목록 한 쪽(50개) + 프로젝트 이름. readYn 이 없으면 전부
app.get('/api/flow/alarms', async (req, res) => {
  const { readYn, cursor } = req.query
  if ((readYn !== undefined && readYn !== 'Y' && readYn !== 'N') || (cursor !== undefined && !/^\d{1,9}$/.test(String(cursor)))) {
    res.status(400).json({ message: 'readYn must be Y or N, and cursor a number' })
    return
  }
  const query: AlarmQuery = { readYn: readYn as AlarmQuery['readYn'], cursor: cursor as string | undefined }
  try {
    res.json(await flow.listAlarms(query))
  } catch (error) {
    sendFlowError(res, error)
  }
})

// 읽음 처리 뒤 안 읽은 수를 바로 다시 세어 화면에 알리고, 그 상태를 응답으로도 준다
app.post('/api/flow/alarms/read-all', async (_req, res) => {
  try {
    await flow.readAllAlarms()
  } catch (error) {
    sendFlowError(res, error)
    return
  }
  await flowPoller.check()
  res.json(flowPoller.status())
})

app.post('/api/flow/alarms/:alarmId/read', async (req, res) => {
  const { alarmId } = req.params
  if (!/^\d{1,20}$/.test(alarmId)) {
    res.status(400).json({ message: 'alarmId must be a number' })
    return
  }
  try {
    await flow.readAlarm(alarmId)
  } catch (error) {
    sendFlowError(res, error)
    return
  }
  await flowPoller.check()
  res.json(flowPoller.status())
})

// ---------- 팀 (같은 폴더의 세션 묶음. 팀장 세션이 MCP 도구로도 호출) ----------

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
    res.status(404).json({ message: 'Team not found' })
    return null
  }
  const part = unitPart(team, partId)
  if (part === undefined) {
    res.status(404).json({ message: 'Part not found' })
    return null
  }
  return { team, part }
}

/** task 를 만들고 팀원 터미널에 지시문을 입력한다. 팀원 = 같은 지휘 단위의 웹 세션 */
async function assignTask(team: Team, part: Part | null, sessionId: string, instruction: string, res: Response): Promise<void> {
  const { sessions } = await snapshotPayload()
  const member = sessions.find((s) => s.id === sessionId)
  if (!member || member.teamId !== team.id) {
    res.status(404).json({ message: 'Not a session of this team' })
    return
  }
  if (member.partId !== (part?.id ?? null)) {
    res.status(403).json({ message: "Can't instruct a session in another unit (directly under the team or another part)" })
    return
  }
  if (member.role !== 'member') {
    res.status(404).json({ message: 'Not a member (web session)' })
    return
  }
  // 휴식·퇴근 세션도 kind 가 web 이라 role 이 member 다. 받아 주면 입력이 갈 곳이 없어 13초 뒤 failed 가 된다
  if (!member.isAlive) {
    res.status(409).json({ message: "Can't instruct a member on break or off duty" })
    return
  }
  let task
  try {
    task = tasks.assign(team.id, sessionId, instruction, part?.id ?? null, {
      contextTokens: member.contextTokens,
      idleSince: idleSinceOf(member.status, member.turnEndedAt),
    })
  } catch (error) {
    if (error instanceof TaskConflictError) {
      res.status(409).json({ message: error.message })
      return
    }
    throw error
  }
  if (!submitInstruction(sessionId, instruction)) {
    tasks.markExited(sessionId)
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  recordInstruction(sessionId, (part ? part.leadSessionId : team.leadSessionId) ?? null, instruction)
  res.json(task)
}

/**
 * x·y(섬 앵커)는 화면이 빈 자리를 찾아 준다. 없으면 hq 가 정한다.
 * gitInit 이 true 면 (이 PC 에서만) 팀 폴더에 `git init -b main` 을 하고 성공해야 팀을 만든다. 거절 순서는 gitInitRejection
 */
app.post('/api/team', async (req, res) => {
  const { name, cwd, groupId, x, y, gitInit } = req.body as { name?: string; cwd?: string; groupId?: string; x?: unknown; y?: unknown; gitInit?: unknown }
  if (!name?.trim() || !cwd?.trim() || !groupId || (gitInit !== undefined && typeof gitInit !== 'boolean')) {
    res.status(400).json({ message: 'name, cwd and groupId required' })
    return
  }
  if (gitInit) {
    const isLocal = isLoopback(req.socket.remoteAddress)
    const folder = isLocal ? normalizeFolderPath(cwd.trim()) : null
    const state = folder ? await folderState(folder) : 'missing'
    const office = isLocal ? readOffice() : { groups: [], teams: [] }
    const rejection = gitInitRejection({
      isLocal,
      folder,
      state,
      hasGroup: office.groups.some((group) => group.id === groupId),
      hasTeam: folder !== null && office.teams.some((team) => normalizeCwd(team.cwd) === normalizeCwd(folder)),
      vcs: state === 'folder' && folder ? detectVcs(folder) : null,
    })
    if (rejection) {
      res.status(rejection.status).json({ message: rejection.message })
      return
    }
    try {
      await runGitInit(folder!)
    } catch (error) {
      if (error instanceof GitInitError) {
        res.status(500).json({ message: error.message })
        return
      }
      throw error
    }
    vcsOf.forget(folder!)
  }
  try {
    res.json(addTeam({ name: name.trim(), cwd: cwd.trim(), groupId, x, y }))
  } catch (error) {
    // hq 오류 문구는 한국어라 화면용 영어 문구로 바꿔 보낸다 (아래 hq 오류도 같다)
    if (error instanceof TeamConflictError) {
      res.status(409).json({ message: `A team for this folder already exists: ${cwd.trim()}` })
      return
    }
    if (error instanceof GroupNotFoundError) {
      res.status(400).json({ message: 'Group not found' })
      return
    }
    throw error
  }
  broadcastOffice()
})

/** 지휘 단위(?partId= 없으면 팀 직속)의 세션과 task. 팀장·파트장 MCP 의 team_status 가 부른다 */
app.get('/api/team/:teamId', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { team, part } = unit
  const { sessions } = await snapshotPayload()
  // 근무 중인 세션만 전체 꼴, 휴식·퇴근은 짧은 꼴 (teamStatusMembers)
  const members = teamStatusMembers(sessions.filter((s) => s.teamId === team.id && s.partId === (part?.id ?? null)))
  // 할 일은 싣지 않는다 (팀장 토큰 절약)
  const { todos: _todos, ...teamWithoutTodos } = team
  res.json({ ...teamWithoutTodos, vcs: vcsOf(team.cwd), part, ...members, tasks: teamStatusTasks(tasks.listByUnit(team.id, part?.id ?? null)) })
})

app.patch('/api/team/:teamId', (req, res) => {
  const team = updateTeam(req.params.teamId, req.body as TeamPatch)
  if (!team) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  res.json(team)
  broadcastOffice()
})

/** 팀 기록만 지운다. 세션은 그대로 (무소속이 됨) */
app.delete('/api/team/:teamId', (req, res) => {
  if (!removeTeam(req.params.teamId)) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  res.json({})
  broadcastOffice()
})

/** 팀 폴더를 이 PC 의 Windows 탐색기로 연다. Origin 검사는 위 전역 미들웨어가 한다 */
app.post('/api/team/:teamId/open-folder', async (req, res) => {
  const isLocal = isLoopback(req.socket.remoteAddress)
  const team = isLocal ? findTeam(req.params.teamId) : undefined
  const isDirectory = team ? await stat(team.cwd).then((info) => info.isDirectory(), () => false) : false
  const rejection = openFolderRejection({ isLocal, hasTeam: team !== undefined, isDirectory })
  if (rejection) {
    res.status(rejection.status).json({ message: rejection.message })
    return
  }
  openInExplorer(team!.cwd)
  res.json({})
})

/**
 * 팀 만들기 창의 폴더 고르기 (이 PC 전용 — 다른 PC 는 경로를 직접 적는다). `?path=` 가 비면 드라이브 목록, 있으면 그 폴더의 하위 폴더.
 * parent: 위 폴더, ''(드라이브 루트 → 드라이브 목록), null(드라이브 목록 자체). vcsAbove: 이 폴더나 그 위의 저장소(git init 가능 여부)
 */
app.get('/api/fs/dirs', async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) {
    res.status(403).json({ message: 'Folder browsing works only on this PC' })
    return
  }
  res.set('Cache-Control', 'no-store')
  const raw = req.query.path
  const teamNames = teamNameMap(readOffice().teams)
  if (raw === undefined || raw === '') {
    res.json({ path: null, parent: null, entries: await listDrives(teamNames), isTruncated: false, hiddenCount: 0, vcsAbove: null, teamName: null })
    return
  }
  const folder = normalizeFolderPath(raw)
  if (!folder) {
    res.status(400).json({ message: 'Path must be an absolute folder path like D:\\work' })
    return
  }
  const state = await folderState(folder)
  if (state !== 'folder') {
    res.status(404).json({ message: state === 'missing' ? `Folder not found: ${folder}` : `Not a folder: ${folder}` })
    return
  }
  try {
    // skipEntries=1: 목록 없이 이 폴더 판정만 (팀 만들기 창이 적힌 경로의 git init 가능 여부를 물을 때)
    const listing = req.query.skipEntries === '1' ? { entries: [], isTruncated: false, hiddenCount: 0 } : await listSubfolders(folder, teamNames)
    res.json({ path: folder, parent: parentFolderOf(folder), ...listing, vcsAbove: detectVcs(folder), teamName: teamNames.get(normalizeCwd(folder)) ?? null })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') res.status(404).json({ message: `Folder not found: ${folder}` })
    else res.status(code === 'EPERM' || code === 'EACCES' ? 403 : 500).json({ message: `Couldn't read this folder (${code ?? 'error'})` })
  }
})

/** 폴더 고르기 창의 New folder (이 PC 전용). parent 안에 하나만 만든다 — parent 가 없으면 404 */
app.post('/api/fs/mkdir', async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) {
    res.status(403).json({ message: 'Folders can be created only on this PC' })
    return
  }
  const { parent, name } = req.body as { parent?: unknown; name?: unknown }
  const folder = normalizeFolderPath(parent)
  if (!folder) {
    res.status(400).json({ message: 'Parent must be an absolute folder path like D:\\work' })
    return
  }
  const nameError = folderNameError(name)
  if (nameError) {
    res.status(400).json({ message: nameError })
    return
  }
  if ((await folderState(folder)) !== 'folder') {
    res.status(404).json({ message: `Folder not found: ${folder}` })
    return
  }
  try {
    res.json({ path: await createFolder(folder, name as string) })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EEXIST') res.status(409).json({ message: `"${name as string}" already exists in this folder` })
    else if (code === 'ENOENT') res.status(404).json({ message: `Folder not found: ${folder}` })
    else res.status(500).json({ message: `Couldn't create the folder (${code ?? 'error'})` })
  }
})

app.put('/api/team/:teamId/desks/:sessionId', (req, res) => {
  const { dx, dy } = req.body as { dx?: number; dy?: number }
  if (typeof dx !== 'number' || typeof dy !== 'number') {
    res.status(400).end()
    return
  }
  if (!setDesk(req.params.teamId, req.params.sessionId, { dx, dy })) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  res.json({})
  broadcastOffice()
})

/**
 * 방금 이름을 붙인 팀원 (세션 ID → 팀·이름). 호스트가 띄워 세션 목록에 나타나기 전에 같은 팀 팀원을 또 만들면
 * (팀장이 도구를 동시에 부르면) 목록만 봐서는 이름이 겹치므로 잠깐 들고 있는다
 */
const recentMemberNames = new Map<string, { teamId: string; name: string }>()
const RECENT_MEMBER_NAME_MS = 60_000

/** 같은 팀(파트 포함)에 쓰인 이름: 근무·휴식·퇴근 세션 이름 + 방금 붙인 팀원 이름. pickMemberName 이 이 이름들을 피한다 */
async function usedMemberNames(teamId: string): Promise<string[]> {
  const { sessions } = await snapshotPayload()
  return [
    ...sessions.filter((s) => s.teamId === teamId && s.name).map((s) => s.name!),
    ...[...recentMemberNames.values()].filter((recent) => recent.teamId === teamId).map((recent) => recent.name),
  ]
}

/**
 * 세션 추가 모달에 미리 채울 이름 → { name, gender }. name 은 이름만이고 역할은 붙이지 않는다 (화면이 역할 칸에 따로 넣는다).
 * ?role= 은 꼴만 확인한다. 이름 회피는 팀 전체 기준 (?partId= 는 확인만 한다).
 * 추천만 하고 recentMemberNames 에 넣지 않는다 — 모달을 열기만 하고 닫을 수 있어서
 */
app.get('/api/team/:teamId/member-name', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const role = parseMemberRole(req.query.role)
  if (!role) {
    res.status(400).json({ message: 'role must be 1–12 characters with no [ ] or line breaks (e.g. Dev, Lead, PL)' })
    return
  }
  res.json(pickMemberName(await usedMemberNames(unit.team.id)))
})

/**
 * 지휘 단위로 팀원 세션을 띄운다. 팀 직속·worktree 파트는 cwd 판정으로 자동 합류, worktree 없는 파트는 소속을 기록.
 * role 이 있으면 역할(position)로 저장하고 이름은 서버가 골라 성별과 같이 기록한다 (같은 팀 근무·휴식·퇴근 세션에 쓰인 이름은 피한다).
 * name 만 오면 그대로 쓴다 (role 인자가 생기기 전의 팀장 MCP). 옛 꼴 "[역할] 이름" 이면 역할과 이름으로 나눈다.
 * model·effort 가 오면 --model·--effort 로 넘긴다 (빼면 사용자 기본값. 목록 밖이면 400)
 */
app.post('/api/team/:teamId/members', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { team, part } = unit
  const cwd = part?.worktree?.cwd ?? team.cwd
  const { name, role, instruction, permissionMode, model, effort } = req.body as {
    name?: unknown
    role?: unknown
    instruction?: string
    permissionMode?: string
    model?: unknown
    effort?: unknown
  }
  const modelChoice = parseMemberModelChoice({ model, effort })
  if (!modelChoice) {
    res.status(400).json({ message: 'model must be haiku, sonnet, opus or fable, and effort low, medium, high, xhigh or max (omit for the default)' })
    return
  }
  const sessionId = randomUUID()
  let memberName: string | null
  let memberPosition: string | null
  let memberGender: SessionGender | null = null
  if (role != null) {
    memberPosition = parseMemberRole(role)
    if (!memberPosition) {
      res.status(400).json({ message: 'role must be 1–12 characters with no [ ] or line breaks (e.g. FE, BE, QA)' })
      return
    }
    ;({ name: memberName, gender: memberGender } = pickMemberName(await usedMemberNames(team.id)))
  } else if (typeof name === 'string' && name.trim()) {
    ;({ name: memberName, position: memberPosition } = nameAndPosition(name, null))
  } else {
    res.status(400).json({ message: 'role or name required' })
    return
  }
  // claude 쪽 세션 이름(터미널 제목·resume 목록)에는 역할을 붙여 둔다. Pray 화면은 이 값을 읽지 않는다
  const claudeName = memberName ? withPosition(memberName, memberPosition) : `[${memberPosition}]`
  const extraArgs = memberExtraArgs(claudeName, permissionMode ?? 'bypassPermissions', modelChoice)
  const character = await autoCharacterFor({ id: sessionId, isLead: false, gender: memberGender, teamId: team.id })
  // 인물은 spawn 을 보내기 전에 쓴다 — 뒤에 쓰면 호스트가 같은 때 webSessions 를 쓰며(Windows rename 재시도로 길어진다) 덮어써 사라진다(시험 서버 실측)
  if (character) setCharacter(sessionId, character)
  if (part && !part.worktree) setPartOf(team.id, sessionId, part.id)
  // 신뢰 기록은 POST /api/sessions 와 같다. 실패는 결과로 지시자에게 알린다
  const isTrustFailed = markFolderTrusted(cwd) === false
  if (!host.send({ type: 'spawn', sessionId, cwd, extraArgs })) {
    if (part && !part.worktree) setPartOf(team.id, sessionId, null)
    recentCharacters.delete(sessionId)
    if (character) setCharacter(sessionId, null)
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  if (memberName) {
    recentMemberNames.set(sessionId, { teamId: team.id, name: memberName })
    setTimeout(() => recentMemberNames.delete(sessionId), RECENT_MEMBER_NAME_MS)
  }
  // 팀원 이름·역할을 화면에도 보이게
  setSessionName(sessionId, memberName)
  if (memberPosition) setPosition(sessionId, memberPosition)
  if (memberGender) setGender(sessionId, memberGender)
  taskLog.record({
    kind: 'spawn',
    teamId: team.id,
    partId: part?.id ?? null,
    sessionId,
    position: memberPosition,
    model: modelChoice.model,
    effort: modelChoice.effort,
    contextTokens: null,
    idleSince: null,
  })
  const member = { sessionId, name: memberName, position: memberPosition, cwd }
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

/** 팀원 세션 종료 (team_dismiss). 호스트가 기록을 팀장이 정리(released) 퇴근으로 옮긴다 — 보관 기간이 짧다 */
app.delete('/api/team/:teamId/members/:sessionId', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { sessionId } = req.params
  // 지휘 단위의 팀원(웹 세션)만 정리한다. 안 보면 지시자가 다른 팀·파트의 세션이나 자기 자신을 끌 수 있다 (assignTask 와 같은 판정)
  const session = (await snapshotPayload()).sessions.find((s) => s.id === sessionId)
  if (!session || session.teamId !== unit.team.id) {
    res.status(404).json({ message: 'Not a session of this team' })
    return
  }
  if (session.partId !== (unit.part?.id ?? null)) {
    res.status(403).json({ message: "Can't dismiss a session in another unit (directly under the team or another part)" })
    return
  }
  if (session.role !== 'member') {
    res.status(404).json({ message: 'Not a member (web session)' })
    return
  }
  // 운영 기록: 정리 직전 값
  taskLog.record({
    kind: 'dismiss',
    teamId: unit.team.id,
    partId: unit.part?.id ?? null,
    sessionId,
    position: session.position,
    model: session.model,
    effort: session.effort,
    contextTokens: session.contextTokens,
    idleSince: idleSinceOf(session.status, session.turnEndedAt),
  })
  host.send({ type: 'kill', sessionId, isReleased: true })
  tasks.markExited(sessionId)
  res.json({})
})

app.post('/api/team/:teamId/tasks', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { sessionId, instruction } = req.body as { sessionId?: string; instruction?: string }
  if (!sessionId || !instruction?.trim()) {
    res.status(400).json({ message: 'sessionId and instruction required' })
    return
  }
  await assignTask(unit.team, unit.part, sessionId, instruction.trim(), res)
})

/** 화면 Tasks 창용 이름 찾기. 세션 목록(근무·휴식·퇴근)에 있는 것만 */
async function memberLookup(): Promise<MemberLookup> {
  const { sessions } = await snapshotPayload()
  const byId = new Map(sessions.map((s) => [s.id, { name: s.name ?? s.title ?? s.id.slice(0, 8), position: s.position }]))
  return (sessionId) => byId.get(sessionId) ?? null
}

/** 화면 Tasks 창: 팀 하나(모든 파트)의 task 목록(지시 앞부분만)과 팀원 spawn·dismiss 기록 → TaskHistory */
app.get('/api/team/:teamId/tasks', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json(taskHistoryOf(team.id, tasks.list(), taskLog.listEvents(), await memberLookup()))
})

/** 화면 Tasks 창: task 하나 전문 (지시·결과) → { task } */
app.get('/api/team/:teamId/tasks/:taskId', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  const task = taskDetailOf(team.id, tasks.get(req.params.taskId), await memberLookup())
  if (!task) {
    res.status(404).json({ message: 'Task not found' })
    return
  }
  res.set('Cache-Control', 'no-store')
  res.json({ task })
})

/**
 * task 완료까지 롱폴링 → { task, pendingTaskIds }. taskId 가 'any' 면 지휘 단위의 아무 task 하나, `?taskIds=a,b` 면 그중 먼저 끝나는 것.
 * 타임아웃·모르는 task 는 task null. 헤더를 바로 보내고 공백을 흘리며 기다린다 (taskWait.ts)
 */
app.get('/api/team/:teamId/tasks/:taskId/wait', async (req, res) => {
  const unit = findUnit(req.params.teamId, req.query.partId, res)
  if (!unit) return
  const { taskIds, timeoutSec } = parseWaitRequest(req.params.taskId, req.query)
  const partId = unit.part?.id ?? null
  req.socket.setTimeout(0)
  await respondJsonAfter(res, async (signal) => {
    const task = await tasks.wait(unit.team.id, taskIds, timeoutSec * 1000, partId, signal)
    return { task, pendingTaskIds: tasks.pendingIds(unit.team.id, taskIds, partId) }
  })
})

// ---------- 파트 (팀 안의 선택적 지휘 단위) ----------

/**
 * 파트를 만든다. isWorktree 면 저장소 옆 형제 폴더에 worktree·브랜치를 만들고 ~/.claude.json 에 신뢰 표시를 남긴다.
 * 그 자리에 이미 이 저장소의 worktree 나 브랜치 part/<슬러그> 가 있으면 그것으로 연결한다 (응답 isLinked)
 */
app.post('/api/team/:teamId/parts', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  const { name, isWorktree } = req.body as { name?: string; isWorktree?: boolean }
  if (!name?.trim()) {
    res.status(400).json({ message: 'name required' })
    return
  }
  let worktree: Part['worktree']
  let isTrusted = false
  let isLinked = false
  if (isWorktree) {
    const takenFolders = listTeams().flatMap((t) => t.parts.flatMap((p) => (p.worktree ? [p.worktree.cwd] : [])))
    try {
      const prepared = await createWorktree(team.cwd, worktreeSlug(name, randomUUID().slice(0, 8)), takenFolders)
      worktree = { cwd: prepared.cwd, branch: prepared.branch }
      isLinked = prepared.isLinked
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
  res.json({ part, isTrusted, isLinked })
  broadcastOffice()
})

app.patch('/api/team/:teamId/parts/:partId', (req, res) => {
  const part = updatePart(req.params.teamId, req.params.partId, req.body as PartPatch)
  if (!part) {
    res.status(404).json({ message: 'Part not found' })
    return
  }
  res.json(part)
  broadcastOffice()
})

/**
 * 파트 기록과 소속 기록을 지운다. worktree 파트면 그 폴더(git worktree remove)와 브랜치도 지운다:
 * 그 폴더(하위 폴더 포함)에 근무 중인 세션이 있거나 커밋하지 않은 변경이 있으면 409, 브랜치가 HEAD 에 병합되지 않았으면
 * ?branch=delete(-D)·keep 이 없을 때 409 { code: 'branch-unmerged', branch }. 지우던 중 git 이 실패하면 500 { message, isPartRemoved }
 */
app.delete('/api/team/:teamId/parts/:partId', async (req, res) => {
  const team = findTeam(req.params.teamId)
  const part = team?.parts.find((p) => p.id === req.params.partId)
  if (!team || !part) {
    res.status(404).json({ message: 'Part not found' })
    return
  }
  const finish = () => {
    removePart(team.id, part.id)
    broadcastOffice()
    void broadcast()
  }
  if (!part.worktree) {
    finish()
    res.json({})
    return
  }
  const { branch } = req.query
  const choice: BranchChoice = branch === 'delete' || branch === 'keep' ? branch : null
  if (branch !== undefined && choice === null) {
    res.status(400).json({ message: 'branch must be delete or keep' })
    return
  }
  // 하위 폴더에서 일하는 세션도 막는다 — Windows 에서 폴더를 쓰는 프로세스가 있으면 git 이 파일만 지우고 폴더를 못 지운다
  const folder = normalizeCwd(part.worktree.cwd)
  const { sessions } = await snapshotPayload()
  const busy = sessions.filter((s) => {
    const cwd = normalizeCwd(s.cwd)
    return s.isAlive && (cwd === folder || cwd.startsWith(`${folder}/`))
  })
  if (busy.length > 0) {
    const names = busy.map((s) => s.name ?? s.title ?? s.id.slice(0, 8)).join(', ')
    res.status(409).json({ message: `End the sessions in the worktree folder first: ${busy.length} on duty (${names})` })
    return
  }
  let removal
  try {
    removal = await removeWorktree(team.cwd, part.worktree, choice)
  } catch (error) {
    if (error instanceof WorktreeError) {
      res.status(error.status).json({ message: error.message })
      return
    }
    throw error
  }
  if (removal.outcome === 'dirty') {
    res.status(409).json({ message: `Uncommitted changes, so nothing was deleted (commit or clean up, then try again): ${part.worktree.cwd}` })
    return
  }
  if (removal.outcome === 'branch-unmerged') {
    const unmerged = part.worktree.branch
    res.status(409).json({ code: 'branch-unmerged', branch: unmerged, message: `Branch ${unmerged} is not merged` })
    return
  }
  if (removal.outcome === 'failed') {
    if (removal.isWorktreeGone) finish()
    const record = removal.isWorktreeGone ? 'Part record deleted' : 'Part record kept'
    res.status(500).json({ message: `${removal.message}. ${record}`, isPartRemoved: removal.isWorktreeGone })
    return
  }
  finish()
  res.json({ folder: removal.folder, branch: removal.branch })
})

/** 팀 폴더 세션의 파트 이동 (partId null = 팀 직속). worktree 세션은 폴더로 정해지고, 지시자는 옮기면 지휘를 잃어 거부 */
app.put('/api/team/:teamId/partOf/:sessionId', async (req, res) => {
  const team = findTeam(req.params.teamId)
  if (!team) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  const { partId } = req.body as { partId?: unknown }
  if (partId !== null && typeof partId !== 'string') {
    res.status(400).json({ message: 'partId required (null = directly under the team)' })
    return
  }
  const sessionId = req.params.sessionId
  const { sessions } = await snapshotPayload()
  const session = sessions.find((s) => s.id === sessionId)
  if (!session || session.teamId !== team.id) {
    res.status(404).json({ message: 'Not a session of this team' })
    return
  }
  if (normalizeCwd(session.cwd) !== normalizeCwd(team.cwd)) {
    res.status(409).json({ message: "A session in a worktree folder belongs to that part by folder and can't be moved" })
    return
  }
  if (team.leadSessionId === sessionId || team.parts.some((p) => p.leadSessionId === sessionId)) {
    res.status(409).json({ message: "Leads and part leads can't be moved (unassign first)" })
    return
  }
  try {
    setPartOf(team.id, sessionId, partId)
  } catch (error) {
    if (error instanceof PartNotFoundError) {
      res.status(404).json({ message: 'Part not found' })
      return
    }
    if (error instanceof WorktreePartError) {
      res.status(409).json({ message: "A worktree part's members are set by folder and can't be changed" })
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
    res.status(503).json({ message: 'Not connected to session host' })
    return
  }
  res.json({})
})

/** 서버가 스스로 종료한다. 트레이 앱이 새 코드로 다시 띄운다 (작업 스케줄러 방식·npm run dev 에서는 다시 뜨지 않음) */
app.post('/api/server/restart', (_req, res) => {
  // 0 은 "의도한 중지" 라 트레이가 다시 띄우지 않는다. 응답을 다 보낸 뒤 나간다
  res.on('finish', () => {
    console.log('restart 요청 → 종료 코드 2 로 나감 (트레이 앱이 다시 띄움)')
    process.exit(2)
  })
  res.json({})
})

app.get('/api/office', (_req, res) => {
  res.json(readOfficeWithVcs())
})

/** 팀이 없는 그룹만 지운다 (팀이 있으면 409) */
app.delete('/api/groups/:id', (req, res) => {
  try {
    if (!removeGroup(req.params.id)) {
      res.status(404).json({ message: 'Group not found' })
      return
    }
  } catch (error) {
    if (error instanceof GroupNotEmptyError) {
      res.status(409).json({ message: "Can't delete a group that has teams. Move or delete its teams first" })
      return
    }
    throw error
  }
  res.json({})
  broadcastOffice()
})

/** x·y 는 화면이 빈 자리를 찾아 준다. 없으면 hq 가 정한다 */
app.post('/api/groups', (req, res) => {
  const { name, x, y } = req.body as { name?: string; x?: unknown; y?: unknown }
  if (!name?.trim()) {
    res.status(400).json({ message: 'Name required' })
    return
  }
  res.json(addGroup(name.trim(), { x, y }))
  broadcastOffice()
})

/** 목록의 그룹 순서. ids 는 지금 있는 그룹 전부 (다르면 400) */
app.put('/api/groups/order', (req, res) => {
  const { ids } = req.body as { ids?: unknown }
  if (!isIdList(ids)) {
    res.status(400).json({ message: 'ids (array of strings) required' })
    return
  }
  try {
    res.json(reorderGroups(ids))
  } catch (error) {
    if (error instanceof OrderMismatchError) {
      res.status(400).json({ message: "IDs don't match the current list (missing, unknown or duplicate). Reload and try again" })
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
    res.status(400).json({ message: 'ids (array of strings) required' })
    return
  }
  try {
    const teams = reorderTeams(req.params.groupId, ids)
    if (!teams) {
      res.status(404).json({ message: 'Group not found' })
      return
    }
    res.json(teams)
  } catch (error) {
    if (error instanceof OrderMismatchError) {
      res.status(400).json({ message: "IDs don't match the current list (missing, unknown or duplicate). Reload and try again" })
      return
    }
    throw error
  }
  broadcastOffice()
})

function isIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string')
}

/** x·y 가 바뀌면 그 그룹 팀들의 앵커도 같은 만큼 옮긴다 (hq updateGroup) */
app.patch('/api/groups/:id', (req, res) => {
  const group = updateGroup(req.params.id, req.body as Partial<Omit<Group, 'id'>>)
  if (!group) {
    res.status(404).end()
    return
  }
  res.json(group)
  broadcastOffice()
})

// ---------- 팀 할 일 (배열 순서 = 표시 순서. hq 가 늘 [할 일…, 완료…] 로 나눠 둔다) ----------

const TODO_TEXT_MESSAGE = 'Text must be 1 to 500 characters'

/** 할 일 구역 맨 끝(첫 완료 앞)에 넣는다 */
app.post('/api/team/:teamId/todos', (req, res) => {
  const text = parseTodoText(((req.body ?? {}) as { text?: unknown }).text)
  if (text === null) {
    res.status(400).json({ message: TODO_TEXT_MESSAGE })
    return
  }
  const todo = addTodo(req.params.teamId, text)
  if (!todo) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  res.json({ todo })
  broadcastOffice()
})

/** 할 일(미완료) 구역 순서. ids 는 지금 할 일 전부 (다르면 400). 완료 구역은 그대로. `:todoId` 라우트보다 앞에 둔다 */
app.put('/api/team/:teamId/todos/order', (req, res) => {
  const { ids } = (req.body ?? {}) as { ids?: unknown }
  if (!isIdList(ids)) {
    res.status(400).json({ message: 'ids (array of strings) required' })
    return
  }
  try {
    if (!reorderTodos(req.params.teamId, ids)) {
      res.status(404).json({ message: 'Team not found' })
      return
    }
  } catch (error) {
    if (error instanceof OrderMismatchError) {
      res.status(400).json({ message: "IDs don't match the current list (missing, unknown or duplicate). Reload and try again" })
      return
    }
    throw error
  }
  res.json({})
  broadcastOffice()
})

/** 글·완료 변경. 완료가 되면 맨 끝, 되돌리면 할 일 구역 맨 끝으로 (hq updateTodo) */
app.patch('/api/team/:teamId/todos/:todoId', (req, res) => {
  const body = (req.body ?? {}) as { text?: unknown; isDone?: unknown }
  if (body.text === undefined && body.isDone === undefined) {
    res.status(400).json({ message: 'text or isDone required' })
    return
  }
  if (body.isDone !== undefined && typeof body.isDone !== 'boolean') {
    res.status(400).json({ message: 'isDone must be true or false' })
    return
  }
  const text = body.text === undefined ? undefined : parseTodoText(body.text)
  if (text === null) {
    res.status(400).json({ message: TODO_TEXT_MESSAGE })
    return
  }
  try {
    const todo = updateTodo(req.params.teamId, req.params.todoId, {
      text,
      isDone: typeof body.isDone === 'boolean' ? body.isDone : undefined,
    })
    if (!todo) {
      res.status(404).json({ message: 'Team not found' })
      return
    }
    res.json({ todo })
  } catch (error) {
    if (error instanceof TodoNotFoundError) {
      res.status(404).json({ message: 'To-do not found' })
      return
    }
    throw error
  }
  broadcastOffice()
})

/** 완료한 할 일 모두 삭제. 할 일 ID 는 randomUUID 앞 8자리 hex 라 "done" 과 겹치지 않는다. `:todoId` 라우트보다 앞에 둔다 */
app.delete('/api/team/:teamId/todos/done', (req, res) => {
  const removedCount = clearDoneTodos(req.params.teamId)
  if (removedCount === null) {
    res.status(404).json({ message: 'Team not found' })
    return
  }
  res.json({ removed: removedCount })
  if (removedCount > 0) broadcastOffice()
})

app.delete('/api/team/:teamId/todos/:todoId', (req, res) => {
  try {
    if (!removeTodo(req.params.teamId, req.params.todoId)) {
      res.status(404).json({ message: 'Team not found' })
      return
    }
  } catch (error) {
    if (error instanceof TodoNotFoundError) {
      res.status(404).json({ message: 'To-do not found' })
      return
    }
    throw error
  }
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
 * mod 가 알리는 입력칸 변경 (↑ 로 꺼냄·응답 전 중지로 글이 돌아옴(engine)·자기 fill·빈 입력칸) `{ sessionId, text, origin }`.
 * 대기 메시지 취소나 중지가 진행 중일 때만 답한다: { fill } = 입력칸을 그 글로 바꿔라.
 * 대기 취소는 fill 한 글이 그대로 들어온 것을 확인하면 서버가 pty 에 Enter 를 보낸다. 중지는 돌아온 글을 기억하고 { fill: '' } 로 비운다.
 * 진행 중인 것이 없으면 {} (평소에는 아무 일도 없다). suggestion 과 같은 이유로 인증 예외가 아니다 (mod 는 loopback 으로 통과)
 */
app.post('/api/hook/prompt-box', (req, res) => {
  const { sessionId, text, origin } = (req.body ?? {}) as { sessionId?: unknown; text?: unknown; origin?: unknown }
  if (typeof sessionId !== 'string' || typeof text !== 'string' || typeof origin !== 'string') {
    res.status(400).end()
    return
  }
  const progress = unqueues.get(sessionId)
  if (!progress) {
    const box = interrupts.get(sessionId)
    if (!box) {
      res.json({})
      return
    }
    const answer = answerInterruptBox(box, text, origin)
    // 중지 라우트가 같은 객체를 지켜본다
    Object.assign(box, answer.box)
    res.json(answer.reply)
    return
  }
  const answer = answerBox(progress, text, origin)
  progress.step = answer.step
  if (answer.isEnterNeeded) host.send({ type: 'input', sessionId, data: '\r' })
  res.json(answer.reply)
})

/**
 * mod 가 곁가지 질문을 받아 간다 (`/pray-btw <요청 ID>` 를 실행할 때). `?sessionId=` 의 pending 요청이면 `{ question, history }`, 아니면 404.
 * suggestion 과 같은 이유로 인증 예외가 아니다 (mod 는 loopback 으로 통과)
 */
app.get('/api/hook/btw/:requestId', (req, res) => {
  const request = btw.request(String(req.query.sessionId ?? ''), req.params.requestId)
  if (!request) {
    res.status(404).json({ message: 'Unknown side question' })
    return
  }
  res.json(request)
})

/** mod 가 보낸 fork 결과 (ModelForkResult 그대로). pending 요청이 아니면(지움·시간 초과) 404 */
app.post('/api/hook/btw/:requestId', (req, res) => {
  const sessionId = String(req.query.sessionId ?? '')
  const { requestId } = req.params
  const result = parseBtwResult(req.body)
  if (!result) {
    res.status(400).end()
    return
  }
  if (!btw.settle(sessionId, requestId, result)) {
    res.status(404).json({ message: 'Unknown side question' })
    return
  }
  const entry = btwTimers.get(requestId)
  if (entry) clearTimeout(entry.timer)
  btwTimers.delete(requestId)
  const usage = (req.body as { usage?: { cache_read_input_tokens?: unknown } }).usage
  console.log(`곁가지 질문 ${result.isAnswered ? '답' : `실패: ${result.message}`} (${sessionId.slice(0, 8)}, 캐시 읽기 ${usage?.cache_read_input_tokens ?? '?'})`)
  res.status(204).end()
  broadcastBtw(sessionId)
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
  sendSse(res, 'flow', flowPoller.status())
  void broadcast()
})

host.on('reachable', (isReachable: boolean) => {
  // 연결이 끊기면 웹 세션 목록도 빈다. 호스트가 재시작했으면 세션이 --resume 으로 새로 떠 옛 제안은 쓸모없다
  if (!isReachable) {
    suggestions.clear()
    unqueues.clear()
    for (const { timer } of btwTimers.values()) clearTimeout(timer)
    btwTimers.clear()
    for (const sessionId of btw.clearAll()) broadcastBtw(sessionId)
  }
  void broadcast()
})
host.on('message', (message: HostMessage) => {
  if (message.type === 'output') lastOutputAt.set(message.sessionId, Date.now())
  if (message.type === 'exit') {
    lastOutputAt.delete(message.sessionId)
    suggestions.delete(message.sessionId)
    unqueues.delete(message.sessionId)
    if (clearBtw(message.sessionId)) broadcastBtw(message.sessionId)
    tasks.markExited(message.sessionId)
    releaseQuestion(message.sessionId)
  }
  if (message.type === 'sessions' || message.type === 'exit') void broadcast()
})
host.start()

const watcher = new TranscriptWatcher(projectsDir)
watcher.on('change', (sessionId: string) => {
  for (const res of subscribers) sendSse(res, 'transcript', { sessionId })
})

/**
 * 재시작 전에 running 이던 task 를 jsonl 로 정리한다 (teamState.ts restoredOutcome). 그 사이 못 받은 Stop 때문에 영영 running 으로 남지 않게.
 * 요청 처리 밖이라 목록(hq.json)을 못 읽으면 로그만 남기고 5초 뒤 다시 한다
 */
let isReconcileFailing = false
async function reconcileRestoredTasks(): Promise<void> {
  if (!tasks.hasUnreconciled()) return
  try {
    const { sessions } = await snapshotPayload()
    const members = new Map<string, RestoredMember>()
    for (const task of tasks.list()) {
      if (task.status !== 'running' || members.has(task.memberSessionId)) continue
      const session = sessions.find((s) => s.id === task.memberSessionId)
      const summary = session ? await findTranscriptSummary(session.id) : null
      members.set(task.memberSessionId, {
        isAlive: session?.isAlive ?? false,
        turnEndedAt: summary?.turnEndedAt ?? null,
        turn: summary?.turn ?? null,
      })
    }
    tasks.reconcileRestored((id) => members.get(id) ?? null)
    isReconcileFailing = false
  } catch (error) {
    if (!isReconcileFailing) console.error(`되살린 task 정리 실패 (5초 뒤 다시): ${error}`)
    isReconcileFailing = true
  }
}
void reconcileRestoredTasks()

setInterval(() => void broadcast(), 5000)
setInterval(() => void reconcileRestoredTasks(), 5000)
setInterval(() => tasks.expireUnacknowledged(), 1000)
void flowPoller.check()
setInterval(() => void flowPoller.check(), FLOW_POLL_MS)

// 예전 그룹 대기 메모(waitingNote)를 할 일로 한 번 옮긴다. 요청 처리 밖이라 hq.json 을 못 읽어도 죽지 않게 로그만 (다음 시작 때 다시 한다)
try {
  const migratedCount = migrateWaitingNotes()
  if (migratedCount > 0) console.log(`그룹 대기 메모 ${migratedCount}개를 할 일로 옮김`)
} catch (error) {
  console.error(`그룹 대기 메모 옮기기 실패: ${error}`)
}
// 그룹 할 일을 팀 할 일로 한 번 옮긴다. 위와 같이 실패는 로그만 (다음 시작 때 다시 한다)
try {
  const { moves, leftBehind } = migrateGroupTodosToTeams()
  for (const move of moves) console.log(`그룹 ${move.groupId} 의 할 일 ${move.count}개를 팀 ${move.teamId} 로 옮김`)
  for (const left of leftBehind) console.log(`팀이 없는 그룹 ${left.groupId} 의 할 일 ${left.count}개는 옮기지 않고 둠`)
} catch (error) {
  console.error(`그룹 할 일 옮기기 실패: ${error}`)
}
// 옛 세션 이름 "[역할] 이름" 을 역할과 이름으로 한 번 나눈다. 위와 같이 실패는 로그만 (다음 시작 때 다시 한다)
try {
  const migratedCount = migratePositionNames()
  if (migratedCount > 0) console.log(`세션 이름 ${migratedCount}개에서 역할을 떼어 따로 저장함`)
} catch (error) {
  console.error(`세션 이름 역할 옮기기 실패: ${error}`)
}

// 빌드된 웹이 있으면 서버 하나로 화면까지 제공한다 (개발 중에는 Vite 4711 을 쓴다)
const webDist = join(import.meta.dirname, '..', '..', 'web', 'dist')
if (existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('/{*path}', (_req, res) => res.sendFile(join(webDist, 'index.html')))
}

app.listen(PORT, config.bind, () => {
  console.log(`Pray server http://${config.bind}:${PORT} (메일 로그인 ${sendCode ? '사용' : '미설정'})`)
})
