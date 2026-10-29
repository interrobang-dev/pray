/** 왼쪽 목록 그룹·Focus Zone·Off Duty 접기의 순수 함수. 저장(localStorage)은 App.tsx 가 한다 */
import { attendanceOf, statusLabel, type Session, type SessionStatus } from './types'

/** 저장된 접힌 그룹 ID 배열. 없거나 깨졌으면 [] (모두 펼침), 글자가 아닌 항목은 버린다 */
export function parseCollapsedGroupIds(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** 그 그룹을 접거나 편 뒤의 접힌 그룹 ID. 지금 없는 그룹의 ID 는 이때 같이 지운다 */
export function toggleCollapsedGroup(collapsedIds: string[], groupId: string, existingGroupIds: string[]): string[] {
  const kept = collapsedIds.filter((id) => id !== groupId && existingGroupIds.includes(id))
  return collapsedIds.includes(groupId) ? kept : [...kept, groupId]
}

/** 접힌 라벨에 세는 상태. 이 순서로 보인다 */
const SUMMARY_STATUSES = ['needs-approval', 'my-turn', 'working'] as const satisfies readonly SessionStatus[]

export interface StatusCount {
  status: (typeof SUMMARY_STATUSES)[number]
  count: number
}

/** 근무 중인 세션의 승인 대기·내 차례·작업 중 수. 0 인 것은 뺀다 (waiting·done·휴식·퇴근은 세지 않는다) */
export function statusSummary(sessions: Pick<Session, 'status' | 'attendance' | 'isAlive'>[]): StatusCount[] {
  const present = sessions.filter((s) => attendanceOf(s) === 'present')
  return SUMMARY_STATUSES.map((status) => ({ status, count: present.filter((s) => s.status === status).length })).filter((c) => c.count > 0)
}

/** 요약의 title·aria-label: "1 Needs approval · 2 Your turn" */
export function summaryLabel(summary: StatusCount[]): string {
  return summary.map((c) => `${c.count} ${statusLabel[c.status]}`).join(' · ')
}
