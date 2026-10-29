import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { lock, type LockOptions } from 'proper-lockfile'
import { DATA_DIR_NAME, dataDir } from '@pray/host/dataDir'
import {
  accessTokenOf,
  findByRefreshToken,
  isObject,
  isSameJson,
  oauthAccountFromProfile,
  parseJsonObject,
  parseProfile,
  parseVault,
  pickAccountKeys,
  refreshExpiresAtOf,
  refreshTokenOf,
  removeStored,
  serializeVault,
  toAccount,
  upsertStored,
  withAccountKeys,
  withOauthAccount,
  type Account,
  type Json,
  type Profile,
  type Vault,
} from './accounts.js'

/**
 * Claude 계정 보관함(~/.claude/pray/accounts.json)과 기본 폴더 로그인 파일(~/.claude/.credentials.json·~/.claude.json) 다루기.
 * 한 번에 한 계정만 기본 폴더에 있다 (A 방식). 토큰 값은 응답·로그·오류 문구에 넣지 않는다
 */

/** Claude Code 가 토큰의 계정을 물을 때 쓰는 OAuth 프로필 API (2.1.310 바이너리의 `${BASE_API_URL}/api/oauth/profile`) */
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile'
const PROFILE_TIMEOUT_MS = 10_000
/** 프로필 조회에 실패한 토큰은 이 시간 동안 다시 묻지 않는다 (목록 요청마다 10초씩 기다리지 않게) */
const PROFILE_RETRY_MS = 60_000
/** 기본 폴더 .credentials.json 이 바뀌었는지 보는 간격 (fs.watch 가 놓친 것까지) */
const POLL_MS = 5_000
const WATCH_DEBOUNCE_MS = 300
/** Claude Code 의 토큰 갱신 잠금과 같은 값 (2.1.310: lockfilePath `<claudeDir>/.oauth_refresh.lock`, realpath false, stale 60000, update 5000) */
const REFRESH_LOCK = { realpath: false, stale: 60_000, update: 5_000 } as const
/** Claude Code 의 ~/.claude.json 쓰기 잠금 (`~/.claude.json.lock`, proper-lockfile 기본 stale 10000) */
const CONFIG_LOCK = { realpath: false, stale: 10_000 } as const
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

/** 화면에 그대로 돌려줄 상태코드와 영어 문구 */
export class AccountError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** 응답 본문에 message 와 같이 싣는 값 (예: 로그인 코드 400 의 isLoginEnded) */
    readonly fields: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

/** 화면에 보내는 오류 본문 `{ message, ...fields }` */
export function accountErrorBody(error: AccountError): Record<string, unknown> {
  return { ...error.fields, message: error.message }
}

export interface AccountPaths {
  claudeDir: string
  credentialsPath: string
  claudeJsonPath: string
  vaultPath: string
}

/** 시험은 홈을 넘긴다. 넘기지 않으면 실제 홈이고 보관함은 설정 폴더 이전 규칙(dataDir)을 따른다 */
export function defaultAccountPaths(home?: string): AccountPaths {
  const claudeDir = join(home ?? homedir(), '.claude')
  return {
    claudeDir,
    credentialsPath: join(claudeDir, '.credentials.json'),
    claudeJsonPath: join(home ?? homedir(), '.claude.json'),
    vaultPath: join(home === undefined ? dataDir() : join(claudeDir, DATA_DIR_NAME), 'accounts.json'),
  }
}

/** accessToken 의 계정. 실패(네트워크·401·꼴이 틀림)면 null */
export type FetchProfile = (accessToken: string) => Promise<Profile | null>

export function makeFetchProfile(fetchImpl: typeof fetch = (input, init) => fetch(input, init)): FetchProfile {
  return async (accessToken) => {
    try {
      const response = await fetchImpl(PROFILE_URL, {
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
      })
      if (!response.ok) {
        console.warn(`OAuth 프로필 조회 실패: HTTP ${response.status}`)
        return null
      }
      const profile = parseProfile(await response.json())
      if (!profile) console.warn('OAuth 프로필 조회 실패: 응답 꼴이 다름')
      return profile
    } catch (error) {
      console.warn(`OAuth 프로필 조회 실패: ${(error as Error).name}`)
      return null
    }
  }
}

export interface ClaudeRunResult {
  /** 실행조차 못 했거나 시간 초과로 죽였으면 null */
  exitCode: number | null
  output: string
}

/** `claude <args>` 한 번 실행. configDir 이 null 이면 기본 폴더(~/.claude) */
export type RunClaudeAuth = (args: string[], configDir: string | null) => Promise<ClaudeRunResult>

/** 로그인·폐기 때 계정 키가 잠깐 들어가는 임시 설정 폴더 (`<tmp>/pray-account-*`). 끝나면 지운다 */
const ACCOUNT_TEMP_PREFIX = 'pray-account-'
/** 이름을 바꾸기 전 서버가 남긴 임시 폴더. 오래된 것은 같이 지운다 (호환 코드) */
const LEGACY_ACCOUNT_TEMP_PREFIX = 'jk-corp-account-'
/** 서버가 죽어 남은 임시 폴더를 지우는 기준. 가장 긴 로그인(10분)보다 길게 */
const STALE_TEMP_MS = 15 * 60_000

export function makeAccountTempDir(): string {
  return mkdtempSync(join(tmpdir(), ACCOUNT_TEMP_PREFIX))
}

export function removeAccountTempDir(dir: string): void {
  try {
    // claude 가 막 끝나 파일을 아직 쥐고 있을 수 있다
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  } catch (error) {
    console.error(`계정 임시 폴더를 못 지움 (${dir}): ${(error as Error).message}`)
  }
}

/** 서버가 로그인 도중 죽어 남은 임시 폴더 (토큰이 들어 있을 수 있다). root 는 시험용 */
export function removeStaleAccountTempDirs(nowMs = Date.now(), root = tmpdir()): void {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith(ACCOUNT_TEMP_PREFIX) && !name.startsWith(LEGACY_ACCOUNT_TEMP_PREFIX)) continue
    const dir = join(root, name)
    try {
      if (nowMs - statSync(dir).mtimeMs > STALE_TEMP_MS) removeAccountTempDir(dir)
    } catch {
      // 그 사이 지워졌다
    }
  }
}

/** 보관함을 쓰는 작업을 한 번에 하나만 (동기화·전환·지우기가 서로의 쓰기를 덮지 않게) */
function makeExclusive() {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task)
    chain = run.catch(() => {})
    return run
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS)
    }
  }
}

/** 같은 폴더 임시 파일에 다 쓴 뒤 바꿔 끼운다 (Claude Code 도 이렇게 쓴다. 링크로 바꿔 끼우지 않는다) */
export function writeFileAtomic(path: string, text: string): void {
  const tempPath = `${path}.pray.${process.pid}.tmp`
  try {
    writeFileSync(tempPath, text)
    renameWithRetry(tempPath, path)
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

interface JsonFile {
  text: string
  value: Json
}

/** 없으면 null. 못 읽거나 해석이 안 되면 AccountError 500 (파일 내용은 문구에 넣지 않는다) */
function readJsonFile(path: string, name: string): JsonFile | null {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new AccountError(500, `Couldn't read ${name}`)
  }
  try {
    return { text, value: parseJsonObject(text, name) }
  } catch {
    throw new AccountError(500, `Couldn't parse ${name}`)
  }
}

type Identity =
  /** 기본 폴더에 로그인이 없다 */
  | { kind: 'none' }
  /** 로그인은 있는데 어느 계정 것인지 확실하지 않다 (보관한 토큰이 아니고 프로필 조회도 실패) */
  | { kind: 'unknown' }
  /** profile 은 프로필 API 로 알았을 때만 */
  | { kind: 'known'; id: string; profile: Profile | null }

interface Snapshot {
  vault: Vault
  activeId: string | null
  isActiveUnknown: boolean
}

export interface AccountStoreOptions {
  runClaude: RunClaudeAuth
  paths?: AccountPaths
  fetchProfile?: FetchProfile
  now?: () => Date
  /** 기본 폴더의 계정이 바뀐 뒤 (전환·로그아웃·같은 계정 다시 로그인). 사용량 캐시를 비운다 */
  onChange?: () => void
  /** 잠금 재시도 (시험에서 줄인다) */
  lockRetries?: LockOptions['retries']
  makeTempDir?: () => string
  removeTempDir?: (dir: string) => void
}

export function makeAccountStore(options: AccountStoreOptions) {
  const paths = options.paths ?? defaultAccountPaths()
  const fetchProfile = options.fetchProfile ?? makeFetchProfile()
  const now = options.now ?? (() => new Date())
  const onChange = options.onChange ?? (() => {})
  // Claude Code 는 갱신하는 동안(1~2초)만 잡는다. 약 8초 기다리고 포기한다
  const lockRetries = options.lockRetries ?? { retries: 10, minTimeout: 200, maxTimeout: 1_000 }
  const makeTempDir = options.makeTempDir ?? makeAccountTempDir
  const removeTempDir = options.removeTempDir ?? removeAccountTempDir
  const exclusive = makeExclusive()
  /** 프로필 조회에 실패한 토큰(해시)과 다시 물을 시각 */
  let profileFailure: { tokenHash: string; retryAt: number } | null = null

  function readVault(): Vault {
    let text: string
    try {
      text = readFileSync(paths.vaultPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { accounts: [] }
      throw new AccountError(500, "Couldn't read the saved accounts (accounts.json)")
    }
    try {
      return parseVault(text)
    } catch {
      // 기본값으로 넘어가면 다음 쓰기가 보관함을 통째로 지운다
      throw new AccountError(500, "Couldn't parse the saved accounts (accounts.json)")
    }
  }

  function writeVault(vault: Vault): void {
    mkdirSync(dirname(paths.vaultPath), { recursive: true })
    writeFileAtomic(paths.vaultPath, serializeVault(vault))
  }

  function readCredentials(): JsonFile | null {
    return readJsonFile(paths.credentialsPath, '.credentials.json')
  }

  /** ~/.claude.json 의 oauthAccount. Claude Code 가 수시로 다시 쓰는 파일이라 못 읽으면 null */
  function readConfigOauthAccount(): Json | null {
    try {
      const config = readJsonFile(paths.claudeJsonPath, '.claude.json')
      const oauthAccount = config?.value.oauthAccount
      return isObject(oauthAccount) && typeof oauthAccount.accountUuid === 'string' ? oauthAccount : null
    } catch {
      return null
    }
  }

  /**
   * 기본 폴더 계정 키의 계정. 확실할 때만 known: 보관한 refresh token 과 정확히 같거나, 프로필 API 가 그 토큰의 계정을 알려 줄 때.
   * ~/.claude.json 의 oauthAccount 로는 정하지 않는다 — 두 파일이 따로 써져 그 사이에 엇갈릴 수 있고, 잘못 붙이면 다른 계정의 보관본을 덮는다
   */
  async function identify(vault: Vault, accountKeys: Json, isForced: boolean): Promise<Identity> {
    const refreshToken = refreshTokenOf(accountKeys)
    if (!refreshToken) return { kind: 'none' }
    const stored = findByRefreshToken(vault, refreshToken)
    if (stored) return { kind: 'known', id: stored.id, profile: null }
    const tokenHash = sha256(refreshToken)
    if (!isForced && profileFailure?.tokenHash === tokenHash && Date.now() < profileFailure.retryAt) return { kind: 'unknown' }
    const accessToken = accessTokenOf(accountKeys)
    const profile = accessToken ? await fetchProfile(accessToken) : null
    if (!profile) {
      profileFailure = { tokenHash, retryAt: Date.now() + PROFILE_RETRY_MS }
      return { kind: 'unknown' }
    }
    profileFailure = null
    return { kind: 'known', id: profile.accountUuid, profile }
  }

  /** 그 계정의 보관할 oauthAccount: ~/.claude.json 것이 그 계정이면 그것(가장 자세하다), 아니면 보관본, 그것도 없으면 프로필로 만든 것 */
  function oauthAccountFor(vault: Vault, id: string, profile: Profile | null, config: Json | null): Json | null {
    if (config?.accountUuid === id) return config
    const existing = vault.accounts.find((account) => account.id === id)
    if (existing) return existing.oauthAccount
    return profile ? oauthAccountFromProfile(profile) : null
  }

  /**
   * 기본 폴더 로그인을 보관함에 맞춘다: 그 계정의 보관본을 지금 계정 키로 바꾸고(처음 보는 계정이면 새로 보관),
   * ~/.claude.json 의 oauthAccount 로 그 계정 보관본의 oauthAccount 를 갱신한다 (oauthAccount 는 자기 accountUuid 를 담고 있어 잘못 붙지 않는다)
   */
  async function syncOnce(isForced = false): Promise<Snapshot> {
    for (let attempt = 1; ; attempt++) {
      const keys = pickAccountKeys(readCredentials()?.value ?? {})
      let vault = readVault()
      const identity = await identify(vault, keys, isForced)
      // 프로필을 묻는 사이 다른 claude 가 토큰을 갱신했으면 그 판정은 버리고 다시 본다
      if (identity.kind === 'known' && identity.profile && refreshTokenOf(pickAccountKeys(readCredentials()?.value ?? {})) !== refreshTokenOf(keys)) {
        if (attempt < 3) continue
        return { vault, activeId: null, isActiveUnknown: true }
      }
      const config = readConfigOauthAccount()
      let isChanged = false
      if (identity.kind === 'known') {
        const existing = vault.accounts.find((account) => account.id === identity.id)
        const oauthAccount = oauthAccountFor(vault, identity.id, identity.profile, config)
        if (oauthAccount && (!existing || !isSameJson(existing.credentials, keys))) {
          vault = upsertStored(vault, { id: identity.id, oauthAccount, credentials: keys }, now())
          isChanged = true
        }
      }
      const owner = config ? vault.accounts.find((account) => account.id === config.accountUuid) : undefined
      if (config && owner && !isSameJson(owner.oauthAccount, config)) {
        vault = upsertStored(vault, { id: owner.id, oauthAccount: config, credentials: owner.credentials }, now())
        isChanged = true
      }
      if (isChanged) writeVault(vault)
      return {
        vault,
        activeId: identity.kind === 'known' ? identity.id : null,
        isActiveUnknown: identity.kind === 'unknown',
      }
    }
  }

  function lockError(error: unknown, what: string): AccountError {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      return new AccountError(409, `${what} Try again in a moment`)
    }
    return new AccountError(500, `Couldn't lock the Claude login files: ${(error as Error).message}`)
  }

  /**
   * Claude Code 의 토큰 갱신 잠금 두 개(새 `.oauth_refresh.lock` → 옛 `~/.claude.lock`, Claude Code 와 같은 순서)를 잡고 일한다.
   * 잡는 동안 도는 claude 는 토큰을 갱신하지 않고 기다린다. 소유자 기록(.oauth_refresh.lock.owner)은 쓰지 않는다 —
   * 기록이 없으면 Claude Code 는 가로채지 않고 stale(60초) 규칙만 쓴다
   */
  async function withRefreshLock<T>(task: (isCompromised: () => boolean) => Promise<T>): Promise<T> {
    let isCompromised = false
    const onCompromised = (error: Error) => {
      isCompromised = true
      console.error(`계정 잠금을 잃음: ${error.message}`)
    }
    const busy = 'Another Claude Code process is refreshing its login.'
    let releaseRefresh: () => Promise<void>
    try {
      releaseRefresh = await lock(paths.claudeDir, {
        ...REFRESH_LOCK,
        lockfilePath: join(paths.claudeDir, '.oauth_refresh.lock'),
        retries: lockRetries,
        onCompromised,
      })
    } catch (error) {
      throw lockError(error, busy)
    }
    let releaseLegacy: (() => Promise<void>) | null = null
    try {
      let claudeDir = paths.claudeDir
      try {
        claudeDir = realpathSync.native(paths.claudeDir)
      } catch {
        // Claude Code 도 realpath 에 실패하면 받은 경로 그대로 쓴다
      }
      const legacyPath = `${claudeDir}.lock`
      try {
        releaseLegacy = await lock(legacyPath, { ...REFRESH_LOCK, lockfilePath: legacyPath, retries: lockRetries, onCompromised })
      } catch (error) {
        // Claude Code 도 옛 잠금은 ELOCKED 일 때만 포기하고 그 밖의 실패는 로그만 남기고 넘어간다
        if ((error as NodeJS.ErrnoException).code === 'ELOCKED') throw lockError(error, busy)
        console.warn(`옛 토큰 갱신 잠금(~/.claude.lock)을 못 잡고 넘어감: ${(error as Error).message}`)
      }
      return await task(() => isCompromised)
    } finally {
      await releaseLegacy?.().catch((error: Error) => console.warn(`옛 잠금 풀기 실패: ${error.message}`))
      await releaseRefresh().catch((error: Error) => console.warn(`토큰 갱신 잠금 풀기 실패: ${error.message}`))
    }
  }

  /** Claude Code 가 ~/.claude.json 을 쓸 때 잡는 잠금 안에서 읽고 바로 쓴다 */
  async function withConfigLock<T>(task: () => T): Promise<T> {
    let release: () => Promise<void>
    try {
      release = await lock(paths.claudeJsonPath, {
        ...CONFIG_LOCK,
        lockfilePath: `${paths.claudeJsonPath}.lock`,
        retries: { retries: 20, minTimeout: 50, maxTimeout: 300 },
        onCompromised: (error) => console.error(`~/.claude.json 잠금을 잃음: ${error.message}`),
      })
    } catch (error) {
      throw lockError(error, 'Another Claude Code process is writing ~/.claude.json.')
    }
    try {
      return task()
    } finally {
      await release().catch((error: Error) => console.warn(`~/.claude.json 잠금 풀기 실패: ${error.message}`))
    }
  }

  /** 기본 폴더 .credentials.json 의 계정 키만 바꾼다. 그 사이 로그인이 바뀌었으면(refresh token 이 expected 가 아님) 쓰지 않고 409 */
  function replaceDefaultAccountKeys(accountKeys: Json, expectedRefreshToken: string | null): JsonFile | null {
    const current = readCredentials()
    if (refreshTokenOf(pickAccountKeys(current?.value ?? {})) !== expectedRefreshToken) {
      throw new AccountError(409, 'The Claude login changed in the meantime. Nothing was changed. Try again')
    }
    // Claude Code 와 같은 꼴 (들여쓰기·끝 줄바꿈 없음)
    writeFileAtomic(paths.credentialsPath, JSON.stringify(withAccountKeys(current?.value ?? {}, accountKeys)))
    return current
  }

  function restoreCredentials(previous: JsonFile | null): void {
    try {
      if (previous) writeFileAtomic(paths.credentialsPath, previous.text)
      else rmSync(paths.credentialsPath, { force: true })
    } catch (error) {
      console.error(`.credentials.json 되돌리기 실패: ${(error as Error).message}`)
    }
  }

  function viewOf(snapshot: Snapshot): { accounts: Account[]; activeId: string | null } {
    return { accounts: snapshot.vault.accounts.map((account) => toAccount(account, snapshot.activeId)), activeId: snapshot.activeId }
  }

  /** 지운 계정 등 기본 폴더 계정의 확실한 판정이 필요한 곳 */
  function assertActiveKnown(snapshot: Snapshot): void {
    if (snapshot.isActiveUnknown) {
      throw new AccountError(409, "Couldn't confirm which account Claude Code is signed in to right now. Try again in a moment")
    }
  }

  /** 보관한 계정 목록. 기본 폴더의 계정이 보관함에 없으면 저절로 보관한다 */
  function list(): Promise<{ accounts: Account[]; activeId: string | null }> {
    return exclusive(async () => viewOf(await syncOnce()))
  }

  /**
   * 기본 폴더 계정을 보관한 다른 계정으로 바꾼다. Claude Code 의 토큰 갱신 잠금 안에서:
   * 지금 파일의 계정 키를 그 계정 보관본에 되쓰고(최신으로) → .credentials.json 의 계정 키만 바꾸고 →
   * ~/.claude.json 잠금 안에서 oauthAccount 를 바꾸고 조직 캐시 키를 지운다. 도는 claude 는 .credentials.json mtime 이 바뀌면 다음 요청부터 새 토큰을 쓴다
   */
  function switchTo(id: string): Promise<Account> {
    return exclusive(async () => {
      const before = await syncOnce()
      const target = before.vault.accounts.find((account) => account.id === id)
      if (!target) throw new AccountError(404, 'No saved account with that id')
      if (before.activeId === id) throw new AccountError(409, 'Already the current account')
      if (!refreshTokenOf(target.credentials)) throw new AccountError(409, "This account has no saved login. Sign in to it again")
      const expiresAt = refreshExpiresAtOf(target.credentials)
      if (expiresAt !== null && expiresAt <= now().getTime()) {
        throw new AccountError(409, "This account's saved login has expired. Sign in to it again")
      }
      await withRefreshLock(async (isCompromised) => {
        // 잠금을 잡기 전에 다른 claude 가 갱신했을 수 있어 잠금 안에서 다시 본다
        const keys = pickAccountKeys(readCredentials()?.value ?? {})
        let vault = readVault()
        const identity = await identify(vault, keys, true)
        if (identity.kind === 'unknown') {
          throw new AccountError(
            500,
            "Couldn't confirm which account Claude Code is signed in to right now, so its latest login couldn't be saved. Nothing was changed. Try again",
          )
        }
        if (identity.kind === 'known') {
          if (identity.id === id) throw new AccountError(409, 'Already the current account')
          const oauthAccount = oauthAccountFor(vault, identity.id, identity.profile, readConfigOauthAccount())
          if (!oauthAccount) throw new AccountError(500, "Couldn't save the current account's login. Nothing was changed")
          vault = upsertStored(vault, { id: identity.id, oauthAccount, credentials: keys }, now())
          // 되쓰기를 먼저 저장한다 (아래가 실패해도 지금 계정의 최신 로그인을 잃지 않게)
          writeVault(vault)
        }
        const latest = vault.accounts.find((account) => account.id === id) ?? target
        if (isCompromised()) throw new AccountError(409, 'Lost the Claude login lock. Nothing was changed. Try again')
        await withConfigLock(() => {
          const config = readJsonFile(paths.claudeJsonPath, '.claude.json')
          const previous = replaceDefaultAccountKeys(latest.credentials, refreshTokenOf(keys))
          try {
            writeFileAtomic(paths.claudeJsonPath, JSON.stringify(withOauthAccount(config?.value ?? {}, latest.oauthAccount), null, 2))
          } catch (error) {
            restoreCredentials(previous)
            throw new AccountError(500, `Couldn't update ~/.claude.json, so the switch was undone: ${(error as Error).message}`)
          }
        })
      })
      onChange()
      const after = readVault().accounts.find((account) => account.id === id) ?? target
      return toAccount(after, id)
    })
  }

  /**
   * 로그인이 끝난 임시 설정 폴더의 계정을 보관한다 (임시 폴더는 부른 쪽이 지운다. 거기서 logout 하지 않는다 — 그 로그인이 폐기된다).
   * 새 계정은 보관만 하고 전환하지 않는다. 지금 기본 폴더 계정과 같은 계정이면 기본 폴더 로그인도 새 것으로 바꾼다
   * (그 계정은 기본 폴더 파일이 기준이라 보관본만 바꾸면 다음 동기화가 옛 토큰으로 되돌린다)
   */
  function saveLogin(configDir: string): Promise<Account> {
    return exclusive(async () => {
      const credentials = readJsonFile(join(configDir, '.credentials.json'), 'the new .credentials.json')
      const config = readJsonFile(join(configDir, '.claude.json'), 'the new .claude.json')
      const keys = pickAccountKeys(credentials?.value ?? {})
      const oauthAccount = config?.value.oauthAccount
      if (!refreshTokenOf(keys) || !isObject(oauthAccount) || typeof oauthAccount.accountUuid !== 'string' || !oauthAccount.accountUuid) {
        throw new AccountError(500, 'Signed in, but claude saved no login to keep')
      }
      const id = oauthAccount.accountUuid
      const before = await syncOnce()
      if (before.activeId === id) {
        const activeRefreshToken = refreshTokenOf(before.vault.accounts.find((account) => account.id === id)?.credentials ?? {})
        try {
          await withRefreshLock(async () => {
            replaceDefaultAccountKeys(keys, activeRefreshToken)
          })
          onChange()
        } catch (error) {
          // 새 로그인은 아래에서 보관한다. 기본 폴더가 옛 로그인 그대로면 다음 동기화가 보관본을 그것으로 되돌린다
          console.warn(`같은 계정 다시 로그인: 기본 폴더 로그인은 바꾸지 못함 (${(error as Error).message})`)
        }
      }
      const vault = upsertStored(readVault(), { id, oauthAccount, credentials: keys }, now())
      writeVault(vault)
      return toAccount(vault.accounts.find((account) => account.id === id)!, before.activeId)
    })
  }

  /**
   * 지금 계정이 아닌 보관 계정을 지운다: 그 계정 키만 든 임시 설정 폴더에서 `claude auth logout` 으로 폐기 요청한 뒤 보관함에서 뺀다.
   * 지금 계정이거나 지금 계정을 확실히 모르면 409 (모르는 채 지우면 쓰는 중인 로그인을 폐기할 수 있다)
   */
  function remove(id: string): Promise<void> {
    return exclusive(async () => {
      const snapshot = await syncOnce(true)
      const target = snapshot.vault.accounts.find((account) => account.id === id)
      if (!target) throw new AccountError(404, 'No saved account with that id')
      if (snapshot.activeId === id) throw new AccountError(409, 'This is the current account. Log out instead')
      assertActiveKnown(snapshot)
      const dir = makeTempDir()
      let result: ClaudeRunResult
      try {
        writeFileSync(join(dir, '.credentials.json'), JSON.stringify(target.credentials))
        writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: target.oauthAccount }, null, 2))
        result = await options.runClaude(['auth', 'logout'], dir)
      } finally {
        removeTempDir(dir)
      }
      if (result.exitCode !== 0) throw new AccountError(500, `Couldn't revoke the saved login (claude auth logout ${exitText(result)})`)
      writeVault(removeStored(readVault(), id))
    })
  }

  /** 기본 폴더에서 `claude auth logout`. 이 PC 의 모든 claude 가 로그아웃되고 그 로그인은 폐기되므로 보관함에서도 뺀다 */
  function logout(): Promise<void> {
    return exclusive(async () => {
      const snapshot = await syncOnce(true)
      const result = await options.runClaude(['auth', 'logout'], null)
      if (result.exitCode !== 0) throw new AccountError(500, `Log out failed (claude auth logout ${exitText(result)})`)
      profileFailure = null
      onChange()
      if (snapshot.activeId) writeVault(removeStored(readVault(), snapshot.activeId))
    })
  }

  /**
   * 기본 폴더 .credentials.json 이 바뀔 때마다(폴더 감시 + POLL_MS 폴링) 보관함을 맞춘다. 서버 시작 때 한 번 돈다.
   * 프로필 조회에 실패했으면 PROFILE_RETRY_MS 뒤에 다시 본다. 반환 함수로 멈춘다
   */
  function startWatching(): () => void {
    let lastStamp: string | null = null
    let isRunning = false
    let isFailing = false
    const stampOf = () => {
      try {
        const stat = statSync(paths.credentialsPath)
        return `${stat.mtimeMs}:${stat.size}`
      } catch {
        return 'missing'
      }
    }
    const check = () => {
      const stamp = stampOf()
      const isRetryDue = profileFailure !== null && Date.now() >= profileFailure.retryAt
      if (isRunning || (stamp === lastStamp && !isRetryDue)) return
      isRunning = true
      lastStamp = stamp
      exclusive(() => syncOnce())
        .then(() => {
          if (isFailing) console.log('계정 보관함 동기화 복구')
          isFailing = false
        })
        .catch((error: Error) => {
          // 다음 회차에 다시 돌게 한다. 로그는 실패로 바뀔 때만
          lastStamp = null
          if (!isFailing) console.error(`계정 보관함 동기화 실패: ${error.message}`)
          isFailing = true
        })
        .finally(() => {
          isRunning = false
        })
    }
    let debounce: NodeJS.Timeout | null = null
    let watcher: FSWatcher | null = null
    try {
      // Claude Code 는 임시 파일을 바꿔 끼워 쓰므로 파일이 아니라 폴더를 본다
      watcher = watch(paths.claudeDir, (_event, name) => {
        if (name !== '.credentials.json') return
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(check, WATCH_DEBOUNCE_MS)
      })
      watcher.on('error', () => watcher?.close())
    } catch {
      // 폴더가 없으면 폴링만
    }
    const timer = setInterval(check, POLL_MS)
    check()
    return () => {
      clearInterval(timer)
      if (debounce) clearTimeout(debounce)
      watcher?.close()
    }
  }

  return { list, switchTo, saveLogin, remove, logout, startWatching }
}

function exitText(result: ClaudeRunResult): string {
  const lastLine = result.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
  const code = result.exitCode === null ? "didn't finish" : `exited with code ${result.exitCode}`
  return lastLine ? `${code}: ${lastLine.slice(0, 200)}` : code
}

export type AccountStore = ReturnType<typeof makeAccountStore>
