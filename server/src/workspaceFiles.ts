import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, join, relative, resolve } from 'node:path'
import { isInside } from './scratchpad.js'

/**
 * 세션 작업 폴더(cwd) 파일 보기 (화면 Files 탭). 읽기만 한다.
 * 기준 폴더(root)는 세션 cwd 의 realpath 이고, 요청 경로는 그 기준의 상대 경로(구분자 `/`)다
 */

/** 목록·찾기에서 숨기는 폴더 이름 (대소문자 무시). 형상관리 내부·의존성·빌드 결과처럼 크고 사람이 읽지 않는 것. 경로로 직접 열면 보인다 */
export const HIDDEN_DIRS = new Set(
  ['.git', '.svn', '.hg', 'node_modules', 'dist', 'build', '.next', '.nuxt', '.turbo', '.vite', '.cache', 'coverage', '__pycache__', '.pytest_cache', '.venv', '.vs'].map(
    (name) => name.toLowerCase(),
  ),
)
/** 한 폴더 목록 상한 */
export const MAX_ENTRIES = 2000
/** 이보다 큰 파일은 글자를 보내지 않는다 */
export const MAX_TEXT_BYTES = 1024 * 1024

export function isHiddenDir(name: string): boolean {
  return HIDDEN_DIRS.has(name.toLowerCase())
}

/**
 * 요청 경로 꼴 검사 (풀어서 밖으로 나가는지는 resolveWorkspacePath 가 본다). 빈 글 = 기준 폴더 (allowRoot 일 때만).
 * 콜론(드라이브 문자·NTFS 대체 데이터 스트림)·NUL·절대 경로는 거절한다 — scratchpad.ts 의 isSafeRelativePath 와 같은 규칙
 */
export function isValidRequestPath(path: string, allowRoot: boolean): boolean {
  if (path === '') return allowRoot
  return !path.includes('\0') && !path.includes(':') && !/^[\\/]/.test(path)
}

/** 요청 경로 → 기준 폴더 안의 실제 경로(realpath). 기준 밖이거나(링크·junction 포함) 없으면 null. 빈 글이면 기준 폴더 */
export async function resolveWorkspacePath(root: string, path: string): Promise<string | null> {
  const requested = resolve(root, path)
  const isRoot = (target: string) => relative(root, target) === ''
  if (!isRoot(requested) && !isInside(root, requested)) return null
  try {
    const real = await realpath(requested)
    return isRoot(real) || isInside(root, real) ? real : null
  } catch {
    return null
  }
}

export interface WorkspaceEntry {
  name: string
  kind: 'dir' | 'file'
  size: number
  /** ISO 시각 */
  mtime: string
}

export interface WorkspaceFolder {
  entries: WorkspaceEntry[]
  /** 숨긴 폴더(HIDDEN_DIRS)와 기준 밖을 가리키는 링크 수 */
  hiddenCount: number
  /** MAX_ENTRIES 를 넘어 뒤를 잘랐다 */
  isTruncated: boolean
}

const nameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** 폴더 먼저, 이름순 (대소문자 무시·숫자는 값으로. 같으면 글자 그대로) */
export function compareEntries(a: Pick<WorkspaceEntry, 'name' | 'kind'>, b: Pick<WorkspaceEntry, 'name' | 'kind'>): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
  return nameCollator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

/**
 * 폴더 한 단계 목록. folder 는 resolveWorkspacePath 로 얻은 실제 경로.
 * 링크·junction 은 기준 안을 가리킬 때만 그 대상의 종류로 보이고, 밖이면 숨긴다 (열어도 resolveWorkspacePath 가 거절한다)
 */
export async function listFolder(root: string, folder: string, limit = MAX_ENTRIES): Promise<WorkspaceFolder> {
  const dirents = await readdir(folder, { withFileTypes: true })
  let hiddenCount = 0
  const kept: { name: string; kind: 'dir' | 'file' }[] = []
  for (const dirent of dirents) {
    let kind: 'dir' | 'file' | null = dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : null
    if (dirent.isSymbolicLink()) {
      const target = await resolveWorkspacePath(root, relative(root, join(folder, dirent.name)))
      const info = target ? await stat(target).catch(() => null) : null
      if (!info) {
        hiddenCount++
        continue
      }
      kind = info.isDirectory() ? 'dir' : info.isFile() ? 'file' : null
    }
    if (!kind) continue
    if (kind === 'dir' && isHiddenDir(dirent.name)) {
      hiddenCount++
      continue
    }
    kept.push({ name: dirent.name, kind })
  }
  kept.sort(compareEntries)
  const shown = kept.slice(0, limit)
  const entries = await Promise.all(
    shown.map(async ({ name, kind }): Promise<WorkspaceEntry | null> => {
      try {
        const info = await stat(join(folder, name))
        return { name, kind, size: kind === 'file' ? info.size : 0, mtime: info.mtime.toISOString() }
      } catch {
        return null // 읽는 사이 지워짐
      }
    }),
  )
  return { entries: entries.filter((entry): entry is WorkspaceEntry => entry !== null), hiddenCount, isTruncated: kept.length > limit }
}

/** 확장자·파일 이름 → highlight.js 언어 (화면 문법 강조가 싣는 highlight.js common 안에서). 없으면 강조 없이 */
const LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.properties': 'ini',
  '.sql': 'sql',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.vb': 'vbnet',
  '.rb': 'ruby',
  '.php': 'php',
  '.lua': 'lua',
  '.pl': 'perl',
  '.r': 'r',
  '.swift': 'swift',
  '.m': 'objectivec',
  '.diff': 'diff',
  '.patch': 'diff',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'xml',
  '.htm': 'xml',
  '.xml': 'xml',
  '.xsl': 'xml',
  '.xhtml': 'xml',
  '.svg': 'xml',
  '.vue': 'xml',
  '.csproj': 'xml',
  '.sln': 'ini',
  '.config': 'xml',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.mk': 'makefile',
}
const FILE_NAME_LANGUAGES: Record<string, string> = {
  makefile: 'makefile',
  dockerfile: 'bash',
  '.gitignore': 'bash',
  '.env': 'bash',
}

export function languageOf(path: string): string | null {
  const name = basename(path).toLowerCase()
  return FILE_NAME_LANGUAGES[name] ?? LANGUAGES[extname(name)] ?? null
}

/** 글자 인코딩. utf-8-bom 의 BOM 은 text 에서 뺀다. 4단계(편집) 저장 때 되돌려 붙이고, euc-kr 은 편집을 막는다 */
export type TextEncoding = 'utf-8' | 'utf-8-bom' | 'euc-kr'

export type WorkspaceFile =
  | { kind: 'text'; text: string; size: number; mtime: string; hash: string; language: string | null; encoding: TextEncoding }
  | { kind: 'binary'; isBinary: true; size: number; mtime: string }
  | { kind: 'too-large'; isTooLarge: true; size: number; mtime: string }

/** NUL 바이트가 있으면 바이너리 (git 과 같은 어림. UTF-16 글도 바이너리로 본다) */
export function isBinaryBuffer(data: Uint8Array): boolean {
  return data.includes(0)
}

/** UTF-8(BOM 있음·없음)로 풀리면 그것, 아니면 EUC-KR(CP949) — 사내 옛 소스가 이 인코딩이다 */
export function decodeText(data: Uint8Array): { text: string; encoding: TextEncoding } {
  const hasBom = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hasBom ? data.subarray(3) : data)
    return { text, encoding: hasBom ? 'utf-8-bom' : 'utf-8' }
  } catch {
    return { text: new TextDecoder('euc-kr').decode(data), encoding: 'euc-kr' }
  }
}

/** 파일 하나. hash = 파일 바이트의 sha1 (4단계 편집의 충돌 검사용) */
export async function readWorkspaceFile(file: string, maxBytes = MAX_TEXT_BYTES): Promise<WorkspaceFile> {
  const info = await stat(file)
  const mtime = info.mtime.toISOString()
  if (info.size > maxBytes) return { kind: 'too-large', isTooLarge: true, size: info.size, mtime }
  const data = await readFile(file)
  // stat 뒤에 커졌을 수 있다
  if (data.length > maxBytes) return { kind: 'too-large', isTooLarge: true, size: data.length, mtime }
  if (isBinaryBuffer(data)) return { kind: 'binary', isBinary: true, size: data.length, mtime }
  const { text, encoding } = decodeText(data)
  const hash = createHash('sha1').update(data).digest('hex')
  return { kind: 'text', text, size: data.length, mtime, hash, language: languageOf(file), encoding }
}

export interface FileIndex {
  /** 기준 폴더 상대 경로 (구분자 `/`) */
  paths: string[]
  /** 파일 수·시간 상한에 걸려 다 훑지 못했다 */
  isPartial: boolean
  elapsedMs: number
}

/** 빠른 찾기용 파일 목록. 숨긴 폴더·링크는 들어가지 않는다 (밖으로 나가거나 맴돌지 않게). 얕은 폴더부터 */
export async function buildFileIndex(root: string, { maxFiles = 50_000, maxMs = 3000, now = () => Date.now() } = {}): Promise<FileIndex> {
  const startedAt = now()
  const paths: string[] = []
  const queue = ['']
  while (queue.length > 0) {
    if (paths.length >= maxFiles || now() - startedAt > maxMs) return { paths, isPartial: true, elapsedMs: now() - startedAt }
    const folder = queue.shift() as string
    let dirents
    try {
      dirents = await readdir(join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      const path = folder ? `${folder}/${dirent.name}` : dirent.name
      if (dirent.isSymbolicLink()) continue
      if (dirent.isDirectory()) {
        if (!isHiddenDir(dirent.name)) queue.push(path)
      } else if (dirent.isFile()) {
        paths.push(path)
      }
    }
  }
  return { paths, isPartial: false, elapsedMs: now() - startedAt }
}

/**
 * 경로가 찾는 글에 얼마나 맞는지 (작을수록 앞). 안 맞으면 null. 대소문자 무시.
 * 0 이름이 같음 · 1 이름이 그 글로 시작 · 2 이름에 듦 · 3 경로에 듦(공백으로 나눈 낱말은 모두 경로에) · 4 이름에 글자 순서대로 듦 · 5 경로에 글자 순서대로 듦
 */
export function matchScore(path: string, query: string): number | null {
  const words = query.toLowerCase().replace(/\\/g, '/').split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const lowerPath = path.toLowerCase()
  if (words.length > 1) return words.every((word) => lowerPath.includes(word)) ? 3 : null
  const [word] = words
  const name = lowerPath.slice(lowerPath.lastIndexOf('/') + 1)
  if (name === word) return 0
  if (name.startsWith(word)) return 1
  if (name.includes(word)) return 2
  if (lowerPath.includes(word)) return 3
  if (isSubsequence(word, name)) return 4
  if (isSubsequence(word, lowerPath)) return 5
  return null
}

function isSubsequence(needle: string, haystack: string): boolean {
  let at = 0
  for (const char of haystack) {
    if (char === needle[at]) at++
    if (at === needle.length) return true
  }
  return false
}

/** 맞는 경로를 점수 → 짧은 경로 → 글자순으로 limit 개까지. total 은 맞은 전체 수 */
export function findFiles(paths: string[], query: string, limit = 100): { paths: string[]; total: number } {
  const matches: { path: string; score: number }[] = []
  for (const path of paths) {
    const score = matchScore(path, query)
    if (score !== null) matches.push({ path, score })
  }
  matches.sort((a, b) => a.score - b.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { paths: matches.slice(0, limit).map((match) => match.path), total: matches.length }
}

/**
 * 기준 폴더별 파일 목록 캐시 (서버 메모리). 글자를 칠 때마다 다시 훑지 않게 ttl 동안 둔다 — 그 사이 생긴 파일은 ttl 뒤에 보인다.
 * 같은 폴더를 훑는 중이면 그 결과를 같이 기다린다. 최근 maxRoots 개만 둔다
 */
export function makeFileIndexCache({
  ttlMs = 30_000,
  maxRoots = 8,
  build = (root: string) => buildFileIndex(root),
  now = () => Date.now(),
}: { ttlMs?: number; maxRoots?: number; build?: (root: string) => Promise<FileIndex>; now?: () => number } = {}) {
  const entries = new Map<string, { at: number; index: Promise<FileIndex> }>()
  return function indexOf(root: string): Promise<FileIndex> {
    const key = root.toLowerCase()
    const cached = entries.get(key)
    entries.delete(key)
    if (cached && now() - cached.at < ttlMs) {
      entries.set(key, cached)
      return cached.index
    }
    const index = build(root)
    entries.set(key, { at: now(), index })
    // 실패한 것은 남기지 않는다
    index.catch(() => entries.get(key)?.index === index && entries.delete(key))
    while (entries.size > maxRoots) entries.delete(entries.keys().next().value as string)
    return index
  }
}
