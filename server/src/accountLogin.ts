import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getArg } from '@pray/host/runtime'
import { checkAuthCode, loginFailureOf, parseLoginUrl, stateOfUrl, stripAnsi, type Account } from './accounts.js'
import {
  AccountError,
  makeAccountTempDir,
  removeAccountTempDir,
  removeStaleAccountTempDirs,
  type ClaudeRunResult,
} from './accountStore.js'

/** 호스트와 같은 규칙 (작업 스케줄러 환경엔 사용자 PATH 가 없을 수 있다) */
const CLAUDE_COMMAND = getArg('claude') ?? process.env.PRAY_CLAUDE ?? 'claude.exe'
/**
 * 로그인 때 claude 가 브라우저를 여는 프로그램. claude 는 BROWSER 를 셸 없이 URL 인자 하나로 실행한다 (없으면 `rundll32 url,OpenURL`).
 * where.exe 는 받은 URL 을 검색 패턴으로 읽다가 "path:pattern 꼴이 잘못됨" 으로 바로(종료 코드 2) 끝나는 조회 도구라 아무것도 열지도 실행하지도 않는다
 */
export const NO_OP_BROWSER = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe')
/** 이 시간이 지나면 로그인을 저절로 끝낸다 */
const LOGIN_TTL_MS = 10 * 60_000
/** `claude auth login` 이 수동 로그인 URL 을 찍을 때까지 (실측 약 0.25초) */
const URL_WAIT_MS = 20_000
/** 코드를 넣은 뒤 claude 가 토큰 교환·저장을 끝낼 때까지 */
const CODE_WAIT_MS = 30_000
const RUN_TIMEOUT_MS = 30_000
const OUTPUT_LIMIT = 64_000

/** claude 자식 env: CLAUDECODE·CLAUDE_* 를 지우고(중첩 실행으로 판단하지 않게, 설정 폴더가 새지 않게) extra 를 더한다 */
export function claudeAuthEnv(extra: Record<string, string>, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(base)) {
    if (value === undefined || key === 'CLAUDECODE' || key.startsWith('CLAUDE_')) continue
    env[key] = value
  }
  return { ...env, ...extra }
}

/**
 * 임시 설정 폴더에서 띄우는 claude 의 env. CLAUDE_CONFIG_DIR 만으로는 부족하다: `claude auth logout` 은 그와 별개로
 * ANTHROPIC_CONFIG_DIR(없으면 %APPDATA%\Anthropic)의 프로필 자격 증명도 폐기·삭제한다 (2.1.310). 그래서 그것도 임시 폴더 안으로 돌린다
 */
function tempConfigEnv(configDir: string): Record<string, string> {
  return { CLAUDE_CONFIG_DIR: configDir, ANTHROPIC_CONFIG_DIR: join(configDir, 'anthropic'), BROWSER: NO_OP_BROWSER }
}

/** `claude <args>` 를 끝날 때까지(최대 30초) 실행한다. configDir 이 null 이면 기본 폴더 (env 에 설정 폴더를 넣지 않는다) */
export async function runClaudeAuth(args: string[], configDir: string | null, command = CLAUDE_COMMAND): Promise<ClaudeRunResult> {
  // 작업 폴더의 프로젝트 설정을 읽지 않게 빈 폴더에서 띄운다
  const cwd = configDir ?? makeAccountTempDir()
  try {
    const env = claudeAuthEnv(configDir ? tempConfigEnv(configDir) : {})
    return await new Promise<ClaudeRunResult>((resolve) => {
      let output = ''
      const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      const append = (chunk: Buffer) => {
        if (output.length < OUTPUT_LIMIT) output += chunk.toString('utf8')
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      const timer = setTimeout(() => child.kill(), RUN_TIMEOUT_MS)
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ exitCode: null, output: `${output}\n${error.message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ exitCode: code, output: stripAnsi(output) })
      })
    })
  } finally {
    if (!configDir) removeAccountTempDir(cwd)
  }
}

interface Login {
  id: string
  url: string
  state: string
  /** 임시 설정 폴더 (CLAUDE_CONFIG_DIR). 로그인이 끝나면 여기 .credentials.json·.claude.json 이 생긴다 */
  dir: string
  child: ChildProcess
  output: string
  exited: Promise<void>
  hasExited: boolean
  exitCode: number | null
  /** 코드를 넣고 결과를 기다리는 중 */
  isChecking: boolean
  isEnded: boolean
  timer: NodeJS.Timeout | null
  onOutput: Set<() => void>
}

export interface LoginManagerOptions {
  /** 로그인이 끝난 임시 설정 폴더의 계정을 보관한다 */
  saveLogin: (configDir: string) => Promise<Account>
  command?: string
  /** command 앞에 붙일 인자 (시험에서 node 로 가짜 claude 스크립트를 띄울 때) */
  commandArgs?: string[]
  ttlMs?: number
  urlWaitMs?: number
  codeWaitMs?: number
}

/**
 * 웹에서 하는 Claude 계정 로그인 (한 번에 하나). 임시 설정 폴더 + 무동작 BROWSER 로 `claude auth login --claudeai` 를 띄우고
 * 찍힌 수동 URL 을 준다. 사람이 브라우저에서 로그인해 받은 `code#state` 를 넣으면 그 claude 의 입력칸(stdin 줄 입력)에 넣는다.
 * PKCE 값이 그 프로세스 메모리에 있어 코드를 넣을 때까지 프로세스를 살려 둔다. pty 가 없어도 된다 (`auth login` 은 stdin 을 줄 단위로 읽는다)
 */
export function makeLoginManager(options: LoginManagerOptions) {
  const command = options.command ?? CLAUDE_COMMAND
  const commandArgs = options.commandArgs ?? []
  const ttlMs = options.ttlMs ?? LOGIN_TTL_MS
  const urlWaitMs = options.urlWaitMs ?? URL_WAIT_MS
  const codeWaitMs = options.codeWaitMs ?? CODE_WAIT_MS
  let current: Login | null = null
  let isStarting = false

  removeStaleAccountTempDirs()
  // 서버가 끝나면 기다리던 claude 도 끝낸다 (Windows 는 부모가 끝나도 자식이 남는다)
  process.on('exit', () => {
    if (current && !current.hasExited) current.child.kill()
  })

  /** 그 로그인의 claude 출력이 바뀔 때마다 check 를 보고 값이 나오면 준다. claude 가 끝나거나 시간이 지나면 그때의 check 값(대개 null) */
  function waitFor<T>(login: Login, check: () => T | null, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      let isDone = false
      const finish = (value: T | null) => {
        if (isDone) return
        isDone = true
        clearTimeout(timer)
        login.onOutput.delete(onOutput)
        resolve(value)
      }
      const onOutput = () => {
        const value = check()
        if (value !== null) finish(value)
      }
      const timer = setTimeout(() => finish(null), timeoutMs)
      login.onOutput.add(onOutput)
      void login.exited.then(() => finish(check()))
      onOutput()
    })
  }

  /** 프로세스를 끄고 임시 폴더를 지운다. 여러 번 불러도 된다 */
  async function end(login: Login): Promise<void> {
    if (login.isEnded) return
    login.isEnded = true
    if (login.timer) clearTimeout(login.timer)
    if (current === login) current = null
    if (!login.hasExited) login.child.kill()
    await Promise.race([login.exited, new Promise((resolve) => setTimeout(resolve, 5_000))])
    removeAccountTempDir(login.dir)
  }

  /** 코드를 기다리지 않는 사이에 claude 가 끝났을 때 (시간 초과로 죽였거나, 로컬 콜백으로 로그인이 끝났거나) */
  async function onExit(login: Login): Promise<void> {
    if (login.isChecking || login.isEnded) return
    if (login.exitCode === 0) {
      try {
        await options.saveLogin(login.dir)
      } catch (error) {
        console.error(`로그인은 끝났는데 계정을 보관하지 못함: ${(error as Error).message}`)
      }
    }
    await end(login)
  }

  async function start(): Promise<{ loginId: string; url: string }> {
    if (isStarting || current) throw new AccountError(409, 'A sign-in is already in progress')
    isStarting = true
    try {
      const dir = makeAccountTempDir()
      const child = spawn(command, [...commandArgs, 'auth', 'login', '--claudeai'], {
        cwd: dir,
        env: claudeAuthEnv(tempConfigEnv(dir)),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let spawnError: string | null = null
      const login: Login = {
        id: randomUUID(),
        url: '',
        state: '',
        dir,
        child,
        output: '',
        exited: Promise.resolve(),
        hasExited: false,
        exitCode: null,
        isChecking: false,
        isEnded: false,
        timer: null,
        onOutput: new Set(),
      }
      login.exited = new Promise((resolve) => {
        child.on('error', (error) => {
          spawnError = error.message
          login.hasExited = true
          resolve()
        })
        child.on('close', (code) => {
          login.hasExited = true
          login.exitCode = code
          resolve()
        })
      })
      const append = (chunk: Buffer) => {
        if (login.output.length < OUTPUT_LIMIT) login.output += chunk.toString('utf8')
        for (const listener of [...login.onOutput]) listener()
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      // claude 가 먼저 끝났을 때 stdin 쓰기 오류(EPIPE)로 서버가 죽지 않게
      child.stdin?.on('error', () => {})
      const url = await waitFor(login, () => parseLoginUrl(login.output), urlWaitMs)
      const state = url ? stateOfUrl(url) : null
      if (!url || !state) {
        const reason = spawnError ?? loginFailureOf(login.output) ?? (login.hasExited ? `claude exited with code ${login.exitCode}` : 'no sign-in address')
        await end(login)
        throw new AccountError(500, `Couldn't start the sign-in (${reason})`)
      }
      login.url = url
      login.state = state
      login.timer = setTimeout(() => {
        console.log('계정 로그인 대기 시간이 지나 끝냄')
        void end(login)
      }, ttlMs)
      current = login
      void login.exited.then(() => onExit(login))
      console.log('계정 로그인 시작')
      return { loginId: login.id, url }
    } finally {
      isStarting = false
    }
  }

  /**
   * 코드를 넣고 결과를 기다린다. 400 에는 화면이 다시 넣게 할지 정하도록 `isLoginEnded` 를 싣는다:
   * 꼴이 틀리거나 다른 로그인의 코드(state 가 다름)면 claude 에 넣지 않고 false (로그인은 살아 있다).
   * claude 가 거절하면(토큰 교환 실패) claude 가 종료 코드 1 로 끝나므로 로그인도 끝나 true (2.1.310 실측. 다시 시작해야 한다)
   */
  async function submitCode(loginId: string, code: unknown): Promise<Account> {
    const login = current?.id === loginId ? current : null
    if (!login) throw new AccountError(404, 'Sign-in not found or expired. Start it again')
    if (login.isChecking) throw new AccountError(409, 'Already checking a code for this sign-in')
    const check = checkAuthCode(code, login.state)
    if (!check.ok) {
      throw new AccountError(
        400,
        check.reason === 'state'
          ? "That code is from a different sign-in. Paste the code shown after opening this sign-in's address"
          : 'Invalid code. Copy the whole code shown after signing in',
        { isLoginEnded: false },
      )
    }
    login.isChecking = true
    const from = login.output.length
    login.child.stdin?.write(`${check.line}\n`)
    const isRejectedFormat = await waitFor(
      login,
      () => (/Invalid code\./.test(stripAnsi(login.output.slice(from))) ? true : null),
      codeWaitMs,
    )
    if (login.hasExited) {
      if (login.exitCode === 0) {
        try {
          return await options.saveLogin(login.dir)
        } finally {
          await end(login)
        }
      }
      const reason = loginFailureOf(login.output.slice(from))
      await end(login)
      throw new AccountError(400, `Claude rejected the code${reason ? ` (${reason})` : ''}. This sign-in has ended, so start again`, {
        isLoginEnded: true,
      })
    }
    if (isRejectedFormat) {
      login.isChecking = false
      throw new AccountError(400, 'Invalid code. Copy the whole code shown after signing in', { isLoginEnded: false })
    }
    await end(login)
    throw new AccountError(500, 'Timed out waiting for claude to finish signing in. Start the sign-in again')
  }

  /** 프로세스를 끄고 임시 폴더를 지운다. 없는 로그인이어도 그대로 끝난다 */
  async function cancel(loginId: string): Promise<void> {
    if (current?.id === loginId) await end(current)
  }

  return { start, submitCode, cancel }
}

export type LoginManager = ReturnType<typeof makeLoginManager>
