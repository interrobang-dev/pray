import { planOf } from './usage.js'

/**
 * Claude 계정 보관함·전환의 순수 로직 (파일·잠금·claude 실행 없음). 파일과 잠금은 accountStore.ts, claude 실행은 accountLogin.ts.
 * 토큰 값은 응답·로그·오류 문구에 넣지 않는다 — 이 모듈의 오류 문구에도 파일 내용을 싣지 않는다
 */

export type Json = Record<string, unknown>

/**
 * ~/.claude/.credentials.json 에서 로그인한 계정에 묶인 키. Claude Code 가 다시 로그인할 때 지우는 키와 같다
 * (2.1.310 performLogout 의 re-login prune). 그 밖의 키(mcpOAuth 등)는 계정과 무관해 전환해도 그대로 둔다
 */
export const ACCOUNT_CREDENTIAL_KEYS = [
  'claudeAiOauth',
  'organizationUuid',
  'trustedDeviceToken',
  'trustedDeviceEnrolledAfterRefusalAtMs',
  'enterpriseGateway',
  'designOauth',
  'cloudSessionsOauth',
] as const

/** 로그인·로그아웃 때 Claude Code 가 ~/.claude.json 에서 oauthAccount 와 함께 지우는 조직 캐시 키 (2.1.310) */
export const ORG_CACHE_KEYS = [
  'additionalModelOptionsCache',
  'additionalModelOptionsAnsweredAt',
  'additionalModelCostsCache',
  'modelAccessCache',
  'orgModelDefaultCache',
  'cachedArtifactRoster',
  'artifactRosterDenied',
  'lastSeenOrgDefaultUpdatedAt',
  'clientDataCache',
  'clientDataCacheSlots',
  'autoCompactWindowsCache',
  'cachedUsageUtilization',
  'metricsStatusCache',
  'metricsStatusCacheByPrincipal',
  'githubWebConnectionStatusCache',
  'unusedLimitResetStatusCache',
  'startupPrefetchedAt',
] as const

/** 보관한 계정 하나. id = accountUuid */
export interface StoredAccount {
  id: string
  /** 그 계정으로 로그인했을 때 Claude Code 가 ~/.claude.json 에 쓴 oauthAccount 그대로 (전환 때 그대로 되돌려 쓴다) */
  oauthAccount: Json
  /** .credentials.json 의 계정 키만 (ACCOUNT_CREDENTIAL_KEYS) */
  credentials: Json
  savedAt: string
  updatedAt: string
}

/** ~/.claude/jk-corp/accounts.json. 모르는 키도 보존한다 */
export interface Vault {
  accounts: StoredAccount[]
  [key: string]: unknown
}

/** 화면에 주는 계정 (web/src/types.ts 의 Account 와 손으로 맞춘다). 토큰은 없다 */
export interface Account {
  id: string
  email: string | null
  displayName: string | null
  organizationName: string | null
  plan: string | null
  isActive: boolean
  refreshExpiresAt: string | null
  savedAt: string
}

/** OAuth 프로필 API(`/api/oauth/profile`)에서 쓰는 값. Claude Code 와 같이 account.uuid·email, organization.uuid 가 있어야 받는다 */
export interface Profile {
  accountUuid: string
  email: string
  displayName: string | null
  organizationUuid: string
  organizationName: string | null
}

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/** 파일 내용을 오류 문구에 싣지 않으려고 해석 오류를 감싼다 (V8 의 JSON 오류는 원문 일부를 담는다) */
export class UnreadableFileError extends Error {
  constructor(readonly fileName: string) {
    super(`${fileName} can't be parsed`)
  }
}

/** JSON 객체 해석. 객체가 아니거나 해석에 실패하면 UnreadableFileError (원문은 담지 않는다) */
export function parseJsonObject(text: string, fileName: string): Json {
  let parsed: unknown
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    throw new UnreadableFileError(fileName)
  }
  if (!isObject(parsed)) throw new UnreadableFileError(fileName)
  return parsed
}

/** .credentials.json 에서 계정 키만 */
export function pickAccountKeys(credentials: Json): Json {
  const picked: Json = {}
  for (const key of ACCOUNT_CREDENTIAL_KEYS) if (key in credentials) picked[key] = credentials[key]
  return picked
}

/** .credentials.json 의 계정 키만 그 계정 것으로 바꾼 새 객체. 그 밖의 키는 그대로 */
export function withAccountKeys(credentials: Json, accountKeys: Json): Json {
  const next: Json = {}
  for (const [key, value] of Object.entries(credentials)) {
    if (!(ACCOUNT_CREDENTIAL_KEYS as readonly string[]).includes(key)) next[key] = value
  }
  return { ...next, ...pickAccountKeys(accountKeys) }
}

/** ~/.claude.json 의 oauthAccount 를 바꾸고 조직 캐시 키를 지운 새 객체 (Claude Code 가 로그인할 때 하는 것과 같다) */
export function withOauthAccount(config: Json, oauthAccount: Json): Json {
  const next: Json = { ...config, oauthAccount }
  for (const key of ORG_CACHE_KEYS) delete next[key]
  return next
}

function oauthOf(accountKeys: Json): Json | null {
  return isObject(accountKeys.claudeAiOauth) ? accountKeys.claudeAiOauth : null
}

export function refreshTokenOf(accountKeys: Json): string | null {
  return stringOrNull(oauthOf(accountKeys)?.refreshToken)
}

export function accessTokenOf(accountKeys: Json): string | null {
  return stringOrNull(oauthOf(accountKeys)?.accessToken)
}

/** 보관한 refresh token 이 정확히 같은 계정. 같은 refresh token = 같은 로그인이라 이것만으로 확실하다 */
export function findByRefreshToken(vault: Vault, refreshToken: string): StoredAccount | undefined {
  return vault.accounts.find((account) => refreshTokenOf(account.credentials) === refreshToken)
}

/** refresh token 만료 시각(ms). 모르면 null */
export function refreshExpiresAtOf(accountKeys: Json): number | null {
  const at = oauthOf(accountKeys)?.refreshTokenExpiresAt
  return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null
}

/** 보관함 파일 해석. 꼴이 틀리면 던진다 (기본값으로 넘어가면 다음 쓰기가 보관함을 통째로 지운다) */
export function parseVault(text: string): Vault {
  const parsed = parseJsonObject(text, 'accounts.json')
  const accounts = parsed.accounts ?? []
  if (!Array.isArray(accounts)) throw new UnreadableFileError('accounts.json')
  for (const account of accounts) {
    const isValid =
      isObject(account) &&
      typeof account.id === 'string' &&
      account.id !== '' &&
      isObject(account.oauthAccount) &&
      isObject(account.credentials) &&
      typeof account.savedAt === 'string'
    if (!isValid) throw new UnreadableFileError('accounts.json')
  }
  return { ...parsed, accounts: accounts as StoredAccount[] }
}

export function serializeVault(vault: Vault): string {
  return JSON.stringify(vault, null, 2) + '\n'
}

/** 그 계정을 넣거나 바꾼 새 보관함. 있던 계정은 savedAt·자리를 지키고 계정 키·oauthAccount 를 바꾼다 */
export function upsertStored(vault: Vault, entry: { id: string; oauthAccount: Json; credentials: Json }, now: Date): Vault {
  const at = now.toISOString()
  const credentials = pickAccountKeys(entry.credentials)
  const existing = vault.accounts.find((account) => account.id === entry.id)
  if (!existing) {
    return { ...vault, accounts: [...vault.accounts, { id: entry.id, oauthAccount: entry.oauthAccount, credentials, savedAt: at, updatedAt: at }] }
  }
  return {
    ...vault,
    accounts: vault.accounts.map((account) =>
      account.id === entry.id ? { ...account, oauthAccount: entry.oauthAccount, credentials, updatedAt: at } : account,
    ),
  }
}

export function removeStored(vault: Vault, id: string): Vault {
  return { ...vault, accounts: vault.accounts.filter((account) => account.id !== id) }
}

export function toAccount(stored: StoredAccount, activeId: string | null): Account {
  const oauth = oauthOf(stored.credentials)
  const refreshExpiresAt = refreshExpiresAtOf(stored.credentials)
  return {
    id: stored.id,
    email: stringOrNull(stored.oauthAccount.emailAddress),
    displayName: stringOrNull(stored.oauthAccount.displayName),
    organizationName: stringOrNull(stored.oauthAccount.organizationName),
    plan: planOf(oauth?.subscriptionType, oauth?.rateLimitTier),
    isActive: stored.id === activeId,
    refreshExpiresAt: refreshExpiresAt === null ? null : new Date(refreshExpiresAt).toISOString(),
    savedAt: stored.savedAt,
  }
}

/** 키 순서와 관계없이 같은 JSON 값인지 */
export function isSameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => isSameJson(item, b[index]))
  }
  if (!isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => key in b && isSameJson(a[key], b[key]))
}

/** OAuth 프로필 API 응답 → Profile. 꼴이 틀리면 null */
export function parseProfile(raw: unknown): Profile | null {
  if (!isObject(raw) || !isObject(raw.account) || !isObject(raw.organization)) return null
  const accountUuid = stringOrNull(raw.account.uuid)
  const email = stringOrNull(raw.account.email)
  const organizationUuid = stringOrNull(raw.organization.uuid)
  if (!accountUuid || !email || !organizationUuid) return null
  return {
    accountUuid,
    email,
    displayName: stringOrNull(raw.account.display_name),
    organizationUuid,
    organizationName: stringOrNull(raw.organization.name),
  }
}

/** ~/.claude.json 의 oauthAccount 를 아직 못 봤을 때 프로필로 만든 최소 oauthAccount (Claude Code 가 다음 프로필 조회 때 나머지를 채운다) */
export function oauthAccountFromProfile(profile: Profile): Json {
  return {
    accountUuid: profile.accountUuid,
    emailAddress: profile.email,
    organizationUuid: profile.organizationUuid,
    ...(profile.organizationName !== null && { organizationName: profile.organizationName }),
    ...(profile.displayName !== null && { displayName: profile.displayName }),
  }
}

/** 터미널 색·커서·하이퍼링크(OSC) 제어 문자를 지운다 */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
}

/** `claude auth login` 출력의 "If the browser didn't open, visit: <URL>" 의 수동 로그인 URL. 아직 없으면 null */
export function parseLoginUrl(output: string): string | null {
  const match = /visit:\s*(https:\/\/\S+)/.exec(stripAnsi(output))
  return match ? match[1] : null
}

/** 로그인 URL 의 state. 붙여 넣은 코드가 이 로그인 것인지 맞춰 본다 */
export function stateOfUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('state') || null
  } catch {
    return null
  }
}

export type AuthCodeCheck = { ok: true; line: string } | { ok: false; reason: 'format' | 'state' }

/**
 * 붙여 넣은 `code#state` 확인. claude 는 꼴(`#` 앞뒤가 비지 않음)만 보고 state 는 보지 않은 채 바로 토큰 교환을 해서,
 * 다른 로그인의 코드를 넣으면 교환에 실패하고 종료한다 (2.1.310 실측). 그래서 state 는 여기서 먼저 맞춘다
 */
export function checkAuthCode(input: unknown, expectedState: string): AuthCodeCheck {
  if (typeof input !== 'string') return { ok: false, reason: 'format' }
  const trimmed = input.trim()
  if (/\s/.test(trimmed)) return { ok: false, reason: 'format' }
  const [code, state] = trimmed.split('#')
  if (!code || !state) return { ok: false, reason: 'format' }
  if (state !== expectedState) return { ok: false, reason: 'state' }
  return { ok: true, line: `${code}#${state}` }
}

/** claude 출력의 마지막 "Login failed: <이유>" 의 이유 (한 줄, 200자). 없으면 null */
export function loginFailureOf(output: string): string | null {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => /Login failed:\s*(.+)/.exec(line)?.[1]?.trim())
    .filter((reason): reason is string => Boolean(reason))
  const last = lines.at(-1)
  return last ? last.slice(0, 200) : null
}
