/**
 * 세션 알림(Done·My turn·Needs approval·Hand over)과 알림(Reminders) 알림의 판정·글자. 순수 함수.
 * 서버의 알림 스트림(`GET /api/notifications/stream`, server/src/noticeStream.ts)이 쓴다.
 * 트레이는 CommonJS 빌드라 `@pray/host` 의 .ts 를 require 하지 못해 `desktop/src/notify.ts`·`reminderNotice.ts` 에 같은 규칙 사본이 있다 —
 * 규칙을 고치면 같이 고친다 (`sessionNotice.test.ts` 가 desktop 사본과 같은 결과인지 본다)
 */
import type { Reminder } from './reminder.js'

/** 서버 세션 목록(`Session`)의 알림에 쓰는 필드 */
export interface NotifySession {
  id: string
  name: string | null
  position?: string | null
  title: string | null
  status: string
  isAlive: boolean
  lastAssistantText: string | null
  pendingTool: string | null
  role: 'lead' | 'member' | null
  /** 속한 팀 ID (팀 없으면 null) */
  teamId?: string | null
  /** 속한 파트 ID (팀 직속이면 null) */
  partId?: string | null
  /** 세션 문맥 크기(토큰) */
  contextTokens?: number | null
}

export type NotifyKind = 'done' | 'my-turn' | 'needs-approval' | 'hand-over'

/** 문맥 경고 단계 기준. web/src/contextSize.ts·desktop/src/notify.ts 의 CONTEXT_WARN_TOKENS 와 같아야 한다 */
export const CONTEXT_WARN_TOKENS = 150_000

export interface SessionNotice {
  sessionId: string
  kind: NotifyKind
  title: string
  body: string
}

const BODY_MAX_LENGTH = 120
const KIND_LABELS: Record<NotifyKind, string> = { done: 'Done', 'my-turn': 'My turn', 'needs-approval': 'Needs approval', 'hand-over': 'Hand over' }

/** 세션 ID → 직전 회차의 표시 상태와 문맥이 경고 단계였는지. 근무 중인 세션만 든다 */
export type StatusBaseline = Map<string, { status: string; isContextWarned: boolean }>

function isContextWarned(session: NotifySession): boolean {
  return typeof session.contextTokens === 'number' && session.contextTokens >= CONTEXT_WARN_TOKENS
}

/**
 * 직전 상태와 비교해 알릴 것을 고른다. previous 가 null 이면(첫 회차) 기준만 잡는다.
 * - working·waiting → done·my-turn: 팀원(role member)이 아닌 세션만
 * - needs-approval 이 새로 됨: 모든 세션
 * - 팀장·파트장(role lead)의 문맥이 경고 단계(15만↑)로 새로 들어감: "Hand over". 압축으로 내려갔다 다시 넘으면 또 알린다. 위 판정과 독립이라 같은 회차에 둘 다 나올 수 있다
 * 근무 중이 아닌 세션은 기준에서 빠져, 다시 근무가 된 첫 회차(호스트 재시작 뒤 --resume 등)도 기준만 잡는다
 */
export function diffSessions(
  previous: StatusBaseline | null,
  sessions: readonly NotifySession[],
): { next: StatusBaseline; notices: SessionNotice[] } {
  const next: StatusBaseline = new Map()
  const notices: SessionNotice[] = []
  for (const session of sessions) {
    if (!session.isAlive) continue
    const isWarned = isContextWarned(session)
    next.set(session.id, { status: session.status, isContextWarned: isWarned })
    const before = previous?.get(session.id)
    if (before === undefined) continue
    const kinds: NotifyKind[] = []
    const kind = noticeKind(before.status, session)
    if (kind) kinds.push(kind)
    if (session.role === 'lead' && isWarned && !before.isContextWarned) kinds.push('hand-over')
    for (const each of kinds) notices.push({ sessionId: session.id, kind: each, title: noticeTitle(session, each), body: noticeBody(session, each) })
  }
  return { next, notices }
}

/** 상태 전환 하나의 알림 종류 (hand-over 는 diffSessions 가 따로 본다) */
export function noticeKind(before: string, session: NotifySession): NotifyKind | null {
  if (session.status === 'needs-approval') return before === 'needs-approval' ? null : 'needs-approval'
  if (session.role === 'member') return null
  const wasBusy = before === 'working' || before === 'waiting'
  if (wasBusy && (session.status === 'done' || session.status === 'my-turn')) return session.status
  return null
}

/** "[역할] 이름 · Done". 이름·역할은 화면(web/src/sessionPosition.ts 의 nameOf·positionOf)과 같은 규칙 */
export function noticeTitle(session: NotifySession, kind: NotifyKind): string {
  const position = positionOf(session)
  return `${position ? `[${position}] ` : ''}${nameOf(session)} · ${KIND_LABELS[kind]}`
}

/** 승인 대기면 도구 이름, 아니면 마지막 말의 첫 줄(마크다운 머리 #·굵게 ** 를 뗀다) 앞 120자 */
export function noticeBody(session: NotifySession, kind: NotifyKind): string {
  if (kind === 'needs-approval') return session.pendingTool ? `Tool: ${session.pendingTool}` : ''
  if (kind === 'hand-over') {
    const kiloTokens = Math.round((session.contextTokens ?? 0) / 1000)
    return `Context ${kiloTokens}k · Start a new ${session.partId ? 'part lead' : 'lead'} with this one's history`
  }
  const firstLine = (session.lastAssistantText ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').replaceAll('**', '').trim())
    .find((line) => line !== '')
  if (!firstLine) return ''
  return firstLine.length > BODY_MAX_LENGTH ? `${firstLine.slice(0, BODY_MAX_LENGTH)}…` : firstLine
}

/** 팀·파트 이름과 지금 리드를 찾는 데 쓰는 팀 정보 (hq 의 Team 일부 — 트레이는 `/api/office` 의 같은 필드) */
export interface NotifyOffice {
  teams: { id: string; name: string; leadSessionId?: string; parts?: { id: string; name: string; leadSessionId?: string }[] }[]
}

/** 세션이 속한 팀·파트 이름. 팀이 없거나(Focus Zone) 팀 정보를 못 읽었으면 null */
export interface NoticePlace {
  team: string
  part: string | null
}

export function placeOf(session: Pick<NotifySession, 'teamId' | 'partId'>, office: NotifyOffice | null): NoticePlace | null {
  if (!office || !session.teamId) return null
  const team = office.teams.find((each) => each.id === session.teamId)
  if (!team) return null
  const part = session.partId ? (team.parts?.find((each) => each.id === session.partId)?.name ?? null) : null
  return { team: team.name, part }
}

function splitLegacyName(name: string): { position: string | null; name: string } {
  const match = name.match(/^\[([^\]]*)\]\s*(.*)$/)
  if (!match) return { position: null, name }
  const position = match[1].trim()
  return { position: position || null, name: match[2] }
}

function cleanPosition(position: string | null | undefined): string | null {
  const trimmed = position?.trim()
  return trimmed ? trimmed : null
}

function positionOf(session: NotifySession): string | null {
  const own = cleanPosition(session.position)
  if (own) return own
  return session.name ? splitLegacyName(session.name).position : null
}

/** 역할 없는 이름 (화면 nameOf 규칙): 이름 → 자동 제목 → ID 앞 8자리. 알림(Reminders) 제목도 쓴다 */
export function nameOf(session: NotifySession): string {
  if (session.name) {
    if (cleanPosition(session.position)) return session.name
    const split = splitLegacyName(session.name)
    return split.position && split.name ? split.name : session.name
  }
  return session.title ?? session.id.slice(0, 8)
}

// ---------- 알림(Reminders) — desktop/src/reminderNotice.ts 사본 ----------

/** 등록한 리드 세션. 사람이 등록했거나 세션을 못 찾으면 undefined */
export function reminderSession(reminder: Reminder, sessions: readonly NotifySession[]): NotifySession | undefined {
  const creator = reminder.createdBy
  if (creator.kind !== 'lead' || !creator.sessionId) return undefined
  return sessions.find((session) => session.id === creator.sessionId)
}

/** "[Lead] 이름" · "[Part lead] 이름". 역할은 화면 creatorLabel(web/src/reminders.ts)처럼 partId 로, 세션을 못 찾으면 이름 없이. 사람이 등록한 것은 null */
function senderOf(reminder: Reminder, sessions: readonly NotifySession[]): string | null {
  const creator = reminder.createdBy
  if (creator.kind !== 'lead') return null
  const role = creator.partId ? '[Part lead]' : '[Lead]'
  const session = reminderSession(reminder, sessions)
  return session ? `${role} ${nameOf(session)}` : role
}

/** "[Lead] 이름 · Reminder" (늦었으면 "Late reminder"). 사람이 등록한 것은 "Reminder", 리드 세션을 못 찾으면 "[Lead] Reminder" */
export function reminderTitle(reminder: Reminder, sessions: readonly NotifySession[]): string {
  const label = reminder.isLate ? 'Late reminder' : 'Reminder'
  const sender = senderOf(reminder, sessions)
  if (!sender) return label
  return reminderSession(reminder, sessions) ? `${sender} · ${label}` : `${sender} ${label}`
}

/** 리드가 등록한 알림의 팀·파트 이름. 사람이 등록한 것·팀을 못 찾으면 null */
export function reminderPlace(reminder: Reminder, office: NotifyOffice | null): NoticePlace | null {
  const creator = reminder.createdBy
  return creator.kind === 'lead' ? placeOf({ teamId: creator.teamId, partId: creator.partId }, office) : null
}

/**
 * 누를 때 열 세션: 그 지휘 단위(팀 직속·파트)의 지금 리드 — Hand over 로 등록한 리드가 바뀌었을 수 있다.
 * 지금 리드가 없거나 팀 정보를 못 읽었으면 등록한 리드(createdBy.sessionId). 사람이 등록한 것은 null
 */
export function reminderTarget(reminder: Reminder, office: NotifyOffice | null): string | null {
  const creator = reminder.createdBy
  if (creator.kind !== 'lead') return null
  const team = office?.teams.find((each) => each.id === creator.teamId)
  const unit = creator.partId ? team?.parts?.find((each) => each.id === creator.partId) : team
  return unit?.leadSessionId ?? creator.sessionId
}
