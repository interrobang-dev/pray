import { attendanceOf, formatAgo, type Session } from './types'

/** 도트 인물 그림 상태 */
export type DotState = 'typing' | 'raise-hand' | 'idle' | 'doze'

/** 근무 세션이 있는 곳: 책상, 라운지에 깨어 앉음, 라운지에서 졸기 */
export type SeatPlace = 'desk' | 'lounge' | 'lounge-doze'

/** 차례가 끝나고 이만큼 지나면 책상을 비우고 라운지에서 쉰다 */
export const LOUNGE_AFTER_MS = 8 * 60 * 60_000
/** 차례가 끝나고 이만큼 지나면 라운지에서 존다 */
export const LOUNGE_DOZE_AFTER_MS = 24 * 60 * 60_000

/** 차례가 끝난 시각 (ms). 모르면(없음·옛 서버·해석 불가) null */
export function turnEndedAtOf(session: Session): number | null {
  const endedAt = session.turnEndedAt ? Date.parse(session.turnEndedAt) : NaN
  return Number.isFinite(endedAt) ? endedAt : null
}

/**
 * 근무 중이고 작업 중·백그라운드 대기·승인 대기가 아닌 세션은 차례가 끝난 지(turnEndedAt) 8시간부터 라운지, 24시간부터 라운지에서 졸기.
 * 그 밖(8시간 미만·시각을 모름·작업 중·waiting·승인 대기)은 책상. 휴식(책상 빈 의자)·퇴근(퇴근 거리)도 desk 로 준다 (라운지와 무관)
 */
export function seatPlaceOf(session: Session, now: number): SeatPlace {
  if (attendanceOf(session) !== 'present' || session.status === 'working' || session.status === 'waiting' || session.status === 'needs-approval') return 'desk'
  const endedAt = turnEndedAtOf(session)
  if (endedAt === null) return 'desk'
  const elapsed = now - endedAt
  return elapsed >= LOUNGE_DOZE_AFTER_MS ? 'lounge-doze' : elapsed >= LOUNGE_AFTER_MS ? 'lounge' : 'desk'
}

/**
 * 상태 매핑 (설계 문서): working 타자, 승인 대기 손 들기 (둘과 waiting 은 늘 책상), 라운지에서 졸기면 doze, 그 밖(책상·라운지에 깨어 앉음)은 앉아서 화면 보기.
 * 책상에서는 졸지 않는다
 */
export function dotStateOf(session: Session, now: number): DotState {
  const { status } = session
  if (status === 'working') return 'typing'
  if (status === 'needs-approval') return 'raise-hand'
  return seatPlaceOf(session, now) === 'lounge-doze' ? 'doze' : 'idle'
}

/** 근무 세션마다 있는 곳을 이은 키. 시간이 흘러 책상·라운지·라운지 졸기가 바뀌었을 때만 다시 그리려고 비교한다 (휴식은 빈 의자, 퇴근은 띠라 뺀다) */
export function seatPlaceKey(sessions: Session[], now: number): string {
  return sessions
    .filter((session) => attendanceOf(session) === 'present')
    .map((session) => `${session.id}:${seatPlaceOf(session, now)}`)
    .sort()
    .join(',')
}

/** 자리 카드의 라운지 줄 "Resting in lounge · last chat 3h ago"·"Dozing in lounge · last chat 2d ago". 책상이면 null */
export function loungeLabel(session: Session, now: number): string | null {
  const place = seatPlaceOf(session, now)
  if (place === 'desk' || !session.turnEndedAt) return null
  return `${place === 'lounge-doze' ? 'Dozing in lounge' : 'Resting in lounge'} · last chat ${formatAgo(session.turnEndedAt, now)}`
}
