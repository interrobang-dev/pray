/** 파트 = 팀 안의 선택적 지휘 단위. 파트장 한 명과 그 팀원들. worktree 가 있으면 그 폴더에서 일한다 */
export interface Part {
  id: string
  name: string
  /** 파트장 세션 (선택, 파트당 하나). 자기 파트 팀원만 지휘 */
  leadSessionId?: string
  /** 있으면 이 폴더의 세션은 폴더만으로 이 파트 소속 */
  worktree?: { cwd: string; branch: string }
  createdAt: string
}

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
  /** 팀장 세션 (선택, 팀당 하나). 팀 직속(파트 없는 세션)만 지휘 */
  leadSessionId?: string
  /** 예전 책상 끌기의 기록 (앵커 기준 오프셋). 화면은 읽지 않는다 — 책상은 인원으로 자동 배치 */
  desks: Record<string, { dx: number; dy: number }>
  parts: Part[]
  /** 팀 폴더 세션의 파트 소속 (sessionId → partId). worktree 파트 소속은 폴더로 정해져 저장하지 않는다 */
  partOf: Record<string, string>
  createdAt: string
}

/** 소문자, 구분자 `/`, 끝 `/` 제거. 정확히 같은 폴더만 같은 팀 (하위 폴더는 별개) */
export function normalizeCwd(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 팀 폴더 또는 그 팀 파트의 worktree 폴더와 정확히 같으면 그 팀 */
export function teamOf(cwd: string, teams: Team[]): Team | null {
  if (!cwd) return null
  const key = normalizeCwd(cwd)
  return (
    teams.find(
      (t) => normalizeCwd(t.cwd) === key || t.parts.some((p) => p.worktree && normalizeCwd(p.worktree.cwd) === key),
    ) ?? null
  )
}

/** worktree 폴더면 그 파트, 아니면 partOf 기록, 둘 다 없으면 null (팀 직속). 기록이 가리키는 파트가 지워졌으면 팀 직속 */
export function partOfSession(sessionId: string, cwd: string, team: Team | null): Part | null {
  if (!team) return null
  const key = normalizeCwd(cwd)
  const byFolder = team.parts.find((p) => p.worktree && normalizeCwd(p.worktree.cwd) === key)
  if (byFolder) return byFolder
  const partId = team.partOf[sessionId]
  return team.parts.find((p) => p.id === partId) ?? null
}

export type Role = 'lead' | 'member' | null

/** 자기 지휘 단위(파트, 없으면 팀 직속)의 지시자면 lead, 팀의 웹 세션이면 member. 외부 세션은 팀에 있어도 지시 대상이 아니라 null */
export function roleOf(sessionId: string, isWeb: boolean, team: Team | null, part: Part | null = null): Role {
  if (!team) return null
  const leadSessionId = part ? part.leadSessionId : team.leadSessionId
  if (leadSessionId === sessionId) return 'lead'
  return isWeb ? 'member' : null
}
