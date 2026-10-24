import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { serialRunner } from './serialRunner.js'

/** 플로우(flow.team) 공식 API. 응답은 `{ response: { success, code, message, data | error } }` 로 감싸져 온다 */
const FLOW_URL = 'https://api.flow.team'
export const flowKeyPath = join(homedir(), '.claude', 'flow-key.env')
const REQUEST_TIMEOUT_MS = 10_000
/** 플로우의 size 최대값 */
const MAX_PAGE_SIZE = 100
/** 안 읽은 알림·채팅방을 셀 때 따라가는 쪽 수 한계. 플로우 속도 제한(경로마다 분당 120회) 안에서 폴링 한 번이 끝나게 */
const MAX_COUNT_PAGES = 20
/** 모르는 projectId 가 나와도 프로젝트 목록은 이 간격보다 자주 다시 받지 않는다 (참여하지 않는 프로젝트의 알림이 계속 다시 받게 하지 않게) */
const PROJECT_REFETCH_MS = 60_000

export type FlowFetch = (url: string, init: RequestInit) => Promise<Response>

/** 화면에 그대로 돌려줄 상태코드와 영어 문구. 키 값은 문구에 넣지 않는다 */
export class FlowError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const FLOW_KEY_MISSING_MESSAGE = 'No Flow API key: add a FLOW_API_KEY=<key> line to ~/.claude/flow-key.env'

/** `FLOW_API_KEY=` 줄의 값. 파일이 없거나 줄이 없거나 값이 비면 null */
export async function readFlowKey(path = flowKeyPath): Promise<string | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return null
  }
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.startsWith('FLOW_API_KEY=')) continue
    const key = line.slice('FLOW_API_KEY='.length).trim()
    return key || null
  }
  return null
}

/** 공식 알림 항목 (`GET /user/alarms`). id 는 모두 문자열이고 없으면 "-1" */
interface RawAlarm {
  alarmId: string
  projectId: string
  postId: string
  remarkId: string
  replyId: string
  registerId: string
  registerName: string
  registeredDateTime: string
  message: string | null
  content: string
  readYn: string
  mentionYn: string
  workerYn: string
  registrantYn: string
}

export interface FlowAlarm {
  alarmId: string
  projectId: string
  /** 참여 프로젝트 목록에 없으면 null */
  projectName: string | null
  postId: string
  /** 댓글 알림이 아니면 "-1" */
  remarkId: string
  /** 답글 알림이 아니면 "-1" */
  replyId: string
  registerId: string
  registerName: string
  /** 플로우 원본 YYYYMMDDHHmmss (한국 시각) */
  registeredDateTime: string
  /** 같은 시각의 ISO 8601 (`+09:00`). 꼴이 틀리면 null */
  registeredAt: string | null
  message: string | null
  content: string
  isRead: boolean
  isMention: boolean
  isWorker: boolean
  isRegistrant: boolean
}

export interface FlowAlarmPage {
  alarms: FlowAlarm[]
  hasNext: boolean
  /** 다음 쪽을 받을 cursor. 마지막 쪽이면 null */
  nextCursor: string | null
}

export interface AlarmQuery {
  readYn?: 'Y' | 'N'
  cursor?: string
}

/** YYYYMMDDHHmmss (한국 시각) → `YYYY-MM-DDTHH:mm:ss+09:00` */
export function koreanDateTimeToIso(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+09:00`
}

function toAlarm(raw: RawAlarm, projectName: string | null): FlowAlarm {
  return {
    alarmId: raw.alarmId,
    projectId: raw.projectId,
    projectName,
    postId: raw.postId,
    remarkId: raw.remarkId,
    replyId: raw.replyId,
    registerId: raw.registerId,
    registerName: raw.registerName,
    registeredDateTime: raw.registeredDateTime,
    registeredAt: koreanDateTimeToIso(raw.registeredDateTime),
    message: raw.message ?? null,
    content: raw.content ?? '',
    isRead: raw.readYn === 'Y',
    isMention: raw.mentionYn === 'Y',
    isWorker: raw.workerYn === 'Y',
    isRegistrant: raw.registrantYn === 'Y',
  }
}

interface Page<T> {
  hasNext: boolean
  lastCursor: number
  items: T[]
}

export interface FlowClientOptions {
  fetch?: FlowFetch
  keyPath?: string
  now?: () => number
}

export function makeFlowClient({ fetch: doFetch = fetch, keyPath = flowKeyPath, now = Date.now }: FlowClientOptions = {}) {
  let projectNames: Map<string, string> | null = null
  let projectsFetchedAt = 0

  /** 키를 요청마다 읽는다 (파일을 바꾸면 서버 재시작 없이 반영). 실패는 모두 FlowError */
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const key = await readFlowKey(keyPath)
    if (!key) throw new FlowError(503, FLOW_KEY_MISSING_MESSAGE)
    let response: Response
    try {
      response = await doFetch(FLOW_URL + path, {
        method,
        headers: { 'x-flow-api-key': key, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      throw new FlowError(502, `Couldn't connect to Flow: ${(error as Error).message}`)
    }
    let parsed: { response?: { success?: boolean; data?: unknown; error?: { message?: string } } }
    try {
      parsed = await response.json()
    } catch {
      throw new FlowError(502, `Couldn't parse the Flow response (HTTP ${response.status})`)
    }
    const wrapped = parsed?.response
    if (response.ok && wrapped?.success) return wrapped.data
    const detail = wrapped?.error?.message
    // 화면에서 401 은 "로그인 필요" 라 플로우 키 거부는 502 로 바꾼다
    if (response.status === 401) throw new FlowError(502, `Flow API key is invalid${detail ? `: ${detail}` : ''}`)
    if (response.status === 429) throw new FlowError(429, 'Flow rate limit exceeded (120 requests per minute per path). Try again shortly')
    throw new FlowError(502, `Flow error (HTTP ${response.status})${detail ? `: ${detail}` : ''}`)
  }

  async function alarmPage(query: { readYn?: 'Y' | 'N'; cursor?: string; size: number }): Promise<Page<RawAlarm>> {
    const params = new URLSearchParams()
    if (query.readYn) params.set('readYn', query.readYn)
    if (query.cursor !== undefined) params.set('cursor', query.cursor)
    params.set('size', String(query.size))
    const data = (await call('GET', `/user/alarms?${params}`)) as {
      alarms?: { hasNext?: boolean; lastCursor?: number; alarms?: RawAlarm[] }
    }
    const page = data?.alarms
    return { hasNext: page?.hasNext === true, lastCursor: page?.lastCursor ?? -1, items: page?.alarms ?? [] }
  }

  async function chatPage(cursor: string | undefined): Promise<Page<{ unreadCount?: number }>> {
    const params = new URLSearchParams({ size: String(MAX_PAGE_SIZE) })
    if (cursor !== undefined) params.set('cursor', cursor)
    const data = (await call('GET', `/user/chats?${params}`)) as {
      hasNext?: boolean
      lastCursor?: number
      chatRooms?: { unreadCount?: number }[]
    }
    return { hasNext: data?.hasNext === true, lastCursor: data?.lastCursor ?? -1, items: data?.chatRooms ?? [] }
  }

  /**
   * 마지막 쪽까지 따라간다. 알림의 cursor 는 순번, 채팅의 cursor 는 쪽 번호지만 둘 다 lastCursor 를 다음 cursor 로 넘긴다.
   * 마지막 쪽의 lastCursor 는 다음 시작점이 아니므로 hasNext 로 멈춘다
   */
  async function countAll<T>(load: (cursor: string | undefined) => Promise<Page<T>>, count: (items: T[]) => number): Promise<number> {
    let total = 0
    let cursor: string | undefined
    for (let pageIndex = 0; pageIndex < MAX_COUNT_PAGES; pageIndex++) {
      const page = await load(cursor)
      total += count(page.items)
      if (!page.hasNext) break
      cursor = String(page.lastCursor)
    }
    return total
  }

  /** projectId → 이름. 모르는 id 가 있으면 (PROJECT_REFETCH_MS 에 한 번까지) 다시 받는다 */
  async function namesFor(projectIds: string[]): Promise<Map<string, string>> {
    const hasUnknown = !projectNames || projectIds.some((id) => !projectNames!.has(id))
    if (hasUnknown && (!projectNames || now() - projectsFetchedAt >= PROJECT_REFETCH_MS)) {
      const data = (await call('GET', '/user/projects/participants')) as { projects?: { projectId: string; title: string }[] }
      projectNames = new Map((data?.projects ?? []).map((project) => [project.projectId, project.title]))
      projectsFetchedAt = now()
    }
    return projectNames ?? new Map()
  }

  return {
    hasKey: async () => (await readFlowKey(keyPath)) !== null,

    /** 화면용 알림 목록 한 쪽 (size 50) + 프로젝트 이름 */
    async listAlarms(query: AlarmQuery): Promise<FlowAlarmPage> {
      const page = await alarmPage({ ...query, size: 50 })
      const names = page.items.length ? await namesFor(page.items.map((alarm) => alarm.projectId)) : new Map<string, string>()
      return {
        alarms: page.items.map((alarm) => toAlarm(alarm, names.get(alarm.projectId) ?? null)),
        hasNext: page.hasNext,
        nextCursor: page.hasNext ? String(page.lastCursor) : null,
      }
    },

    countUnreadAlarms: () => countAll((cursor) => alarmPage({ readYn: 'N', cursor, size: MAX_PAGE_SIZE }), (items) => items.length),

    countUnreadChats: () =>
      countAll(chatPage, (rooms) => rooms.reduce((sum, room) => sum + (typeof room.unreadCount === 'number' ? room.unreadCount : 0), 0)),

    async readAlarm(alarmId: string): Promise<void> {
      await call('PATCH', '/user/alarms/read', { alarmId })
    },

    async readAllAlarms(): Promise<void> {
      await call('PATCH', '/user/alarms/read/all', {})
    },
  }
}

export type FlowClient = ReturnType<typeof makeFlowClient>

export interface FlowStatus {
  /** 키 파일에 FLOW_API_KEY 가 있는지. 서버가 막 떠 아직 확인 전이면 true (수는 null) */
  isConfigured: boolean
  /** 안 읽은 알림 수. 한 번도 못 셌으면 null */
  unreadAlarmCount: number | null
  /** 채팅방 안 읽은 메시지 수 합계. 한 번도 못 셌으면 null */
  unreadChatCount: number | null
  /** 위 두 수를 마지막으로 센 시각 (ISO). 없으면 null */
  checkedAt: string | null
  /** 마지막 확인이 실패했으면 그 이유 (수는 그 전 성공 값 그대로). 성공했으면 null */
  error: string | null
}

export const INITIAL_FLOW_STATUS: FlowStatus = {
  isConfigured: false,
  unreadAlarmCount: null,
  unreadChatCount: null,
  checkedAt: null,
  error: null,
}

/** 서버가 막 떠 아직 한 번도 확인하지 않은 상태. 키 없음(INITIAL_FLOW_STATUS)과 가르려고 isConfigured 를 true 로 두고 수는 비운다 (화면은 "…") */
export const UNCHECKED_FLOW_STATUS: FlowStatus = { ...INITIAL_FLOW_STATUS, isConfigured: true }

/** 한 번 확인한 결과로 다음 상태를 만든다 (순수). 키가 없으면 수를 비우고, 오류면 앞 수를 남긴다 */
export function nextFlowStatus(
  previous: FlowStatus,
  result: { kind: 'no-key' } | { kind: 'ok'; alarms: number; chats: number } | { kind: 'error'; message: string },
  now: Date,
): FlowStatus {
  if (result.kind === 'no-key') return INITIAL_FLOW_STATUS
  if (result.kind === 'error') return { ...previous, isConfigured: true, error: result.message }
  return { isConfigured: true, unreadAlarmCount: result.alarms, unreadChatCount: result.chats, checkedAt: now.toISOString(), error: null }
}

/** 화면에 알릴 만큼 바뀌었는지 (checkedAt 은 확인할 때마다 바뀌므로 보지 않는다) */
export function isFlowStatusChanged(previous: FlowStatus, next: FlowStatus): boolean {
  return (
    previous.isConfigured !== next.isConfigured ||
    previous.unreadAlarmCount !== next.unreadAlarmCount ||
    previous.unreadChatCount !== next.unreadChatCount ||
    previous.error !== next.error
  )
}

/**
 * 안 읽은 알림·채팅 수를 확인해 메모리에 두고, 바뀌었을 때만 onChange 를 부른다.
 * 요청 처리 밖(주기 타이머)에서도 부르므로 `check` 는 던지지 않는다. 겹쳐 부르면 serialRunner 가 한 번으로 합친다
 */
export function makeFlowPoller(client: FlowClient, onChange: (status: FlowStatus) => void, now = () => new Date()) {
  let status = UNCHECKED_FLOW_STATUS

  async function checkOnce(): Promise<void> {
    let result: Parameters<typeof nextFlowStatus>[1]
    if (!(await client.hasKey())) {
      result = { kind: 'no-key' }
    } else {
      try {
        const [alarms, chats] = await Promise.all([client.countUnreadAlarms(), client.countUnreadChats()])
        result = { kind: 'ok', alarms, chats }
      } catch (error) {
        result = { kind: 'error', message: error instanceof FlowError ? error.message : `Flow check failed: ${error}` }
      }
    }
    const next = nextFlowStatus(status, result, now())
    const isChanged = isFlowStatusChanged(status, next)
    if (isChanged && next.error && next.error !== status.error) console.error(`플로우 확인 실패: ${next.error}`)
    if (isChanged && next.checkedAt && !next.error && status.error) console.log('플로우 확인 복구')
    status = next
    if (isChanged) onChange(status)
  }

  return {
    status: () => status,
    check: serialRunner(checkOnce, (error) => console.error(`플로우 확인 실패: ${error}`)),
  }
}
