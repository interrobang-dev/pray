/** 목록 툴바 "Needs you" 창 (NeedsYouButton.tsx) 의 순수 함수: 사람이 볼 차례인 근무 세션 모으기 */
import { LOUNGE_DOZE_AFTER_MS } from './dotState'
import { lastActivityOf } from './home'
import { attendanceOf, type Session } from './types'

/** 이 창에 넣는 표시 상태. 배열 순서가 묶음 순서다 (급한 것 먼저) */
export const NEEDS_YOU_STATUSES = ['needs-approval', 'my-turn', 'done'] as const
export type NeedsYouStatus = (typeof NEEDS_YOU_STATUSES)[number]

/**
 * 끝남(done)은 마지막 대화(turnEndedAt → lastAt)에서 이만큼 지나면 뺀다.
 * done 은 다음 지시를 받을 때까지 그대로라 쌓이기만 한다. 사무실이 같은 시계로 24시간부터 라운지에서 졸게 하므로(dotState.ts) 기준을 맞춘다
 */
export const DONE_MAX_AGE_MS = LOUNGE_DOZE_AFTER_MS

type NeedsYouFields = Pick<Session, 'status' | 'role' | 'isAlive' | 'attendance' | 'turnEndedAt' | 'lastAt'>

function isNeedsYouStatus(status: Session['status']): status is NeedsYouStatus {
  return (NEEDS_YOU_STATUSES as readonly string[]).includes(status)
}

/**
 * 이 세션을 창에 넣는지. 근무 중만, 승인 대기는 모두, 내 차례·끝남은 팀원(role member)을 뺀다 — 팀원의 끝은 팀장이 team_wait 로 받는다.
 * 트레이 알림 판정(desktop/src/notify.ts 의 noticeKind)과 같은 규칙이다 (desktop 은 CommonJS 빌드라 import 하지 않고 따로 둔다. 같이 고친다).
 * done 은 DONE_MAX_AGE_MS 보다 오래되면 뺀다. 시각을 모르면 넣는다 (알 수 없는 것을 말없이 숨기지 않는다). 내 차례·승인 대기는 오래돼도 넣는다
 */
export function isNeedsYou(session: NeedsYouFields, now: number): boolean {
  if (attendanceOf(session) !== 'present' || !isNeedsYouStatus(session.status)) return false
  if (session.status === 'needs-approval') return true
  if (session.role === 'member') return false
  if (session.status === 'done') {
    const at = lastActivityOf(session)
    if (at !== null && now - at >= DONE_MAX_AGE_MS) return false
  }
  return true
}

/** 창의 줄: 승인 대기 → 내 차례 → 끝남으로 묶고, 묶음 안은 최근 것 먼저(turnEndedAt → lastAt, 모르면 뒤, 같으면 원래 순서 = 생성순) */
export function needsYouSessions<T extends NeedsYouFields>(sessions: readonly T[], now: number): T[] {
  return sessions
    .map((session, index) => ({ session, index, at: lastActivityOf(session) }))
    .filter(({ session }) => isNeedsYou(session, now))
    .sort(
      (a, b) =>
        NEEDS_YOU_STATUSES.indexOf(a.session.status as NeedsYouStatus) - NEEDS_YOU_STATUSES.indexOf(b.session.status as NeedsYouStatus) ||
        (b.at ?? -Infinity) - (a.at ?? -Infinity) ||
        a.index - b.index,
    )
    .map(({ session }) => session)
}
