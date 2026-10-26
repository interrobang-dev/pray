import { tokenLabel } from './accountLabels'
import type { Session } from './types'

export const MODEL_OPTIONS = [
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
  { value: 'fable', label: 'Fable' },
] as const

/** auto = 서버에 effort null 로 보낸다 (전역 설정값) */
export const EFFORT_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
] as const

export type ModelAlias = (typeof MODEL_OPTIONS)[number]['value']
export type EffortChoice = (typeof EFFORT_OPTIONS)[number]['value']

export interface ModelChoice {
  /** 모를 때 null — 고르기 전에는 Apply 를 켜지 않는다 */
  model: ModelAlias | null
  effort: EffortChoice
}

/** 이 시간 안에 차례가 끝난 세션은 프롬프트 캐시가 아직 살아 있다 (서버 switchImpact 와 같은 1시간) */
const CACHE_ALIVE_MS = 60 * 60_000

const MODEL_VALUES: readonly string[] = MODEL_OPTIONS.map((option) => option.value)
const EFFORT_VALUES: readonly string[] = EFFORT_OPTIONS.map((option) => option.value)

/** 모델 ID "claude-opus-5-5" → "opus". 별칭 목록에 없으면 null */
export function modelAlias(model: string | null | undefined): ModelAlias | null {
  const match = model?.match(/^claude-([a-z]+)-/)
  return match && MODEL_VALUES.includes(match[1]) ? (match[1] as ModelAlias) : null
}

/** auto 가 아닌 effort 값만. 모르는 값·없으면 null */
function effortChoice(effort: string | null | undefined): EffortChoice | null {
  return effort && effort !== 'auto' && EFFORT_VALUES.includes(effort) ? (effort as EffortChoice) : null
}

function settingModel(model: string | null | undefined): ModelAlias | null {
  return model && MODEL_VALUES.includes(model) ? (model as ModelAlias) : null
}

/** 창을 열 때 처음 고른 값: 저장된 설정(칸마다) → 지금 응답의 모델·effort → effort 는 Auto */
export function initialChoice(session: Pick<Session, 'model' | 'effort' | 'modelSetting'>): ModelChoice {
  const setting = session.modelSetting
  return {
    model: settingModel(setting?.model) ?? modelAlias(session.model),
    effort: effortChoice(setting?.effort) ?? effortChoice(session.effort) ?? 'auto',
  }
}

function aliasLabel(alias: string): string {
  return MODEL_OPTIONS.find((option) => option.value === alias)?.label ?? alias
}

/**
 * 지금 응답의 모델·effort 와 다른 설정이 저장돼 있으면 "Sonnet · high" (다음에 뜰 때 쓸 값), 같거나 설정이 없으면 null.
 * 칩 글자는 다음 응답이 와야 바뀌므로 그 사이를 툴팁으로 알린다
 */
export function nextLabel(session: Pick<Session, 'model' | 'effort' | 'modelSetting'>): string | null {
  const setting = session.modelSetting
  if (!setting) return null
  const model = settingModel(setting.model)
  const effort = effortChoice(setting.effort)
  const isModelChanged = model !== null && model !== modelAlias(session.model)
  const isEffortChanged = effort !== null && effort !== effortChoice(session.effort)
  if (!isModelChanged && !isEffortChanged) return null
  const nextModel = model ?? modelAlias(session.model)
  return [nextModel ? aliasLabel(nextModel) : null, effort ?? effortChoice(session.effort)].filter(Boolean).join(' · ')
}

/** Apply 를 막는 이유 한 줄. 막을 이유가 없으면 null */
export function blockReason(
  session: Pick<Session, 'status' | 'pendingTool' | 'shells'> & { question?: { questions: unknown[] } | null },
  hasQueuedMessage: boolean,
): string | null {
  const isAsking = Boolean(session.question?.questions.length) || session.pendingTool === 'AskUserQuestion'
  if (session.status === 'working' || session.status === 'needs-approval' || isAsking) return 'Wait until claude finishes'
  if (hasQueuedMessage) return 'Cancel or wait for the queued message'
  if ((session.shells ?? []).length > 0) return 'Wait for the running shells to finish'
  return null
}

export function isChanged(initial: ModelChoice, choice: ModelChoice): boolean {
  return choice.model !== initial.model || choice.effort !== initial.effort
}

/**
 * 고른 값에 따른 안내 문구들 (순서대로 보인다).
 * 모델이 바뀌면 캐시가 깨진다: 차례가 끝난 지 60분 안(시각을 모르면 안전하게 안으로 본다)일 때만 경고하고 문맥 크기를 알면 붙인다.
 * 모델은 그대로 effort 만 바뀌면 캐시 유지 안내
 */
export function noticeLines(
  session: Pick<Session, 'role' | 'turnEndedAt' | 'contextTokens'>,
  initial: ModelChoice,
  choice: ModelChoice,
  now: number,
): string[] {
  const lines: string[] = []
  if (choice.model !== initial.model) {
    const endedAt = session.turnEndedAt ? Date.parse(session.turnEndedAt) : Number.NaN
    const isCacheAlive = Number.isNaN(endedAt) || now - endedAt < CACHE_ALIVE_MS
    if (isCacheAlive) {
      const tokens = typeof session.contextTokens === 'number' ? ` (~${tokenLabel(session.contextTokens)} tokens)` : ''
      lines.push(`Switching model re-reads the whole conversation on the next turn${tokens}.`)
    }
  } else if (choice.effort !== initial.effort) {
    lines.push('Effort changes keep the prompt cache.')
  }
  lines.push('The session restarts for a few seconds.')
  if (session.role === 'lead') lines.push('Its team tools restart too; a background jk_wait stops and has to be called again.')
  return lines
}
