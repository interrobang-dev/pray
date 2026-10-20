/** 팀 = 같은 작업 폴더를 쓰는 세션 묶음. 그룹 안의 책상 섬. 세션의 소속은 저장하지 않고 cwd 로 판정한다 */
export interface Team {
  id: string
  name: string
  /** 팀의 키. normalizeCwd 로 비교한다 */
  cwd: string
  groupId: string
  /** 섬 앵커 (타일, 절대 좌표) */
  x: number
  y: number
  /** 팀장 세션 (선택, 팀당 하나) */
  leadSessionId?: string
  /** 앵커 기준 책상 오프셋. 끌어 놓았을 때만 저장 */
  desks: Record<string, { dx: number; dy: number }>
  createdAt: string
}

/** 소문자, 구분자 `/`, 끝 `/` 제거. 정확히 같은 폴더만 같은 팀 (하위 폴더는 별개) */
export function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function teamOf(cwd: string, teams: Team[]): Team | null {
  if (!cwd) return null
  const key = normalizeCwd(cwd)
  return teams.find((t) => normalizeCwd(t.cwd) === key) ?? null
}

export type Role = 'lead' | 'member' | null

/** 팀장이면 lead, 팀의 웹 세션이면 member. 외부 세션은 팀에 있어도 지시 대상이 아니라 null */
export function roleOf(sessionId: string, isWeb: boolean, team: Team | null): Role {
  if (!team) return null
  if (team.leadSessionId === sessionId) return 'lead'
  return isWeb ? 'member' : null
}
