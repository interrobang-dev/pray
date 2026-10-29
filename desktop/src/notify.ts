/** 세션 작업 완료·승인 대기 Windows 알림의 판정과 글자. Electron 을 쓰지 않는 순수 함수 */

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
}

export type NotifyKind = 'done' | 'my-turn' | 'needs-approval'

export interface SessionNotice {
  sessionId: string
  kind: NotifyKind
  title: string
  body: string
}

const BODY_MAX_LENGTH = 120
const KIND_LABELS: Record<NotifyKind, string> = { done: 'Done', 'my-turn': 'My turn', 'needs-approval': 'Needs approval' }

/** 세션 ID → 직전 폴링의 표시 상태. 근무 중인 세션만 든다 */
export type StatusBaseline = Map<string, string>

/**
 * 직전 상태와 비교해 알릴 것을 고른다. previous 가 null 이면(트레이 시작·서버가 돌아온 직후·자식 재시작 뒤) 기준만 잡는다.
 * - working·waiting → done·my-turn: 팀원(role member)이 아닌 세션만
 * - needs-approval 이 새로 됨: 모든 세션
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
    next.set(session.id, session.status)
    const before = previous?.get(session.id)
    if (before === undefined) continue
    const kind = noticeKind(before, session)
    if (kind) notices.push({ sessionId: session.id, kind, title: noticeTitle(session, kind), body: noticeBody(session, kind) })
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
  const firstLine = (session.lastAssistantText ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').replaceAll('**', '').trim())
    .find((line) => line !== '')
  if (!firstLine) return ''
  return firstLine.length > BODY_MAX_LENGTH ? `${firstLine.slice(0, BODY_MAX_LENGTH)}…` : firstLine
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

function nameOf(session: NotifySession): string {
  if (session.name) {
    if (cleanPosition(session.position)) return session.name
    const split = splitLegacyName(session.name)
    return split.position && split.name ? split.name : session.name
  }
  return session.title ?? session.id.slice(0, 8)
}
