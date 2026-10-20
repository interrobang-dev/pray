import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface UsageLimit {
  /** 사용자에게 보여줄 이름 (예: "5시간", "주간", "주간 Fable") */
  label: string
  percent: number
  resetsAt: string
  severity: string
}

export interface Usage {
  plan: string | null
  limits: UsageLimit[]
  fetchedAt: string
}

export type UsageResult = { ok: true; usage: Usage } | { ok: false; reason: string }

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const credentialsPath = join(homedir(), '.claude', '.credentials.json')

interface RawLimit {
  kind: string
  percent: number
  severity: string
  resets_at: string
  scope: { model?: { display_name?: string | null } | null; surface?: string | null } | null
}

const KIND_LABELS: Record<string, string> = {
  session: '5시간',
  weekly_all: '주간',
}

function labelOf(limit: RawLimit): string {
  const fixed = KIND_LABELS[limit.kind]
  if (fixed) return fixed
  const model = limit.scope?.model?.display_name
  if (model) return `주간 ${model}`
  return limit.kind
}

/** /api/oauth/usage 응답에서 화면에 쓸 값만 뽑는다. `limits` 배열이 없으면 five_hour / seven_day 로 대체 */
export function parseUsage(raw: unknown, plan: string | null, now: Date): Usage {
  const body = raw as { limits?: RawLimit[]; five_hour?: RawLimit; seven_day?: RawLimit }
  const source: RawLimit[] = Array.isArray(body.limits)
    ? body.limits
    : [
        body.five_hour && { ...body.five_hour, kind: 'session', percent: (body.five_hour as unknown as { utilization: number }).utilization },
        body.seven_day && { ...body.seven_day, kind: 'weekly_all', percent: (body.seven_day as unknown as { utilization: number }).utilization },
      ].filter((l): l is RawLimit => Boolean(l))
  return {
    plan,
    limits: source.map((limit) => ({
      label: labelOf(limit),
      percent: Math.round(limit.percent ?? 0),
      resetsAt: limit.resets_at,
      severity: limit.severity ?? 'normal',
    })),
    fetchedAt: now.toISOString(),
  }
}

async function readCredentials(): Promise<{ accessToken: string; plan: string | null } | null> {
  try {
    const parsed = JSON.parse(await readFile(credentialsPath, 'utf8'))
    const oauth = parsed.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string') return null
    return { accessToken: oauth.accessToken, plan: oauth.subscriptionType ?? null }
  } catch {
    return null
  }
}

/** 비공식 엔드포인트. Claude Code 가 로그인 시 저장한 OAuth 토큰을 그대로 쓴다. 토큰 갱신은 하지 않는다 (Claude Code 가 실행 중일 때 스스로 갱신) */
export async function fetchUsage(now = new Date()): Promise<UsageResult> {
  const credentials = await readCredentials()
  if (!credentials) return { ok: false, reason: 'Claude Code 로그인 정보 없음 (~/.claude/.credentials.json)' }
  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    return { ok: false, reason: `usage 조회 실패: ${(error as Error).message}` }
  }
  if (response.status === 401) return { ok: false, reason: '토큰 만료. claude 세션을 하나 실행하면 갱신됨' }
  if (!response.ok) return { ok: false, reason: `usage 조회 실패: HTTP ${response.status}` }
  return { ok: true, usage: parseUsage(await response.json(), credentials.plan, now) }
}

/** 브라우저가 여러 개 떠 있어도 호출 횟수를 ttl 당 1회로 제한 */
export function makeUsageCache(ttlMs: number, load: () => Promise<UsageResult> = fetchUsage) {
  let cached: { at: number; result: UsageResult } | null = null
  let inflight: Promise<UsageResult> | null = null
  return async (now = Date.now()): Promise<UsageResult> => {
    if (cached && now - cached.at < ttlMs) return cached.result
    if (!inflight) {
      inflight = load().then((result) => {
        cached = { at: Date.now(), result }
        inflight = null
        return result
      })
    }
    return inflight
  }
}
