/** 세션 작업 완료·승인 대기 Windows 알림의 판정과 글자. Electron 을 쓰지 않는 순수 함수 */
import type { DotLook } from './dotCharacter'
import type { ToastContent } from './toast'

/** `/api/sessions` 의 세션 중 알림에 쓰는 필드 (web/src/types.ts 의 Session 일부) */
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
  /** 속한 팀 ID (팀 없으면 null). 옛 서버 응답엔 없을 수 있다 */
  teamId?: string | null
  /** 속한 파트 ID (팀 직속이면 null). 옛 서버 응답엔 없을 수 있다 */
  partId?: string | null
  /** 세션 문맥 크기(토큰). 옛 서버 응답엔 없을 수 있다 */
  contextTokens?: number | null
  /** 고르거나 배정된 도트 인물 (없으면 해시로 고른다 → dotLookOf). 옛 서버 응답엔 없을 수 있다 */
  character?: DotLook | null
  /** 서버가 이름을 지을 때 정한 성별 (해시 인물 후보를 좁힌다) */
  gender?: 'male' | 'female' | null
}

export type NotifyKind = 'done' | 'my-turn' | 'needs-approval' | 'hand-over'

/** 문맥 경고 단계 기준. web/src/contextSize.ts 의 CONTEXT_WARN_TOKENS 와 같아야 한다 (desktop 은 CommonJS 빌드라 web 을 import 하지 않는다) */
export const CONTEXT_WARN_TOKENS = 150_000

export interface SessionNotice {
  sessionId: string
  kind: NotifyKind
  title: string
  body: string
}

const BODY_MAX_LENGTH = 120
const KIND_LABELS: Record<NotifyKind, string> = { done: 'Done', 'my-turn': 'My turn', 'needs-approval': 'Needs approval', 'hand-over': 'Hand over' }

/** 세션 ID → 직전 폴링의 표시 상태와 문맥이 경고 단계였는지. 근무 중인 세션만 든다 */
export type StatusBaseline = Map<string, { status: string; isContextWarned: boolean }>

function isContextWarned(session: NotifySession): boolean {
  return typeof session.contextTokens === 'number' && session.contextTokens >= CONTEXT_WARN_TOKENS
}

/**
 * 직전 상태와 비교해 알릴 것을 고른다. previous 가 null 이면(트레이 시작·서버가 돌아온 직후·자식 재시작 뒤) 기준만 잡는다.
 * - working·waiting → done·my-turn: 팀원(role member)이 아닌 세션만
 * - needs-approval 이 새로 됨: 모든 세션
 * - 팀장·파트장(role lead)의 문맥이 경고 단계(15만↑)로 새로 들어감: "Hand over". 압축으로 내려갔다 다시 넘으면 또 알린다. 위 판정과 독립이라 같은 폴링에 둘 다 나올 수 있다
 * 근무 중이 아닌 세션은 기준에서 빠져, 다시 근무가 된 첫 폴링(호스트 재시작 뒤 --resume 등)도 기준만 잡는다
 */
export function diffSessions(
  previous: StatusBaseline | null,
  sessions: NotifySession[],
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

function noticeKind(before: string, session: NotifySession): NotifyKind | null {
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

/** `/api/office` 중 알림의 자리 글자에 쓰는 필드 */
export interface NotifyOffice {
  teams: { id: string; name: string; parts?: { id: string; name: string }[] }[]
}

/** 세션이 속한 팀·파트 이름. 팀이 없거나(Focus Zone) 사무실 정보를 못 받았으면 null */
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

/** "팀 › 파트" (파트가 없으면 팀). 자리가 없으면 빈 글 */
export function placeLabel(place: NoticePlace | null): string {
  if (!place) return ''
  return place.part ? `${place.team} › ${place.part}` : place.team
}

/** 묶음 알림의 한 줄: "팀 › 파트 · 제목" */
export function bundleLine(title: string, place: NoticePlace | null): string {
  const label = placeLabel(place)
  return label ? `${label} · ${title}` : title
}

/**
 * 토스트 본문 한 줄의 폭 예산. 넓은 글자(한글·한자·전각·이모지, U+1100 부터) 2, 나머지 1, 끝의 … 도 1.
 * 그림이 있는 토스트(배율 100%)에서 한글 17자 + 공백 4 + … 는 한 줄, 영어 37자는 두 줄이었다(실측) — 그래서 34 로 둔다.
 * 대문자·W 처럼 넓은 글자가 많으면 두 줄로 넘어갈 수 있다 (어림)
 */
export const BODY_LINE_UNITS = 34

/** 한 줄 폭 예산(BODY_LINE_UNITS)을 넘으면 잘라 … 를 붙인다. 맨 위 text 의 hint-maxLines 는 Windows 토스트가 무시해서(실측) 글을 자른다 */
export function fitOneLine(text: string, units = BODY_LINE_UNITS): string {
  const widthOf = (char: string) => ((char.codePointAt(0) ?? 0) >= 0x1100 ? 2 : 1)
  const chars = [...text]
  if (chars.reduce((sum, char) => sum + widthOf(char), 0) <= units) return text
  let used = 1
  let end = 0
  while (end < chars.length && used + widthOf(chars[end]) <= units) used += widthOf(chars[end++])
  return `${chars.slice(0, end).join('').trimEnd()}…`
}

/** 한 세션 알림의 토스트 내용: 제목 · 본문 한 줄(fitOneLine) · 작은 회색 줄 "팀 › 파트" (팀이 없으면 줄 없음) */
export function noticeToast(notice: SessionNotice, place: NoticePlace | null, iconUrl: string | null): ToastContent {
  return { title: notice.title, body: fitOneLine(notice.body), attribution: placeLabel(place), iconUrl }
}

/** 묶음 알림 "Pray · N sessions": 본문 줄마다 bundleLine (자르지 않는다) */
export function bundleToast(lines: string[], iconUrl: string | null): ToastContent {
  return { title: `Pray · ${lines.length} sessions`, body: lines.join('\n'), attribution: '', iconUrl }
}

/** 묶음 알림 그림의 테두리 색: 가장 급한 종류 (승인 대기 → 내 차례 → 인계 → 끝남) */
export function urgentKind(kinds: NotifyKind[]): NotifyKind {
  const order: NotifyKind[] = ['needs-approval', 'my-turn', 'hand-over', 'done']
  return order.find((kind) => kinds.includes(kind)) ?? 'done'
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
