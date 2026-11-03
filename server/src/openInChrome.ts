import { execFile, spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { win32 } from 'node:path'
import { resolveChatFile } from './chatImage.js'

/**
 * 대화 속 로컬 .html 링크를 이 PC 의 Chrome 으로 연다 (`POST /api/sessions/:id/open-in-chrome` `{ path }`).
 * 경로 꼴·허용 범위는 대화 속 그림과 같다 (chatImage.ts: 세션 작업 폴더 또는 Claude 임시 폴더 아래, realpath 기준). `.html`·`.htm` 파일만
 */

const APP_PATHS_KEY = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'

export type Env = Record<string, string | undefined>

/** 여는 파일 확장자 (대소문자 무시) */
export function isHtmlFile(path: string): boolean {
  return /\.html?$/i.test(path)
}

/** 요청 경로 → 열 .html 파일의 실제 경로(realpath). 꼴·범위 밖·없음·폴더·html 아님이면 null */
export function resolveChatHtml(path: string, root: string | null, tempDir?: string): Promise<string | null> {
  return resolveChatFile(path, root, isHtmlFile, tempDir)
}

/**
 * `reg query <키> /ve` 출력의 기본값 (순수). 값 이름 칸은 Windows 언어에 따라 `(Default)`·`(기본값)` 이라 보지 않고 형식 칸 뒤 글을 쓴다.
 * 따옴표는 벗기고 REG_EXPAND_SZ 는 `%이름%` 을 env 로 푼다. 기본값이 비었다는 글(`(value not set)`)도 값처럼 나오므로 쓰는 쪽이 파일이 있는지 본다
 */
export function parseRegistryDefault(output: string, env: Env): string | null {
  const match = /\sREG_(EXPAND_)?SZ[ \t]+(\S.*?)[ \t]*\r?$/m.exec(output)
  if (!match) return null
  let value = match[2].replace(/^"(.*)"$/, '$1')
  if (match[1]) value = value.replace(/%([^%]+)%/g, (all, name: string) => env[name] ?? all)
  return value === '' ? null : value
}

/** 레지스트리에 없을 때 볼 기본 설치 위치 (순수): 모든 사용자(64·32비트) → 이 사용자 */
export function chromeCandidates(env: Env): string[] {
  return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]
    .filter((base): base is string => typeof base === 'string' && base !== '')
    .map((base) => win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
}

export interface ChromeLookup {
  /** HKLM·HKCU 의 App Paths 기본값 (없거나 못 읽으면 null) */
  readRegistry: (hive: 'HKLM' | 'HKCU') => Promise<string | null>
  exists: (path: string) => Promise<boolean>
  env: Env
}

/** Chrome 실행 파일 찾기: HKLM → HKCU App Paths → 기본 설치 위치. 절대 경로이고 파일이 있는 것만. 없으면 null */
export async function findChrome({ readRegistry, exists, env }: ChromeLookup): Promise<string | null> {
  for (const hive of ['HKLM', 'HKCU'] as const) {
    const value = await readRegistry(hive)
    if (value && win32.isAbsolute(value) && (await exists(value))) return value
  }
  for (const candidate of chromeCandidates(env)) {
    if (await exists(candidate)) return candidate
  }
  return null
}

function readAppPath(hive: 'HKLM' | 'HKCU'): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('reg', ['query', `${hive}\\${APP_PATHS_KEY}`, '/ve'], { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      resolve(error ? null : parseRegistryDefault(stdout, process.env))
    })
  })
}

const fileExists = (path: string) => access(path).then(
  () => true,
  () => false,
)

/** 찾은 Chrome 위치 (서버 메모리). 쓸 때마다 파일이 아직 있는지만 보고, 없어졌거나 띄우기가 실패하면 다시 찾는다 */
let cachedChrome: string | null = null

export async function locateChrome(): Promise<string | null> {
  if (cachedChrome && (await fileExists(cachedChrome))) return cachedChrome
  cachedChrome = await findChrome({ readRegistry: readAppPath, exists: fileExists, env: process.env })
  return cachedChrome
}

/**
 * chrome.exe 에 넘길 인자 (순수): 파일 경로 하나. 드라이브 문자(`C:\`) 또는 UNC(`\\`, 네트워크 드라이브의 realpath)로 시작하는 절대 경로만 받아
 * `-` 로 시작해 Chrome 플래그로 읽히는 일이 없다. 아니면 null
 */
export function chromeArguments(file: string): string[] | null {
  return /^(?:[A-Za-z]:\\|\\\\)/.test(file) && win32.isAbsolute(file) ? [file] : null
}

/**
 * Chrome 으로 파일을 연다. 셸 없이 띄우고 기다리지 않는다 (detached + unref). Chrome 이 떠 있으면 새 프로세스는 인자를 넘기고 바로 끝나고
 * 열린 창에 새 탭이 생긴다. 꺼져 있으면 이 프로세스가 Chrome 이 된다
 */
export function openInChrome(chrome: string, args: string[], spawnProcess: typeof spawn = spawn): void {
  const child = spawnProcess(chrome, args, { detached: true, stdio: 'ignore' })
  // 'error' 를 듣지 않으면 띄우기 실패(ENOENT 등)가 잡히지 않은 예외로 서버를 죽인다
  child.on('error', (error) => {
    cachedChrome = null
    console.error(`[open-in-chrome] ${args.join(' ')}: ${error.message}`)
  })
  child.unref()
}
