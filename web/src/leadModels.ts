import { blockReason, initialChoice, isChanged, type ModelChoice } from './modelSetting'
import { attendanceOf, type Session, type Team } from './types'

/** 근무 중인 웹 세션의 팀장·파트장 (role lead). 휴식·퇴근·외부 세션은 다시 띄울 수 없어 뺀다. 순서는 서버 순서(생성순) */
export function leadSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => session.role === 'lead' && session.kind === 'web' && attendanceOf(session) === 'present')
}

/** 줄의 자리 글자: "팀" 또는 "팀 · 파트". 팀이 목록에 없으면 Focus Zone */
export function leadPlaceOf(session: Pick<Session, 'teamId' | 'partId'>, teams: Team[]): string {
  const team = teams.find((candidate) => candidate.id === session.teamId)
  if (!team) return 'Focus Zone'
  const part = session.partId ? team.parts.find((candidate) => candidate.id === session.partId) : undefined
  return part ? `${team.name} · ${part.name}` : team.name
}

export interface LeadRow {
  sessionId: string
  /** 창을 열 때의 값 (세션 하나 바꾸는 창과 같은 initialChoice) */
  initial: ModelChoice
  choice: ModelChoice
  isChecked: boolean
}

/** 창을 열 때의 줄들. 기본으로 모두 체크 (바쁜 세션도 — 서버가 409 로 다시 막는다) */
export function initialRows(leads: Session[]): LeadRow[] {
  return leads.map((session) => {
    const initial = initialChoice(session)
    return { sessionId: session.id, initial, choice: initial, isChecked: true }
  })
}

/** 보낼 줄: 체크돼 있고, 모델을 알고, 값이 처음과 다른 것 */
export function rowsToApply(rows: LeadRow[]): LeadRow[] {
  return rows.filter((row) => row.isChecked && row.choice.model !== null && isChanged(row.initial, row.choice))
}

/** 바뀌는 줄 가운데 모델이 바뀌는 것의 수와 그 문맥 합 (다음 차례에 캐시 없이 다시 읽는 양). 문맥을 모르는 세션은 수에만 든다 */
export function modelSwitchImpact(rows: LeadRow[], sessions: Pick<Session, 'id' | 'contextTokens'>[]): { count: number; tokens: number } {
  let count = 0
  let tokens = 0
  for (const row of rowsToApply(rows)) {
    if (row.choice.model === row.initial.model) continue
    count += 1
    const contextTokens = sessions.find((session) => session.id === row.sessionId)?.contextTokens
    if (typeof contextTokens === 'number') tokens += contextTokens
  }
  return { count, tokens }
}

/** 줄에 미리 보이는 막는 이유 (화면이 아는 상태만. 대기 메시지는 몰라서 서버 409 로 본다) */
export function leadBlockReason(session: Session): string | null {
  return blockReason(session, false)
}

/** PUT /api/sessions/:id/model 본문. Auto 는 effort null (전역 설정) */
export function modelRequestBody(choice: ModelChoice): { model: string; effort: string | null } | null {
  if (choice.model === null) return null
  return { model: choice.model, effort: choice.effort === 'auto' ? null : choice.effort }
}
