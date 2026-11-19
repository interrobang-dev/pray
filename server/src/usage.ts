import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface UsageLimit {
  /** 상태 표시줄에 보여줄 짧은 이름 (예: "5h", "wk", "Fable") */
  label: string
  /** 한도 종류 (session·weekly_all·weekly_scoped 등). 화면이 상세 창의 긴 이름을 정한다 */
  kind: string
  /** 모델별 한도의 모델 표시 이름. 아니면 null */
  model: string | null
  percent: number
  resetsAt: string
  severity: string
}

export interface Usage {
  plan: string | null
  /** 로그인된 Claude 계정 이메일 (~/.claude.json 의 oauthAccount.emailAddress). 못 읽으면 null */
  email: string | null
  limits: UsageLimit[]
  fetchedAt: string
}

export type UsageResult = { ok: true; usage: Usage } | { ok: false; reason: string }

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const credentialsPath = join(homedir(), '.claude', '.credentials.json')
const claudeJsonPath = join(homedir(), '.claude.json')

interface RawLimit {
  kind: string
  percent: number
  severity: string
  resets_at: string
  scope: { model?: { display_name?: string | null } | null; surface?: string | null } | null
}

const KIND_LABELS: Record<string, string> = {
  session: '5h',
  weekly_all: 'wk',
}

function labelOf(limit: RawLimit): string {
  const fixed = KIND_LABELS[limit.kind]
  if (fixed) return fixed
  return modelOf(limit) ?? limit.kind
}

function modelOf(limit: RawLimit): string | null {
  return limit.scope?.model?.display_name || null
}

/** /api/oauth/usage 응답에서 화면에 쓸 값만 뽑는다. `limits` 배열이 없으면 five_hour / seven_day 로 대체 */
export function parseUsage(raw: unknown, account: { plan: string | null; email: string | null }, now: Date): Usage {
  const body = raw as { limits?: RawLimit[]; five_hour?: RawLimit; seven_day?: RawLimit }
  const source: RawLimit[] = Array.isArray(body.limits)
    ? body.limits
    : [
        body.five_hour && { ...body.five_hour, kind: 'session', percent: (body.five_hour as unknown as { utilization: number }).utilization },
        body.seven_day && { ...body.seven_day, kind: 'weekly_all', percent: (body.seven_day as unknown as { utilization: number }).utilization },
      ].filter((l): l is RawLimit => Boolean(l))
  return {
    plan: account.plan,
    email: account.email,
    limits: source.map((limit) => ({
      label: labelOf(limit),
      kind: limit.kind,
      model: modelOf(limit),
      percent: Math.round(limit.percent ?? 0),
      resetsAt: limit.resets_at,
      severity: limit.severity ?? 'normal',
    })),
    fetchedAt: now.toISOString(),
  }
}

/** 요금제 이름. rateLimitTier 끝이 `_<숫자>x`(예: default_claude_max_5x)면 배수를 붙여 "max 5x", 아니면 subscriptionType 그대로 */
export function planOf(subscriptionType: unknown, rateLimitTier: unknown): string | null {
  if (typeof subscriptionType !== 'string' || !subscriptionType) return null
  const multiplier = typeof rateLimitTier === 'string' ? /_(\d+)x$/.exec(rateLimitTier)?.[1] : undefined
  return multiplier ? `${subscriptionType} ${multiplier}x` : subscriptionType
}

/**
 * 화면에 보일 요금제 이름. ~/.claude.json oauthAccount 의 `planDisplayName`(예 "Ultra")이 있으면 그것, 없으면 credentials 의 planOf.
 * credentials 의 subscriptionType·rateLimitTier 는 로그인 때 적혀(`subscriptionTypeSource: sign_in`) 플랜을 바꿔도 다시 로그인하기 전에는 그대로이고,
 * oauthAccount 는 Claude Code 가 프로필을 받을 때마다 고쳐 쓴다 (실측: credentials 는 max 5x 인데 oauthAccount 는 Ultra·max_20x)
 */
export function accountPlanOf(oauthAccount: unknown, oauth: { subscriptionType?: unknown; rateLimitTier?: unknown } | null | undefined): string | null {
  const displayName = (oauthAccount as { planDisplayName?: unknown } | null | undefined)?.planDisplayName
  if (typeof displayName === 'string' && displayName.trim()) return displayName.trim()
  return planOf(oauth?.subscriptionType, oauth?.rateLimitTier)
}

async function readCredentials(): Promise<{ accessToken: string; subscriptionType: unknown; rateLimitTier: unknown } | null> {
  try {
    const parsed = JSON.parse(await readFile(credentialsPath, 'utf8'))
    const oauth = parsed.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string') return null
    return { accessToken: oauth.accessToken, subscriptionType: oauth.subscriptionType, rateLimitTier: oauth.rateLimitTier }
  } catch {
    return null
  }
}

/** Claude Code 가 ~/.claude.json 에 남긴 oauthAccount. 읽기만 한다 (Claude Code 가 수시로 다시 쓰는 파일이라 쓰는 중이면 해석에 실패할 수 있다). 없거나 못 읽으면 null */
async function readOauthAccount(path: string): Promise<Record<string, unknown> | null> {
  try {
    const account = JSON.parse(await readFile(path, 'utf8'))?.oauthAccount
    return account && typeof account === 'object' ? account : null
  } catch {
    return null
  }
}

/** oauthAccount 의 이메일. 없거나 못 읽으면 null */
function emailOf(oauthAccount: Record<string, unknown> | null): string | null {
  const email = oauthAccount?.emailAddress
  return typeof email === 'string' && email ? email : null
}

/** Claude Code 가 로그인 때 ~/.claude.json 에 남긴 계정 이메일. 없거나 못 읽으면 null */
export async function readAccountEmail(path = claudeJsonPath): Promise<string | null> {
  return emailOf(await readOauthAccount(path))
}

/** 비공식 엔드포인트. Claude Code 가 로그인 시 저장한 OAuth 토큰을 그대로 쓴다. 토큰 갱신은 하지 않는다 (Claude Code 가 실행 중일 때 스스로 갱신) */
export async function fetchUsage(now = new Date()): Promise<UsageResult> {
  const credentials = await readCredentials()
  if (!credentials) return { ok: false, reason: 'No Claude Code login (~/.claude/.credentials.json)' }
  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${credentials.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    return { ok: false, reason: `Usage request failed: ${(error as Error).message}` }
  }
  if (response.status === 401) return { ok: false, reason: 'Token expired. Run a claude session to refresh it' }
  if (!response.ok) return { ok: false, reason: `Usage request failed: HTTP ${response.status}` }
  const raw: unknown = await response.json()
  const oauthAccount = await readOauthAccount(claudeJsonPath)
  return { ok: true, usage: parseUsage(raw, { plan: accountPlanOf(oauthAccount, credentials), email: emailOf(oauthAccount) }, now) }
}

/**
 * 브라우저가 여러 개 떠 있어도 호출 횟수를 ttl 당 1회로 제한.
 * `clear()` 는 계정을 바꾼 뒤 부른다: 캐시를 비우고, 그 전에 시작한 조회(옛 계정 토큰)의 결과는 캐시에 넣지 않는다
 */
export function makeUsageCache(ttlMs: number, load: () => Promise<UsageResult> = fetchUsage) {
  let cached: { at: number; result: UsageResult } | null = null
  let inflight: Promise<UsageResult> | null = null
  let generation = 0
  const read = async (now = Date.now()): Promise<UsageResult> => {
    if (cached && now - cached.at < ttlMs) return cached.result
    if (!inflight) {
      const startedIn = generation
      const request = load().then((result) => {
        if (startedIn === generation) {
          cached = { at: Date.now(), result }
          inflight = null
        }
        return result
      })
      inflight = request
    }
    return inflight
  }
  return Object.assign(read, {
    clear(): void {
      generation++
      cached = null
      inflight = null
    },
  })
}
