import { execFile } from 'node:child_process'
import { access, mkdir, opendir, readdir, stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import { normalizeCwd } from '@pray/host/team'
import type { Vcs } from './vcs.js'
import { compareEntries } from './workspaceFiles.js'

/** 한 폴더에서 보이는 하위 폴더 수 상한. 넘으면 뒤를 자르고 isTruncated */
export const MAX_FOLDER_ENTRIES = 2000

export interface FolderEntry {
  name: string
  /** Windows 절대 경로 (`D:\work\foo`, 드라이브는 `D:\`) */
  path: string
  /** 그 폴더 바로 안의 `.git`·`.svn` 만 본다 (위로 올라가지 않는다 — 폴더마다 올라가면 비싸다) */
  vcs: 'git' | 'svn' | null
  /** 이 폴더가 이미 팀 폴더면 그 팀 이름 (`normalizeCwd` 로 비교) */
  teamName: string | null
}

export interface FolderListing {
  entries: FolderEntry[]
  isTruncated: boolean
  /** 숨김·시스템 속성이거나 읽을 수 없어 뺀 폴더 수 */
  hiddenCount: number
}

/**
 * 요청 경로 → 정규화한 Windows 절대 경로 (순수). 꼴이 틀리면 null.
 * 드라이브 문자로 시작하는 경로만 받는다 — UNC(`\\server\share`)·`\\?\` 는 네트워크를 기다리다 요청이 멈출 수 있어 받지 않는다.
 * 드라이브 문자는 대문자, 끝 구분자는 뗀다 (드라이브 루트 `D:\` 는 남긴다)
 */
export function normalizeFolderPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 1000) return null
  // 제어 문자(NUL 포함)
  if (/[\x00-\x1f]/.test(raw)) return null
  if (!/^[A-Za-z]:([\\/]|$)/.test(raw)) return null
  // 드라이브 뒤에 Windows 경로에 못 쓰는 글자 (`:` 는 대체 데이터 스트림)
  if (/[<>:"|?*]/.test(raw.slice(2))) return null
  const normalized = win32.normalize(raw.length === 2 ? `${raw}\\` : raw)
  const withDrive = normalized[0].toUpperCase() + normalized.slice(1)
  return /^[A-Z]:\\$/.test(withDrive) ? withDrive : withDrive.replace(/\\+$/, '')
}

/** 위 폴더. 드라이브 루트면 ''(= 드라이브 목록) */
export function parentFolderOf(folder: string): string {
  const parent = win32.dirname(folder)
  return parent === folder ? '' : parent
}

/** 새 폴더 이름이 Windows 에서 쓸 수 없는 이유 (영어, 화면에 그대로). 되면 null (순수) */
export function folderNameError(name: unknown): string | null {
  if (typeof name !== 'string' || name.length === 0) return 'Enter a folder name'
  if (name.length > 255) return 'Folder name is too long (255 characters max)'
  if (/[\\/:*?"<>|\x00-\x1f]/.test(name)) return `A folder name can't contain \\ / : * ? " < > | or control characters`
  if (name === '.' || name === '..') return `A folder name can't be . or ..`
  // Windows 가 끝의 점·공백을 지워 다른 이름으로 만든다
  if (/[. ]$/.test(name)) return `A folder name can't end with a dot or a space`
  // 장치 이름은 확장자가 붙어도(`con.txt`) 장치로 열린다
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]) *(\..*)?$/i.test(name)) return `"${name}" is a name reserved by Windows`
  return null
}

/** 속성과 관계없이 늘 빼는 폴더 (휴지통·복원 지점 등. 속성을 못 읽었을 때를 위한 이름 규칙) */
export function isSystemFolderName(name: string): boolean {
  return name.startsWith('$') || name.toLowerCase() === 'system volume information'
}

/**
 * 숨김·시스템 속성이 아닌 하위 폴더 이름. Node 는 Windows 속성을 주지 않아 `dir /a:d-h-s` 로 읽는다.
 * 경로를 명령줄에 넣지 않고 cwd 로 줘서 따옴표·`%` 해석 문제가 없다. `/u` 라 출력이 UTF-16(한글 이름 그대로), `/d` 는 AutoRun 을 끈다.
 * 보이는 폴더가 없으면 dir 이 종료 코드 1 이라 빈 집합. 그 밖의 실패(긴 경로 등)는 null — 속성 없이 이름 규칙만 쓴다
 */
export function visibleFolderNames(folder: string): Promise<Set<string> | null> {
  return new Promise((resolve) => {
    execFile('cmd.exe', ['/d', '/u', '/c', 'dir /b /a:d-h-s'], { cwd: folder, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, timeout: 5000, windowsHide: true }, (error, stdout) => {
      const names = stdout.toString('utf16le').split(/\r?\n/).filter(Boolean)
      if (!error) resolve(new Set(names))
      else if ((error as { code?: unknown }).code === 1 && names.length === 0) resolve(new Set())
      else resolve(null)
    })
  })
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

/** 그 폴더 바로 안의 `.git`(폴더 또는 파일 — worktree)·`.svn`. 둘 다 있으면 git (detectVcs 와 같다) */
async function vcsIn(folder: string): Promise<'git' | 'svn' | null> {
  if (await exists(win32.join(folder, '.git'))) return 'git'
  if (await exists(win32.join(folder, '.svn'))) return 'svn'
  return null
}

/** 팀 폴더(`normalizeCwd`) → 팀 이름 */
export function teamNameMap(teams: { name: string; cwd: string }[]): Map<string, string> {
  return new Map(teams.map((team) => [normalizeCwd(team.cwd), team.name]))
}

async function entryOf(path: string, name: string, teamNames: Map<string, string>): Promise<FolderEntry> {
  return { name, path, vcs: await vcsIn(path), teamName: teamNames.get(normalizeCwd(path)) ?? null }
}

/**
 * 하위 폴더 목록 (파일은 없다). 이름순(Files 탭과 같은 정렬) 뒤 limit 에서 자른다.
 * 숨김·시스템 속성·`$…`·System Volume Information·읽을 수 없는 폴더(목록을 못 여는 것)는 빼고 hiddenCount 로 센다.
 * 링크·junction 은 대상이 폴더일 때만. folder 를 못 읽으면 readdir 오류를 그대로 던진다
 */
export async function listSubfolders(
  folder: string,
  teamNames: Map<string, string>,
  { limit = MAX_FOLDER_ENTRIES, visibleNames = visibleFolderNames }: { limit?: number; visibleNames?: (folder: string) => Promise<Set<string> | null> } = {},
): Promise<FolderListing> {
  const [dirents, visible] = await Promise.all([readdir(folder, { withFileTypes: true }), visibleNames(folder)])
  let hiddenCount = 0
  const candidates: { name: string; isLink: boolean }[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
    if (isSystemFolderName(dirent.name) || (visible && !visible.has(dirent.name))) {
      hiddenCount++
      continue
    }
    candidates.push({ name: dirent.name, isLink: dirent.isSymbolicLink() })
  }
  candidates.sort((a, b) => compareEntries({ name: a.name, kind: 'dir' }, { name: b.name, kind: 'dir' }))

  const entries: FolderEntry[] = []
  let index = 0
  // 32개씩 확인하며 limit 까지 채운다 (읽을 수 없는 것을 빼야 해서 자르기 전에 다 볼 수는 없다)
  while (index < candidates.length && entries.length < limit) {
    const batch = candidates.slice(index, index + Math.min(32, limit - entries.length))
    index += batch.length
    const checked = await Promise.all(
      batch.map(async ({ name, isLink }) => {
        const path = win32.join(folder, name)
        try {
          if (isLink && !(await stat(path)).isDirectory()) return 'skip'
          await (await opendir(path)).close()
        } catch {
          return null
        }
        return entryOf(path, name, teamNames)
      }),
    )
    for (const entry of checked) {
      if (entry === null) hiddenCount++
      else if (entry !== 'skip') entries.push(entry)
    }
  }
  return { entries, isTruncated: index < candidates.length, hiddenCount }
}

/** 지금 있는 드라이브 (`A:`~`Z:`). 끊긴 네트워크 드라이브가 오래 걸리지 않게 드라이브마다 1.5초에서 포기한다 */
export async function listDrives(teamNames: Map<string, string>, timeoutMs = 1500): Promise<FolderEntry[]> {
  const letters = Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
  const found = await Promise.all(
    letters.map(async (letter) => {
      const root = `${letter}:\\`
      const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs).unref())
      const isFolder = stat(root).then(
        (info) => info.isDirectory(),
        () => false,
      )
      return (await Promise.race([isFolder, timeout])) ? entryOf(root, `${letter}:`, teamNames) : null
    }),
  )
  return found.filter((entry): entry is FolderEntry => entry !== null)
}

/** parent 안에 폴더 하나를 만든다 (재귀 아님 — parent 가 없으면 ENOENT). 이름은 folderNameError 를 지난 것 */
export async function createFolder(parent: string, name: string): Promise<string> {
  const path = win32.join(parent, name)
  await mkdir(path)
  return path
}

/** 폴더 하나의 상태 (팀 만들기 git init 검사용) */
export async function folderState(path: string): Promise<'missing' | 'not-folder' | 'folder'> {
  return stat(path).then(
    (info) => (info.isDirectory() ? 'folder' : 'not-folder'),
    () => 'missing',
  )
}

/**
 * 팀 만들기에서 git init 을 거절할 이유 (순수). 통과면 null.
 * 다른 PC 를 먼저 막고, 팀이 실패할 이유(그룹 없음·같은 폴더 팀)를 git init 전에 본다 — 저장소만 생기고 팀은 안 생기는 일을 줄이려고
 */
export function gitInitRejection(input: {
  isLocal: boolean
  folder: string | null
  state: 'missing' | 'not-folder' | 'folder'
  hasGroup: boolean
  hasTeam: boolean
  vcs: Vcs | null
}): { status: 400 | 403 | 404 | 409; message: string } | null {
  if (!input.isLocal) return { status: 403, message: 'git init runs only on this PC' }
  if (input.folder === null) return { status: 400, message: 'Work folder must be an absolute path like D:\\work' }
  if (input.state === 'missing') return { status: 404, message: `Folder not found: ${input.folder}` }
  if (input.state === 'not-folder') return { status: 400, message: `Not a folder: ${input.folder}` }
  if (!input.hasGroup) return { status: 400, message: 'Group not found' }
  if (input.hasTeam) return { status: 409, message: `A team for this folder already exists: ${input.folder}` }
  if (input.vcs) return { status: 409, message: `Already inside ${input.vcs.kind === 'git' ? 'a git' : 'an SVN'} repository: ${input.vcs.root}` }
  return null
}

/** git init 실패. message 는 화면에 그대로 보이는 영어 */
export class GitInitError extends Error {}

const GIT_INIT_TIMEOUT_MS = 15_000

/** 폴더에서 `git init -b main`. 셸 없이, 창 없이, 자격 증명 창 없이. 실패는 GitInitError (stderr 첫 줄은 ASCII 일 때만 붙인다) */
export function runGitInit(folder: string): Promise<void> {
  const env = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }
  return new Promise((resolve, reject) => {
    execFile('git', ['init', '-b', 'main'], { cwd: folder, env, timeout: GIT_INIT_TIMEOUT_MS, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) {
        resolve()
        return
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') reject(new GitInitError("git isn't installed or isn't on PATH"))
      else if (error.killed) reject(new GitInitError(`git init timed out after ${GIT_INIT_TIMEOUT_MS / 1000}s`))
      else {
        const firstLine = String(stderr).split(/\r?\n/).find((line) => line.trim()) ?? ''
        reject(new GitInitError(`git init failed${/^[\x20-\x7e]+$/.test(firstLine) ? `: ${firstLine.trim()}` : ''}`))
      }
    })
  })
}
