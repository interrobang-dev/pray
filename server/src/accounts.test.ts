import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_CREDENTIAL_KEYS,
  checkAuthCode,
  findByRefreshToken,
  isSameJson,
  loginFailureOf,
  oauthAccountFromProfile,
  ORG_CACHE_KEYS,
  parseJsonObject,
  parseLoginUrl,
  parseProfile,
  parseVault,
  pickAccountKeys,
  removeStored,
  serializeVault,
  stateOfUrl,
  toAccount,
  upsertStored,
  withAccountKeys,
  withOauthAccount,
  type Vault,
} from './accounts.js'

const now = new Date('2026-10-25T03:00:00Z')

function oauth(refreshToken: string, extra: Record<string, unknown> = {}) {
  return {
    accessToken: `access-${refreshToken}`,
    refreshToken,
    expiresAt: 1_800_000_000_000,
    refreshTokenExpiresAt: Date.parse('2026-11-24T03:00:00Z'),
    scopes: ['user:inference'],
    subscriptionType: 'max',
    subscriptionTypeSource: 'profile',
    rateLimitTier: 'default_claude_max_5x',
    ...extra,
  }
}

describe('account keys', () => {
  it('picks only the keys tied to the account', () => {
    const file = {
      claudeAiOauth: oauth('r1'),
      organizationUuid: 'org-1',
      trustedDeviceToken: 't',
      mcpOAuth: { server: { accessToken: 'mcp' } },
      coworkRemoteDevice: { id: 'd' },
    }
    expect(pickAccountKeys(file)).toEqual({ claudeAiOauth: oauth('r1'), organizationUuid: 'org-1', trustedDeviceToken: 't' })
  })

  it('replaces the account keys and keeps the rest', () => {
    const file = {
      claudeAiOauth: oauth('r1'),
      organizationUuid: 'org-1',
      designOauth: { refreshToken: 'd1' },
      mcpOAuth: { server: { accessToken: 'mcp' } },
    }
    const next = withAccountKeys(file, { claudeAiOauth: oauth('r2'), mcpOAuth: { other: 'ignored' } })
    expect(next).toEqual({ mcpOAuth: { server: { accessToken: 'mcp' } }, claudeAiOauth: oauth('r2') })
    // 받은 객체는 바꾸지 않는다
    expect(file.organizationUuid).toBe('org-1')
  })

  it('covers the keys Claude Code prunes on re-login', () => {
    expect([...ACCOUNT_CREDENTIAL_KEYS]).toEqual([
      'claudeAiOauth',
      'organizationUuid',
      'trustedDeviceToken',
      'trustedDeviceEnrolledAfterRefusalAtMs',
      'enterpriseGateway',
      'designOauth',
      'cloudSessionsOauth',
    ])
  })
})

describe('withOauthAccount', () => {
  it('sets oauthAccount and clears the org caches only', () => {
    const config: Record<string, unknown> = { numStartups: 3, projects: { 'D:/x': {} }, oauthAccount: { accountUuid: 'a' } }
    for (const key of ORG_CACHE_KEYS) config[key] = 'cached'
    const next = withOauthAccount(config, { accountUuid: 'b', emailAddress: 'b@example.com' })
    expect(next).toEqual({ numStartups: 3, projects: { 'D:/x': {} }, oauthAccount: { accountUuid: 'b', emailAddress: 'b@example.com' } })
    expect(ORG_CACHE_KEYS).toHaveLength(17)
    expect(config.modelAccessCache).toBe('cached')
  })
})

describe('vault', () => {
  const stored = { id: 'a', oauthAccount: { accountUuid: 'a' }, credentials: { claudeAiOauth: oauth('r1') }, savedAt: 'x', updatedAt: 'x' }

  it('reads a missing accounts list as empty and keeps unknown keys', () => {
    expect(parseVault('{"version":2}')).toEqual({ version: 2, accounts: [] })
    const vault = parseVault(serializeVault({ accounts: [stored], note: 'kept' }))
    expect(vault).toEqual({ accounts: [stored], note: 'kept' })
  })

  it('throws on broken files without echoing their contents', () => {
    for (const text of ['{"accounts":[{"id":"a"}]}', '[]', '{"accounts":{}}', '{"accounts": [ secret-token']) {
      expect(() => parseVault(text)).toThrow('accounts.json can')
      try {
        parseVault(text)
      } catch (error) {
        expect((error as Error).message).not.toContain('secret')
      }
    }
    expect(() => parseJsonObject('{"refreshToken": "sk-ant-ort01-xyz', '.credentials.json')).toThrow(/^\.credentials\.json can't be parsed$/)
  })

  it('upserts in place keeping savedAt and the order', () => {
    let vault: Vault = { accounts: [] }
    vault = upsertStored(vault, { id: 'a', oauthAccount: { accountUuid: 'a' }, credentials: { claudeAiOauth: oauth('r1'), mcpOAuth: {} } }, now)
    vault = upsertStored(vault, { id: 'b', oauthAccount: { accountUuid: 'b' }, credentials: { claudeAiOauth: oauth('r2') } }, now)
    const later = new Date('2026-10-26T00:00:00Z')
    vault = upsertStored(vault, { id: 'a', oauthAccount: { accountUuid: 'a', displayName: 'A' }, credentials: { claudeAiOauth: oauth('r3') } }, later)
    expect(vault.accounts.map((account) => account.id)).toEqual(['a', 'b'])
    expect(vault.accounts[0]).toEqual({
      id: 'a',
      oauthAccount: { accountUuid: 'a', displayName: 'A' },
      credentials: { claudeAiOauth: oauth('r3') },
      savedAt: now.toISOString(),
      updatedAt: later.toISOString(),
    })
    expect(findByRefreshToken(vault, 'r2')?.id).toBe('b')
    expect(findByRefreshToken(vault, 'r1')).toBeUndefined()
    expect(removeStored(vault, 'a').accounts.map((account) => account.id)).toEqual(['b'])
  })
})

describe('toAccount', () => {
  it('shows the account without tokens', () => {
    const stored = {
      id: 'a',
      oauthAccount: { accountUuid: 'a', emailAddress: 'a@example.com', displayName: 'Ann', organizationName: "Ann's Org" },
      credentials: { claudeAiOauth: oauth('secret-refresh') },
      savedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }
    const account = toAccount(stored, 'a')
    expect(account).toEqual({
      id: 'a',
      email: 'a@example.com',
      displayName: 'Ann',
      organizationName: "Ann's Org",
      plan: 'max 5x',
      isActive: true,
      refreshExpiresAt: '2026-11-24T03:00:00.000Z',
      savedAt: now.toISOString(),
    })
    expect(JSON.stringify(account)).not.toContain('secret-refresh')
    expect(toAccount({ ...stored, oauthAccount: { accountUuid: 'a' }, credentials: {} }, null)).toMatchObject({
      email: null,
      displayName: null,
      organizationName: null,
      plan: null,
      isActive: false,
      refreshExpiresAt: null,
    })
  })
})

describe('profile', () => {
  it('needs account uuid·email and organization uuid like Claude Code', () => {
    const raw = {
      account: { uuid: 'a', email: 'a@example.com', display_name: 'Ann', full_name: 'Ann Lee' },
      organization: { uuid: 'org', name: "Ann's Org" },
    }
    const profile = parseProfile(raw)
    expect(profile).toEqual({ accountUuid: 'a', email: 'a@example.com', displayName: 'Ann', organizationUuid: 'org', organizationName: "Ann's Org" })
    expect(oauthAccountFromProfile(profile!)).toEqual({
      accountUuid: 'a',
      emailAddress: 'a@example.com',
      organizationUuid: 'org',
      organizationName: "Ann's Org",
      displayName: 'Ann',
    })
    expect(parseProfile({ account: { uuid: 'a' }, organization: { uuid: 'org' } })).toBeNull()
    expect(parseProfile({ account: { uuid: 'a', email: 'e' } })).toBeNull()
    expect(parseProfile(null)).toBeNull()
  })
})

describe('login output', () => {
  const url =
    'https://claude.com/cai/oauth/authorize?code=true&client_id=c&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&code_challenge=x&state=st4te'

  it('finds the manual sign-in address and its state', () => {
    const output = `Opening browser to sign in…\nIf the browser didn't open, visit: ${url}\nPaste code here if prompted > `
    expect(parseLoginUrl(output)).toBe(url)
    expect(parseLoginUrl('Opening browser to sign in…\n')).toBeNull()
    expect(stateOfUrl(url)).toBe('st4te')
    expect(stateOfUrl('not a url')).toBeNull()
  })

  it('reads the address through terminal hyperlinks and colors', () => {
    const output = `\x1b[2mIf the browser didn't open, visit: \x1b]8;;${url}\x07${url}\x1b]8;;\x07\x1b[22m\n`
    expect(parseLoginUrl(output)).toBe(url)
  })

  it('checks the code shape and that it belongs to this sign-in', () => {
    expect(checkAuthCode('  abc123#st4te \n', 'st4te')).toEqual({ ok: true, line: 'abc123#st4te' })
    expect(checkAuthCode('abc123#other', 'st4te')).toEqual({ ok: false, reason: 'state' })
    for (const bad of ['abc123', '#st4te', 'abc123#', 'abc 123#st4te', 'abc\n123#st4te', '', 42, null]) {
      expect(checkAuthCode(bad, 'st4te')).toEqual({ ok: false, reason: 'format' })
    }
  })

  it('takes the last failure reason', () => {
    const output = 'Invalid code. Please make sure the full code was copied.\nLogin failed: Request failed with status code 400\n'
    expect(loginFailureOf(output)).toBe('Request failed with status code 400')
    expect(loginFailureOf('Login successful.\n')).toBeNull()
  })
})

describe('isSameJson', () => {
  it('ignores key order', () => {
    expect(isSameJson({ a: 1, b: { c: [1, { d: 2 }] } }, { b: { c: [1, { d: 2 }] }, a: 1 })).toBe(true)
    expect(isSameJson({ a: 1 }, { a: 1, b: undefined })).toBe(false)
    expect(isSameJson([1, 2], [2, 1])).toBe(false)
  })
})
