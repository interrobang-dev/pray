/** 팀원 spawn 에 고를 수 있는 모델 (claude --model 별칭). 팀장·파트장 MCP 의 jk_spawn_member enum 과 같다 */
export const MEMBER_MODELS = ['haiku', 'sonnet', 'opus', 'fable'] as const
/** claude --effort 값 전부. 낮은 effort 도 막지 않는다 */
export const MEMBER_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

export type MemberModel = (typeof MEMBER_MODELS)[number]
export type MemberEffort = (typeof MEMBER_EFFORTS)[number]

/** 고른 모델·effort. null 이면 그 인자를 넘기지 않는다 (사용자 기본값) */
export interface MemberModelChoice {
  model: MemberModel | null
  effort: MemberEffort | null
}

/**
 * 팀원 spawn 본문의 model·effort (순수). 빼거나 null 이면 null, 목록의 값이면 그대로 (대소문자·공백을 고치지 않는다).
 * 하나라도 그 밖이면 undefined (400)
 */
export function parseMemberModelChoice(body: { model?: unknown; effort?: unknown }): MemberModelChoice | undefined {
  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null | undefined =>
    value === undefined || value === null ? null : allowed.includes(value as T) ? (value as T) : undefined
  const model = pick(body.model, MEMBER_MODELS)
  const effort = pick(body.effort, MEMBER_EFFORTS)
  if (model === undefined || effort === undefined) return undefined
  return { model, effort }
}

/** 팀원 claude 에 넘길 추가 인자. 호스트가 webSessions 에 저장해 resume 때도 같이 넘긴다 (다시 출근해도 모델·effort 가 그대로) */
export function memberExtraArgs(name: string, permissionMode: string, choice: MemberModelChoice): string[] {
  return [
    '--name',
    name,
    '--permission-mode',
    permissionMode,
    ...(choice.model ? ['--model', choice.model] : []),
    ...(choice.effort ? ['--effort', choice.effort] : []),
  ]
}
