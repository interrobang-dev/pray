import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { stateOfUrl, type Account } from './accounts.js'
import { AccountError } from './accountStore.js'
import { makeLoginManager, NO_OP_BROWSER, runClaudeAuth } from './accountLogin.js'

/** `claude auth login --claudeai`·`claude auth logout` 의 2.1.310 출력·입력 흉내 */
const FAKE_CLAUDE = `
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
const dir = process.env.CLAUDE_CONFIG_DIR ?? null
const env = {
  configDir: dir,
  browser: process.env.BROWSER ?? null,
  anthropicConfigDir: process.env.ANTHROPIC_CONFIG_DIR ?? null,
  claudeKeys: Object.keys(process.env).filter((key) => key === 'CLAUDECODE' || key.startsWith('CLAUDE_')).sort(),
  cwd: process.cwd(),
}
const [, , command, sub] = process.argv
if (sub === 'logout') {
  console.log(JSON.stringify(env))
  process.exit(process.env.FAKE_LOGOUT_EXIT ? Number(process.env.FAKE_LOGOUT_EXIT) : 0)
}
if (process.env.FAKE_LOGIN_CRASH) {
  process.stderr.write('Login failed: boom\\n')
  process.exit(1)
}
writeFileSync(join(dir, 'env.json'), JSON.stringify(env))
const state = 'st' + process.pid
process.stdout.write('Opening browser to sign in\\u2026\\n')
process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=" + state + '\\n')
process.stdout.write('Paste code here if prompted > ')
createInterface({ input: process.stdin }).on('line', (line) => {
  const [code, pasted] = line.trim().split('#')
  if (!code || !pasted || code === 'claude-invalid') {
    process.stderr.write('Invalid code. Please make sure the full code was copied.\\n')
    return
  }
  if (code === 'good') {
    writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { refreshToken: 'r-new', accessToken: 'a-new' } }))
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'new', emailAddress: 'new@example.com' } }))
    process.stdout.write('Login successful.\\n')
    process.exit(0)
  }
  process.stderr.write('Login failed: Request failed with status code 400\\n')
  process.exit(1)
})
`

let scriptDir: string
let script: string
const account: Account = {
  id: 'new',
  email: 'new@example.com',
  displayName: null,
  organizationName: null,
  plan: null,
  isActive: false,
  refreshExpiresAt: null,
  savedAt: '2026-10-25T00:00:00.000Z',
}

beforeAll(() => {
  scriptDir = mkdtempSync(join(tmpdir(), 'jk-fake-claude-'))
  script = join(scriptDir, 'claude.mjs')
  writeFileSync(script, FAKE_CLAUDE)
  // 이 시험을 Claude Code 안에서 돌려도, 밖에서 돌려도 지워야 할 변수가 있게
  process.env.CLAUDE_CODE_FAKE_LEAK = '1'
})

afterAll(() => {
  delete process.env.CLAUDE_CODE_FAKE_LEAK
  rmSync(scriptDir, { recursive: true, force: true })
})

afterEach(() => {
  delete process.env.FAKE_LOGIN_CRASH
  delete process.env.FAKE_LOGOUT_EXIT
})

function makeManager(saveLogin = vi.fn(async (_dir: string) => account), extra: { ttlMs?: number; codeWaitMs?: number } = {}) {
  return makeLoginManager({ saveLogin, command: process.execPath, commandArgs: [script], ...extra })
}

async function expectError(promise: Promise<unknown>, status: number, message?: RegExp, fields: Record<string, unknown> = {}) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(AccountError)
  expect((error as AccountError).status).toBe(status)
  if (message) expect((error as AccountError).message).toMatch(message)
  expect((error as AccountError).fields).toEqual(fields)
}

describe('login manager', () => {
  it('hands out the manual address, rejects bad codes in place, then saves the login', async () => {
    let seenDir = ''
    let seenEnv: Record<string, unknown> = {}
    const saveLogin = vi.fn(async (dir: string) => {
      seenDir = dir
      seenEnv = JSON.parse(readFileSync(join(dir, 'env.json'), 'utf8'))
      expect(existsSync(join(dir, '.credentials.json'))).toBe(true)
      return account
    })
    const manager = makeManager(saveLogin)
    const { loginId, url } = await manager.start()
    expect(url).toMatch(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?/)
    const state = stateOfUrl(url)!
    await expectError(manager.start(), 409, /already in progress/)
    await expectError(manager.submitCode(loginId, 'no-hash'), 400, /Invalid code/, { isLoginEnded: false })
    await expectError(manager.submitCode(loginId, 'good#someone-else'), 400, /different sign-in/, { isLoginEnded: false })
    // 서버 검사는 지났는데 claude 가 꼴을 거절하면 claude 는 계속 기다린다
    await expectError(manager.submitCode(loginId, `claude-invalid#${state}`), 400, /Invalid code/, { isLoginEnded: false })
    await expectError(manager.submitCode('other-id', `good#${state}`), 404)
    expect(await manager.submitCode(loginId, `  good#${state}  `)).toEqual(account)
    expect(saveLogin).toHaveBeenCalledTimes(1)
    expect(seenEnv).toEqual({
      configDir: seenDir,
      browser: NO_OP_BROWSER,
      anthropicConfigDir: join(seenDir, 'anthropic'),
      claudeKeys: ['CLAUDE_CONFIG_DIR'],
      cwd: seenDir,
    })
    expect(existsSync(seenDir)).toBe(false)
    await expectError(manager.submitCode(loginId, `good#${state}`), 404)
    // 끝났으니 새로 시작할 수 있다
    const again = await manager.start()
    await manager.cancel(again.loginId)
  })

  it('ends the sign-in when claude rejects the code', async () => {
    const saveLogin = vi.fn(async () => account)
    const manager = makeManager(saveLogin)
    const { loginId, url } = await manager.start()
    await expectError(
      manager.submitCode(loginId, `bad#${stateOfUrl(url)}`),
      400,
      /rejected the code \(Request failed with status code 400\)\. This sign-in has ended, so start again$/,
      { isLoginEnded: true },
    )
    await expectError(manager.submitCode(loginId, `good#${stateOfUrl(url)}`), 404)
    expect(saveLogin).not.toHaveBeenCalled()
  })

  it('cancels and expires', async () => {
    const manager = makeManager(undefined, { ttlMs: 400 })
    const first = await manager.start()
    await manager.cancel(first.loginId)
    await manager.cancel(first.loginId)
    await expectError(manager.submitCode(first.loginId, 'good#x'), 404)
    const second = await manager.start()
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    await expectError(manager.submitCode(second.loginId, `good#${stateOfUrl(second.url)}`), 404)
    await manager.cancel((await manager.start()).loginId)
  })

  it('reports claude failing before it shows an address', async () => {
    process.env.FAKE_LOGIN_CRASH = '1'
    await expectError(makeManager().start(), 500, /Couldn't start the sign-in \(boom\)/)
    await expectError(makeLoginManager({ saveLogin: async () => account, command: join(scriptDir, 'missing.exe') }).start(), 500, /ENOENT/)
  })
})

describe('runClaudeAuth', () => {
  it('runs in a temp config folder with the profile dir kept inside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jk-run-claude-'))
    try {
      const result = await runClaudeAuth([script, 'auth', 'logout'], dir, process.execPath)
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.output)).toEqual({
        configDir: dir,
        browser: NO_OP_BROWSER,
        anthropicConfigDir: join(dir, 'anthropic'),
        claudeKeys: ['CLAUDE_CONFIG_DIR'],
        cwd: dir,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runs in the default folder without any config dir and cleans its working folder', async () => {
    process.env.FAKE_LOGOUT_EXIT = '3'
    const result = await runClaudeAuth([script, 'auth', 'logout'], null, process.execPath)
    expect(result.exitCode).toBe(3)
    const env = JSON.parse(result.output)
    expect(env.configDir).toBeNull()
    expect(env.claudeKeys).toEqual([])
    expect(env.anthropicConfigDir).toBe(process.env.ANTHROPIC_CONFIG_DIR ?? null)
    expect(existsSync(env.cwd)).toBe(false)
  })

  it('reports a missing claude', async () => {
    const result = await runClaudeAuth(['auth', 'logout'], null, join(tmpdir(), 'no-such-claude.exe'))
    expect(result.exitCode).toBeNull()
    expect(result.output).toMatch(/ENOENT/)
  })
})
