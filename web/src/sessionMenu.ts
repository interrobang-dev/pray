import { attendanceOf, type Session } from './types'

/** 목록 세션 줄 "⋯" 메뉴의 항목. separator 는 구분선 */
export type SessionMenuEntry = 'rename' | 'model' | 'end' | 'clock-in' | 'delete-record' | 'separator'

/**
 * 그 세션에서 되는 것만 고른다 (순수).
 * 근무 중인 웹 세션: 이름·모델·종료 / 휴식 웹 세션·외부 세션: 이름 / 퇴근 웹 세션: 이름·다시 출근·기록 지우기.
 * attendance 가 없는 옛 서버 응답의 끝난 세션은 다시 출근·기록 지우기를 서버가 못 해서 이름만
 */
export function sessionMenuEntries(session: Pick<Session, 'kind' | 'attendance' | 'isAlive'>): SessionMenuEntry[] {
  if (session.kind !== 'web') return ['rename']
  const attendance = attendanceOf(session as Session)
  if (attendance === 'present') return ['rename', 'model', 'separator', 'end']
  if (attendance === 'off' && session.attendance === 'off') return ['rename', 'clock-in', 'separator', 'delete-record']
  return ['rename']
}
