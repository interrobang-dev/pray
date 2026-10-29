import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from './accounts.js'
import {
  AccountError,
  accountErrorBody,
  defaultAccountPaths,
  makeAccountStore,
  type AccountPaths,
  type RunClaudeAuth,
} from './accountStore.js'

let home: string
let paths: AccountPaths
let profiles: Map<string, Profile>
let fetchProfile: ReturnType<typeof vi.fn<(token: string) => Promise<Profile | null>>>
let runClaude: ReturnType<typeof vi.fn<RunClaudeAuth>>
let onChange: ReturnType<typeof vi.fn<() => void>>

function oauth(refreshToken: string, extra: Record<string, unknown> = {}) {
  return {
    accessToken: `access-${refreshToken}`,
    refreshToken,
    expiresAt: 1_800_000_000_000,
    refreshTokenExpiresAt: Date.parse('2099-01-01T00:00:00Z'),
    scopes: ['user:inference'],
    subscriptionType: 'max',
    rateLimitTier: 'default_claude_max_20x',
    ...extra,
  }
}

const oauthAccountA = { accountUuid: 'a', emailAddress: 'a@example.com', organizationUuid: 'org-a', organizationName: 'A Org', displayName: 'Ann' }
const oauthAccountB = { accountUuid: 'b', emailAddress: 'b@example.com', organizationUuid: 'org-b', organizationName: 'B Org', displayName: 'Bo' }
const profileA: Profile = { accountUuid: 'a', email: 'a@example.com', displayName: 'Ann', organizationUuid: 'org-a', organizationName: 'A Org' }
const profileB: Profile = { accountUuid: 'b', email: 'b@example.com', displayName: 'Bo', organizationUuid: 'org-b', organizationName: 'B Org' }

function writeCredentials(value: unknown) {
  writeFileSync(paths.credentialsPath, JSON.stringify(value))
}

function writeConfig(value: unknown) {
  writeFileSync(paths.claudeJsonPath, JSON.stringify(value, null, 2))
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function vaultIds(): string[] {
  return readJson(paths.vaultPath).accounts.map((account: { id: string }) => account.id)
}

function storedRefresh(id: string): string {
  return readJson(paths.vaultPath).accounts.find((account: { id: string }) => account.id === id).credentials.claudeAiOauth.refreshToken
}

function makeStore() {
  return makeAccountStore({
    paths,
    fetchProfile,
    runClaude,
    onChange,
    lockRetries: 0,
    makeTempDir: () => mkdtempSync(join(home, 'tmp-')),
  })
}

async function expectError(promise: Promise<unknown>, status: number, message?: RegExp) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(AccountError)
  expect((error as AccountError).status).toBe(status)
  if (message) expect((error as AccountError).message).toMatch(message)
}

/** 기본 폴더가 B 로 로그인 → 보관, 다시 A 로 로그인(터미널 /login 처럼) → 보관. 지금 계정 A */
async function seedAB() {
  const store = makeStore()
  writeCredentials({ claudeAiOauth: oauth('rB1'), mcpOAuth: { server: { accessToken: 'mcp' } } })
  writeConfig({ oauthAccount: oauthAccountB, numStartups: 7 })
  await store.list()
  writeCredentials({ claudeAiOauth: oauth('rA1'), mcpOAuth: { server: { accessToken: 'mcp' } } })
  writeConfig({ oauthAccount: oauthAccountA, numStartups: 7, modelAccessCache: ['x'], cachedUsageUtilization: 1 })
  await store.list()
  fetchProfile.mockClear()
  return store
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'jk-accounts-test-'))
  paths = defaultAccountPaths(home)
  mkdirSync(paths.claudeDir)
  profiles = new Map([
    ['access-rA1', profileA],
    ['access-rA2', profileA],
    ['access-rB1', profileB],
  ])
  fetchProfile = vi.fn(async (token: string) => profiles.get(token) ?? null)
  runClaude = vi.fn<RunClaudeAuth>(async () => ({ exitCode: 0, output: 'Successfully logged out from your Anthropic account.' }))
  onChange = vi.fn()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

describe('accountErrorBody', () => {
  it('sends the message with the extra fields, and the message wins', () => {
    expect(accountErrorBody(new AccountError(404, 'No saved account with that id'))).toEqual({ message: 'No saved account with that id' })
    expect(accountErrorBody(new AccountError(400, 'Claude rejected the code', { isLoginEnded: true, message: 'ignored' }))).toEqual({
      isLoginEnded: true,
      message: 'Claude rejected the code',
    })
  })
})

describe('list', () => {
  it('saves the signed-in account once the profile API confirms it', async () => {
    writeCredentials({ claudeAiOauth: oauth('rA1'), mcpOAuth: { server: {} } })
    writeConfig({ oauthAccount: oauthAccountA })
    const store = makeStore()
    const result = await store.list()
    expect(result.activeId).toBe('a')
    expect(result.accounts).toEqual([expect.objectContaining({ id: 'a', email: 'a@example.com', plan: 'max 20x', isActive: true })])
    const vault = readJson(paths.vaultPath)
    expect(vault.accounts[0].credentials).toEqual({ claudeAiOauth: oauth('rA1') })
    expect(vault.accounts[0].oauthAccount).toEqual(oauthAccountA)
    // 보관한 토큰이면 프로필을 다시 묻지 않는다
    await store.list()
    expect(fetchProfile).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('rA1')
  })

  it("doesn't save or mark an account it can't confirm, and waits before asking again", async () => {
    writeCredentials({ claudeAiOauth: oauth('rX') })
    writeConfig({ oauthAccount: oauthAccountA })
    const store = makeStore()
    expect(await store.list()).toEqual({ accounts: [], activeId: null })
    expect(existsSync(paths.vaultPath)).toBe(false)
    await store.list()
    expect(fetchProfile).toHaveBeenCalledTimes(1)
  })

  it('attaches a new token by the profile API, not by ~/.claude.json', async () => {
    const store = await seedAB()
    // 터미널에서 /login 으로 B 가 됐는데 ~/.claude.json 은 아직 A
    profiles.set('access-rB2', profileB)
    writeCredentials({ claudeAiOauth: oauth('rB2') })
    const result = await store.list()
    expect(result.activeId).toBe('b')
    expect(storedRefresh('a')).toBe('rA1')
    expect(storedRefresh('b')).toBe('rB2')
  })

  it('stores a rotated token on the same account and refreshes oauthAccount from ~/.claude.json', async () => {
    const store = await seedAB()
    writeCredentials({ claudeAiOauth: oauth('rA2') })
    writeConfig({ oauthAccount: { ...oauthAccountA, displayName: 'Ann Lee' } })
    const result = await store.list()
    expect(result.activeId).toBe('a')
    expect(storedRefresh('a')).toBe('rA2')
    expect(result.accounts.find((account) => account.id === 'a')?.displayName).toBe('Ann Lee')
    expect(vaultIds()).toEqual(['b', 'a'])
  })

  it('refuses to work over a broken accounts.json', async () => {
    mkdirSync(dirname(paths.vaultPath))
    writeFileSync(paths.vaultPath, '{"accounts": [ broken')
    await expectError(makeStore().list(), 500, /accounts\.json/)
    expect(readFileSync(paths.vaultPath, 'utf8')).toBe('{"accounts": [ broken')
  })
})

describe('switchTo', () => {
  it('writes the current login back, then swaps only the account keys and oauthAccount', async () => {
    const store = await seedAB()
    // A 의 claude 가 토큰을 갱신했다 (아직 동기화 전)
    writeCredentials({ claudeAiOauth: oauth('rA2'), organizationUuid: 'org-a', mcpOAuth: { server: { accessToken: 'mcp' } } })
    const account = await store.switchTo('b')
    expect(account).toMatchObject({ id: 'b', isActive: true })
    expect(storedRefresh('a')).toBe('rA2')
    expect(readJson(paths.vaultPath).accounts.find((stored: { id: string }) => stored.id === 'a').credentials.organizationUuid).toBe('org-a')
    const credentialsText = readFileSync(paths.credentialsPath, 'utf8')
    expect(credentialsText).not.toContain('\n')
    expect(JSON.parse(credentialsText)).toEqual({ mcpOAuth: { server: { accessToken: 'mcp' } }, claudeAiOauth: oauth('rB1') })
    const configText = readFileSync(paths.claudeJsonPath, 'utf8')
    expect(configText.startsWith('{\n  "')).toBe(true)
    expect(JSON.parse(configText)).toEqual({ oauthAccount: oauthAccountB, numStartups: 7 })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((await store.list()).activeId).toBe('b')
    // 잠금은 다 풀렸다
    expect(readdirSync(paths.claudeDir).filter((name) => name.includes('lock'))).toEqual([])
    expect(existsSync(`${paths.claudeDir}.lock`)).toBe(false)
    expect(existsSync(`${paths.claudeJsonPath}.lock`)).toBe(false)
  })

  it('rejects unknown, current and expired accounts', async () => {
    const store = await seedAB()
    await expectError(store.switchTo('nobody'), 404)
    await expectError(store.switchTo('a'), 409, /Already/)
    const vault = readJson(paths.vaultPath)
    vault.accounts.find((stored: { id: string }) => stored.id === 'b').credentials.claudeAiOauth.refreshTokenExpiresAt = Date.parse('2020-01-01')
    writeFileSync(paths.vaultPath, JSON.stringify(vault))
    await expectError(store.switchTo('b'), 409, /expired/)
    expect(onChange).not.toHaveBeenCalled()
  })

  it("waits for Claude Code's refresh lock and gives up with 409", async () => {
    const store = await seedAB()
    mkdirSync(join(paths.claudeDir, '.oauth_refresh.lock'))
    const before = readFileSync(paths.credentialsPath, 'utf8')
    await expectError(store.switchTo('b'), 409, /refreshing/)
    rmSync(join(paths.claudeDir, '.oauth_refresh.lock'), { recursive: true })
    mkdirSync(`${paths.claudeDir}.lock`)
    await expectError(store.switchTo('b'), 409, /refreshing/)
    expect(existsSync(join(paths.claudeDir, '.oauth_refresh.lock'))).toBe(false)
    expect(readFileSync(paths.credentialsPath, 'utf8')).toBe(before)
  })

  it("changes nothing when it can't tell whose login is in the file", async () => {
    const store = await seedAB()
    writeCredentials({ claudeAiOauth: oauth('rUnknown') })
    const before = readFileSync(paths.credentialsPath, 'utf8')
    const vaultBefore = readFileSync(paths.vaultPath, 'utf8')
    await expectError(store.switchTo('b'), 500, /Nothing was changed/)
    expect(readFileSync(paths.credentialsPath, 'utf8')).toBe(before)
    expect(readFileSync(paths.vaultPath, 'utf8')).toBe(vaultBefore)
  })

  it('switches into a signed-out default folder', async () => {
    const store = await seedAB()
    rmSync(paths.credentialsPath)
    await store.switchTo('b')
    expect(readJson(paths.credentialsPath)).toEqual({ claudeAiOauth: oauth('rB1') })
  })
})

describe('remove', () => {
  it('revokes a saved account from a temp folder holding only its account keys', async () => {
    const store = await seedAB()
    let seen: { args: string[]; files: string[]; credentials: unknown; config: unknown } | null = null
    runClaude.mockImplementation(async (args, configDir) => {
      seen = {
        args,
        files: readdirSync(configDir!).sort(),
        credentials: readJson(join(configDir!, '.credentials.json')),
        config: readJson(join(configDir!, '.claude.json')),
      }
      return { exitCode: 0, output: '' }
    })
    await store.remove('b')
    expect(seen).toEqual({
      args: ['auth', 'logout'],
      files: ['.claude.json', '.credentials.json'],
      credentials: { claudeAiOauth: oauth('rB1') },
      config: { oauthAccount: oauthAccountB },
    })
    expect(vaultIds()).toEqual(['a'])
    expect(readdirSync(home).filter((name) => name.startsWith('tmp-'))).toEqual([])
    // 기본 폴더는 그대로
    expect(readJson(paths.credentialsPath).claudeAiOauth.refreshToken).toBe('rA1')
  })

  it('keeps the account when the revoke run fails', async () => {
    const store = await seedAB()
    runClaude.mockResolvedValue({ exitCode: 1, output: 'Logout failed: boom\n' })
    await expectError(store.remove('b'), 500, /exited with code 1: Logout failed: boom/)
    expect(vaultIds()).toEqual(['b', 'a'])
  })

  it('refuses the current account and an unconfirmed current login', async () => {
    const store = await seedAB()
    await expectError(store.remove('a'), 409, /current account/)
    writeCredentials({ claudeAiOauth: oauth('rUnknown') })
    await expectError(store.remove('b'), 409, /Couldn't confirm/)
    await expectError(store.remove('nobody'), 404)
    expect(runClaude).not.toHaveBeenCalled()
  })
})

describe('logout', () => {
  it('logs out in the default folder and drops the current account', async () => {
    const store = await seedAB()
    await store.logout()
    expect(runClaude).toHaveBeenCalledWith(['auth', 'logout'], null)
    expect(vaultIds()).toEqual(['b'])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps everything when claude fails', async () => {
    const store = await seedAB()
    runClaude.mockResolvedValue({ exitCode: null, output: 'spawn claude.exe ENOENT' })
    await expectError(store.logout(), 500, /didn't finish: spawn claude\.exe ENOENT/)
    expect(vaultIds()).toEqual(['b', 'a'])
  })
})

describe('saveLogin', () => {
  function loginDir(refreshToken: string, oauthAccount: unknown) {
    const dir = mkdtempSync(join(home, 'login-'))
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth(refreshToken) }))
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount, numStartups: 0 }))
    return dir
  }

  it('keeps a new account without switching', async () => {
    const store = await seedAB()
    const before = readFileSync(paths.credentialsPath, 'utf8')
    const account = await store.saveLogin(loginDir('rC1', { accountUuid: 'c', emailAddress: 'c@example.com' }))
    expect(account).toMatchObject({ id: 'c', email: 'c@example.com', isActive: false })
    expect(vaultIds()).toEqual(['b', 'a', 'c'])
    expect(readFileSync(paths.credentialsPath, 'utf8')).toBe(before)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('replaces a saved account and, if it is the current one, the default login too', async () => {
    const store = await seedAB()
    await store.saveLogin(loginDir('rB9', oauthAccountB))
    expect(storedRefresh('b')).toBe('rB9')
    const account = await store.saveLogin(loginDir('rA9', oauthAccountA))
    expect(account).toMatchObject({ id: 'a', isActive: true })
    expect(storedRefresh('a')).toBe('rA9')
    expect(readJson(paths.credentialsPath)).toEqual({ claudeAiOauth: oauth('rA9'), mcpOAuth: { server: { accessToken: 'mcp' } } })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect((await store.list()).activeId).toBe('a')
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it('fails when claude left no login behind', async () => {
    const store = makeStore()
    const dir = mkdtempSync(join(home, 'login-'))
    await expectError(store.saveLogin(dir), 500, /no login/)
  })
})
