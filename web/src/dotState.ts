import { attendanceOf, type Session } from './types'

/** 도트 인물 그림 상태 */
export type DotState = 'typing' | 'raise-hand' | 'idle' | 'doze'

/** 차례가 끝나고 이만큼 지나면 존다 */
export const DOZE_AFTER_MS = 30 * 60_000

/**
 * 상태 매핑 (설계 문서): working 타자, 승인 대기 손 들기, ended 졸기,
 * my-turn·idle·unknown 은 차례가 끝난 지(turnEndedAt) 30분 지났으면 졸기, 아니면(시각을 모르면) 앉아서 화면 보기
 */
export function dotStateOf(session: Session, now: number): DotState {
  const { status } = session
  if (status === 'working') return 'typing'
  if (status === 'needs-approval') return 'raise-hand'
  if (status === 'ended') return 'doze'
  const endedAt = session.turnEndedAt ? Date.parse(session.turnEndedAt) : NaN
  return Number.isFinite(endedAt) && now - endedAt >= DOZE_AFTER_MS ? 'doze' : 'idle'
}

/** 책상에 앉아 조는 근무 세션 ID 를 이은 키. 시간이 흘러 바뀌었을 때만 다시 그리려고 비교한다 (휴식은 빈 의자, 퇴근은 띠라 뺀다) */
export function dozingKey(sessions: Session[], now: number): string {
  return sessions
    .filter((session) => attendanceOf(session) === 'present' && dotStateOf(session, now) === 'doze')
    .map((session) => session.id)
    .sort()
    .join(',')
}
