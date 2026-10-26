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

/** 웹 세션 extraArgs 에 든 모델·effort (hq 기록에서 읽은 그대로. 별칭이 아니어도 그대로). 없으면 null */
export interface ModelSetting {
  model: string | null
  effort: string | null
}

/**
 * jk-corp 가 extraArgs 에 넣는, 값을 하나 받는 claude 옵션 (leadExtraArgs·memberExtraArgs). 이 옵션 다음 칸은 글자가 무엇이든
 * (`--model` 이어도) 그 값이다 — claude(commander)도 값이 꼭 필요한 옵션은 다음 칸을 그대로 값으로 읽는다.
 * 값 옵션을 새로 넣으면 여기에도 더한다 (빠지면 그 값이 `--model` 일 때 모델 옵션으로 읽힌다)
 */
const VALUE_OPTIONS = new Set(['--name', '--permission-mode', '--append-system-prompt', '--mcp-config', '--model', '--effort'])

interface ArgItem {
  /** 옵션 이름 (`--x=값` 은 `=` 앞). 값 옵션이 아닌 칸은 null */
  option: string | null
  value: string | null
  /** 원래 칸 그대로 (한 칸 또는 이름·값 두 칸) */
  tokens: string[]
}

/** extraArgs 를 "옵션 이름 + 값" 짝으로 나눈다 (순수). `--x=값` 은 한 칸 짝, 그 밖의 칸은 하나씩 */
function splitOptions(extraArgs: readonly string[]): ArgItem[] {
  const items: ArgItem[] = []
  for (let index = 0; index < extraArgs.length; index++) {
    const token = extraArgs[index]
    if (VALUE_OPTIONS.has(token)) {
      const hasValue = index + 1 < extraArgs.length
      items.push({ option: token, value: hasValue ? extraArgs[index + 1] : null, tokens: extraArgs.slice(index, index + 2) })
      if (hasValue) index++
      continue
    }
    const equalsAt = token.startsWith('--') ? token.indexOf('=') : -1
    if (equalsAt > 0) items.push({ option: token.slice(0, equalsAt), value: token.slice(equalsAt + 1), tokens: [token] })
    else items.push({ option: null, value: null, tokens: [token] })
  }
  return items
}

/** extraArgs 의 `--model`·`--effort` 값 (순수, `--model=값` 꼴도). 여러 번이면 claude 처럼 마지막 것, 없거나 빈 값이면 null */
export function modelSettingOf(extraArgs: readonly string[]): ModelSetting {
  const setting: ModelSetting = { model: null, effort: null }
  for (const item of splitOptions(extraArgs)) {
    if (item.option === '--model') setting.model = item.value || null
    if (item.option === '--effort') setting.effort = item.value || null
  }
  return setting
}

/**
 * 저장된 extraArgs 에서 `--model`·`--effort`(`=` 꼴 포함, 그 값까지)를 빼고 고른 것을 끝에 붙인다 (순수). null 이면 빼기만 한다
 * (effort null = 사용자 전역 설정값). 다른 옵션과 그 값은 순서 그대로 둔다. 끝에 붙여도 `--mcp-config`(값을 여러 개 받는다)가
 * `--model` 을 값으로 먹지 않는다 — `-` 로 시작하는 칸에서 멈춘다
 */
export function withModelSetting(extraArgs: readonly string[], choice: MemberModelChoice): string[] {
  return [
    ...splitOptions(extraArgs)
      .filter((item) => item.option !== '--model' && item.option !== '--effort')
      .flatMap((item) => item.tokens),
    ...(choice.model ? ['--model', choice.model] : []),
    ...(choice.effort ? ['--effort', choice.effort] : []),
  ]
}
