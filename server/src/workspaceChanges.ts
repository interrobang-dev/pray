import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import { detectVcs, type Vcs } from './vcs.js'
import { buildFileIndex, isHiddenDir, MAX_TEXT_BYTES, readWorkspaceFile, resolveWorkspacePath } from './workspaceFiles.js'

/**
 * 세션 작업 폴더(cwd)의 형상관리 변경 보기 (화면 Files 탭의 Changes). 읽기만 한다 — git 은 `--no-optional-locks` 로 index 도 쓰지 않고,
 * SVN 은 `svn status`·`svn diff` 로컬만(`-u` 없음). 기준 폴더는 Files 와 같은 cwd realpath 이고 저장소 루트가 그 위여도 cwd 아래 변경만 보인다.
 * 경로는 cwd 상대(구분자 `/`)
 */

export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted' | 'missing'

export interface ChangedFile {
  path: string
  status: ChangeStatus
  /** 이름 바뀜의 옛 경로 (cwd 상대. cwd 밖이면 `../` 로 시작). 아니면 null */
  oldPath: string | null
}

export type WorkspaceChanges =
  | { kind: 'none' }
  | {
      kind: 'git' | 'svn'
      /** git 브랜치 이름 (detached 면 "HEAD"), SVN 은 null */
      branch: string | null
      files: ChangedFile[]
      /** MAX_CHANGED_FILES 에서 잘랐다 */
      isTruncated: boolean
      /** 숨김 폴더(HIDDEN_DIRS) 안의 추적 안 하는 파일 수 (목록에 안 넣었다) */
      hiddenCount: number
      /** 명령을 못 돌렸거나 실패 (화면에 그대로 보이는 영어 문구). 있으면 files 는 비었다 */
      error: string | null
    }

export interface DiffLine {
  kind: 'context' | 'add' | 'del'
  text: string
  oldLine: number | null
  newLine: number | null
  /** 이 줄 뒤에 `\ No newline at end of file` 이 붙었다 */
  hasNoNewline?: boolean
}

export interface DiffHunk {
  /** `@@ -1,3 +1,4 @@ 함수` 머리 그대로 */
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface WorkspaceDiff {
  /** diff = hunks 가 있다 · binary · too-large(MAX_DIFF_BYTES·MAX_TEXT_BYTES 초과) · empty = 내용 변화 없음(이름만 바뀜·속성만·없어진 파일·빈 새 파일) */
  kind: 'diff' | 'binary' | 'too-large' | 'empty'
  path: string
  status: ChangeStatus
  oldPath: string | null
  hunks: DiffHunk[]
  /** 내용 줄을 UTF-8 로 못 풀어 EUC-KR 로 푼 줄이 있으면 euc-kr. diff 가 아니면 null */
  encoding: 'utf-8' | 'euc-kr' | null
  /** SVN 속성 변경이 있다 (화면에 보이지 않는다) */
  hasPropertyChanges: boolean
}

/** 변경 목록 상한 (Files 한 폴더 상한과 같다) */
export const MAX_CHANGED_FILES = 2000
/** diff 출력 상한. 넘으면 too-large */
export const MAX_DIFF_BYTES = 1024 * 1024
const STATUS_MAX_BYTES = 32 * 1024 * 1024
/** diff API 가 다시 쓰는 변경 목록의 나이 상한 */
export const DIFF_LIST_MAX_AGE_MS = 10_000
const COMMAND_TIMEOUT_MS = 15_000

/** 해석 결과 한 줄. path·oldPath 는 명령에 다시 넘길 경로 (git = 저장소 루트 상대, SVN = cwd 상대) */
interface RawChange {
  path: string
  status: ChangeStatus
  oldPath: string | null
}

// ---------- git ----------

/**
 * `git status --porcelain=v2 -z --branch` 해석. 기준은 HEAD 대비 작업 트리 (index 와 작업 트리 변경을 합친다):
 * X(index)·Y(작업 트리) 중 D 가 있으면 deleted, X 가 A 면 added (A 인데 작업 트리에서 지웠으면 HEAD 대비 변화가 없어 뺀다), 그 밖은 modified.
 * index 의 이름 바뀜(2 줄 R)은 renamed (작업 트리에서 지웠으면 옛 파일의 deleted), 복사(C)는 added, 충돌(u 줄)은 conflicted, `?` 는 untracked.
 * 경로는 저장소 루트 상대다 (실행한 폴더와 무관)
 */
export function parseGitStatus(output: string): { branch: string | null; isInitial: boolean; changes: RawChange[] } {
  const tokens = output.split('\0')
  let branch: string | null = null
  let isInitial = false
  const changes: RawChange[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.startsWith('# branch.head ')) {
      const head = token.slice('# branch.head '.length)
      branch = head === '(detached)' ? 'HEAD' : head
    } else if (token === '# branch.oid (initial)') {
      isInitial = true
    } else if (token.startsWith('1 ')) {
      const [, xy] = token.split(' ', 2)
      const path = afterFields(token, 8)
      const [x, y] = xy
      if (x === 'A' && y === 'D') continue
      const status: ChangeStatus = x === 'D' || y === 'D' ? 'deleted' : x === 'A' ? 'added' : 'modified'
      changes.push({ path, status, oldPath: null })
    } else if (token.startsWith('2 ')) {
      const [, xy] = token.split(' ', 2)
      const path = afterFields(token, 9)
      const oldPath = tokens[++i] ?? ''
      if (xy[0] === 'C') changes.push({ path, status: 'added', oldPath: null })
      else if (xy[1] === 'D') changes.push({ path: oldPath, status: 'deleted', oldPath: null })
      else changes.push({ path, status: 'renamed', oldPath })
    } else if (token.startsWith('u ')) {
      changes.push({ path: afterFields(token, 10), status: 'conflicted', oldPath: null })
    } else if (token.startsWith('? ')) {
      changes.push({ path: token.slice(2), status: 'untracked', oldPath: null })
    }
  }
  return { branch, isInitial, changes }
}

/** 공백으로 나뉜 앞 count 칸 뒤의 나머지 (경로에는 공백이 들 수 있다) */
function afterFields(token: string, count: number): string {
  let at = 0
  for (let n = 0; n < count; n++) at = token.indexOf(' ', at) + 1
  return token.slice(at)
}

// ---------- SVN ----------

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, name: string) =>
    name[0] === '#' ? String.fromCodePoint(name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1))) : XML_ENTITIES[name.toLowerCase()],
  )
}

function xmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attributes[match[1]] = decodeXml(match[2])
  return attributes
}

/**
 * `svn status --xml` 해석 (출력은 늘 UTF-8 — 일반 출력은 코드 페이지라 한글 이름이 깨진다). 경로는 실행할 때 준 대상(`.` = cwd) 상대이고 `\` 를 `/` 로 바꾼다.
 * item: modified·replaced·merged → modified, added(moved-from 이면 renamed), deleted(moved-to 의 짝이 목록에 있으면 뺀다), missing → missing,
 * conflicted·obstructed·incomplete·tree-conflicted → conflicted, unversioned → untracked. normal 인데 속성만 바뀌면 modified(속성 충돌은 conflicted).
 * external·ignored·none·normal 은 뺀다
 */
export function parseSvnStatusXml(xml: string): RawChange[] {
  const changes: RawChange[] = []
  const movedTo = new Set<string>()
  for (const match of xml.matchAll(/<entry\s([^>]*)>\s*<wc-status\s([^>]*)>/g)) {
    const path = toSlash(xmlAttributes(match[1]).path ?? '')
    const status = xmlAttributes(match[2])
    const item = status.item
    const props = status.props
    if (!path || path === '.') continue
    let change: ChangeStatus | null = null
    let oldPath: string | null = null
    if (status['tree-conflicted'] === 'true' || ['conflicted', 'obstructed', 'incomplete'].includes(item) || props === 'conflicted') change = 'conflicted'
    else if (['modified', 'replaced', 'merged'].includes(item)) change = 'modified'
    else if (item === 'added') {
      oldPath = status['moved-from'] ? toSlash(status['moved-from']) : null
      change = oldPath ? 'renamed' : 'added'
    } else if (item === 'deleted') {
      if (status['moved-to']) movedTo.add(path)
      change = 'deleted'
    } else if (item === 'missing') change = 'missing'
    else if (item === 'unversioned') change = 'untracked'
    else if (item === 'normal' && props === 'modified') change = 'modified'
    if (change) changes.push({ path, status: change, oldPath })
  }
  const renamedFrom = new Set(changes.flatMap((change) => (change.status === 'renamed' && change.oldPath ? [change.oldPath] : [])))
  return changes.filter((change) => !(change.status === 'deleted' && movedTo.has(change.path) && renamedFrom.has(change.path)))
}

function toSlash(path: string): string {
  return path.replace(/\\/g, '/')
}

// ---------- diff ----------

/**
 * diff 출력을 줄로 푼다. 줄마다 UTF-8(fatal) → 안 되면 EUC-KR — SVN 의 `Index:` 머리는 코드 페이지(CP949)이고 내용은 파일 바이트 그대로라
 * 한 출력 안에서 인코딩이 섞인다. 줄 끝 CR 은 뗀다. eucKrLines = EUC-KR 로 푼 줄 번호 (파일 인코딩은 hunk 안 줄만 보고 정한다 — parseUnifiedDiff)
 */
export function decodeDiffOutput(data: Uint8Array): { lines: string[]; eucKrLines: Set<number> } {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  const eucKr = new TextDecoder('euc-kr')
  const lines: string[] = []
  const eucKrLines = new Set<number>()
  let start = 0
  for (let i = 0; i <= data.length; i++) {
    if (i < data.length && data[i] !== 0x0a) continue
    let end = i
    if (end > start && data[end - 1] === 0x0d) end--
    const bytes = data.subarray(start, end)
    try {
      lines.push(utf8.decode(bytes))
    } catch {
      eucKrLines.add(lines.length)
      lines.push(eucKr.decode(bytes))
    }
    start = i + 1
  }
  if (lines.length > 0 && lines[lines.length - 1] === '' && data[data.length - 1] === 0x0a) lines.pop()
  return { lines, eucKrLines }
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const BINARY_MARKERS = ['Binary files ', 'GIT binary patch', 'Cannot display: file marked as a binary type.']

/**
 * unified diff 줄(git·svn) → hunk. hunk 는 머리의 옛·새 줄 수만큼만 읽어 끝을 안다 — SVN 의 속성 변경 절(`## -0,0 +1 ##`·`+값`)이
 * 앞 hunk 에 붙지 않게. `\` 줄은 앞 줄의 끝 줄바꿈 없음 표시. hunk 밖 줄은 바이너리·속성 변경 표시만 본다.
 * 내용 줄에 NUL 이 있으면 바이너리 (SVN 은 mime-type 이 바이너리여도 `--force` 로 내용을 받아서다 — 아래 diffChange).
 * eucKrLines(decodeDiffOutput) 중 hunk 안 줄이 있으면 isEucKr — SVN 의 `--- 한글.txt` 머리처럼 hunk 밖 줄은 세지 않는다
 */
export function parseUnifiedDiff(
  lines: string[],
  eucKrLines: ReadonlySet<number> = new Set(),
): { hunks: DiffHunk[]; isBinary: boolean; isEucKr: boolean; hasPropertyChanges: boolean } {
  const hunks: DiffHunk[] = []
  let isBinary = false
  let isEucKr = false
  let hasPropertyChanges = false
  let current: DiffHunk | null = null
  let oldLeft = 0
  let newLeft = 0
  let oldLine = 0
  let newLine = 0
  for (const [index, line] of lines.entries()) {
    if (current && line.startsWith('\\')) {
      const last = current.lines[current.lines.length - 1]
      if (last) last.hasNoNewline = true
      continue
    }
    if (current && (oldLeft > 0 || newLeft > 0)) {
      const mark = line[0]
      const text = line.slice(1)
      const isContent = (mark === '+' && newLeft > 0) || (mark === '-' && oldLeft > 0) || ((mark === ' ' || line === '') && oldLeft > 0 && newLeft > 0)
      if (isContent && text.includes('\0')) isBinary = true
      if (isContent && eucKrLines.has(index)) isEucKr = true
      if (mark === '+' && newLeft > 0) {
        current.lines.push({ kind: 'add', text, oldLine: null, newLine: newLine++ })
        newLeft--
        continue
      }
      if (mark === '-' && oldLeft > 0) {
        current.lines.push({ kind: 'del', text, oldLine: oldLine++, newLine: null })
        oldLeft--
        continue
      }
      // 빈 줄은 끝 공백을 지운 문맥 줄로 본다
      if ((mark === ' ' || line === '') && oldLeft > 0 && newLeft > 0) {
        current.lines.push({ kind: 'context', text, oldLine: oldLine++, newLine: newLine++ })
        oldLeft--
        newLeft--
        continue
      }
      oldLeft = 0
      newLeft = 0
    }
    const header = HUNK_HEADER.exec(line)
    if (header) {
      const [, oldStart, oldCount, newStart, newCount] = header
      current = {
        header: line,
        oldStart: Number(oldStart),
        oldLines: oldCount === undefined ? 1 : Number(oldCount),
        newStart: Number(newStart),
        newLines: newCount === undefined ? 1 : Number(newCount),
        lines: [],
      }
      hunks.push(current)
      oldLeft = current.oldLines
      newLeft = current.newLines
      oldLine = current.oldStart
      newLine = current.newStart
      continue
    }
    current = null
    if (BINARY_MARKERS.some((marker) => line.startsWith(marker))) isBinary = true
    if (line.startsWith('Property changes on: ')) hasPropertyChanges = true
  }
  return { hunks, isBinary, isEucKr, hasPropertyChanges }
}

/** 새 파일 글 전체를 추가 hunk 하나로 (추적 안 하는 파일·커밋이 없는 저장소의 새 파일). 끝 줄바꿈 하나 뒤 빈 줄은 세지 않는다 */
export function additionHunks(text: string): DiffHunk[] {
  const withoutCr = text.replace(/\r/g, '')
  if (withoutCr === '') return []
  const hasFinalNewline = withoutCr.endsWith('\n')
  const lines = (hasFinalNewline ? withoutCr.slice(0, -1) : withoutCr).split('\n')
  const diffLines: DiffLine[] = lines.map((line, index) => ({ kind: 'add', text: line, oldLine: null, newLine: index + 1 }))
  if (!hasFinalNewline) diffLines[diffLines.length - 1].hasNoNewline = true
  return [{ header: `@@ -0,0 +1,${lines.length} @@`, oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines: diffLines }]
}

// ---------- 명령 ----------

/** 형상관리 명령 실패. message 는 화면에 그대로 보이는 영어 */
export class VcsCommandError extends Error {}

/**
 * 셸 없이 실행하고 stdout 바이트를 준다. 실패는 화면에 보일 영어 문구의 VcsCommandError (stderr 첫 줄은 ASCII 일 때만 붙인다 — 한국어로 나올 수 있다).
 * 출력이 maxBytes 를 넘으면 code 'too-large'
 */
function run(command: 'git' | 'svn', args: string[], cwd: string, maxBytes: number): Promise<Buffer> {
  // git 메시지를 영어로 (Windows 에서 LC_ALL 은 번역에만 쓰인다). svn 은 경로를 코드 페이지로 바꾸는 데 locale 을 써서 건드리지 않는다
  const env = command === 'git' ? { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } : process.env
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, encoding: 'buffer', maxBuffer: maxBytes, timeout: COMMAND_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout)
        return
      }
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') reject(new VcsCommandError(`${command} isn't installed or isn't on PATH`))
      else if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(Object.assign(new VcsCommandError('Output too large'), { code: 'too-large' }))
      else if (error.killed) reject(new VcsCommandError(`${command} timed out after ${COMMAND_TIMEOUT_MS / 1000}s`))
      else {
        const firstLine = String(stderr).split(/\r?\n/).find((line) => line.trim()) ?? ''
        const detail = /^[\x20-\x7e]+$/.test(firstLine) ? `: ${firstLine.trim()}` : ''
        reject(new VcsCommandError(`${command} ${args.find((arg) => arg === 'status' || arg === 'diff') ?? ''} failed${detail}`))
      }
    })
  })
}

const GIT_BASE = ['--no-optional-locks', '--literal-pathspecs', '-c', 'core.quotepath=false']

/** 변경 목록 + 다시 diff 할 때 쓸 해석 결과 */
interface ChangesSnapshot {
  result: WorkspaceChanges
  vcs: Vcs | null
  isInitial: boolean
  /** cwd 상대 경로 → 명령에 넘길 경로 */
  byPath: Map<string, { file: ChangedFile; raw: RawChange }>
}

/** cwd 상대 경로가 숨김 폴더 안인지 (파일 이름은 보지 않는다) */
function isInHiddenDir(path: string): boolean {
  return path.split('/').slice(0, -1).some(isHiddenDir)
}

async function loadChanges(cwd: string): Promise<ChangesSnapshot> {
  const vcs = detectVcs(cwd)
  if (!vcs) return { result: { kind: 'none' }, vcs, isInitial: false, byPath: new Map() }
  const byPath = new Map<string, { file: ChangedFile; raw: RawChange }>()
  let branch: string | null = null
  let isInitial = false
  let hiddenCount = 0
  let isTruncated = false
  const add = (file: ChangedFile, raw: RawChange) => {
    if (file.status === 'untracked' && isInHiddenDir(file.path)) {
      hiddenCount++
      return
    }
    if (byPath.size >= MAX_CHANGED_FILES) {
      isTruncated = true
      return
    }
    byPath.set(file.path, { file, raw })
  }
  try {
    if (vcs.kind === 'git') {
      // 추적 안 하는 파일은 폴더째가 아니라 파일마다(-uall, .gitignore 는 지킨다). `-- .` 로 cwd 아래만
      const output = await run('git', [...GIT_BASE, 'status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all', '--renames', '--', '.'], cwd, STATUS_MAX_BYTES)
      const parsed = parseGitStatus(output.toString('utf8'))
      branch = parsed.branch
      isInitial = parsed.isInitial
      const prefix = toSlash(win32.relative(vcs.root, cwd))
      const fromRoot = (path: string) => (prefix ? posix.relative(prefix, path) : path)
      for (const raw of parsed.changes) add({ path: fromRoot(raw.path), status: raw.status, oldPath: raw.oldPath === null ? null : fromRoot(raw.oldPath) }, raw)
    } else {
      const output = await run('svn', ['status', '--xml', '--non-interactive', '--', '.'], cwd, STATUS_MAX_BYTES)
      for (const raw of parseSvnStatusXml(output.toString('utf8'))) {
        const isDir = raw.status === 'untracked' && (await stat(join(cwd, raw.path)).catch(() => null))?.isDirectory()
        if (!isDir) {
          add({ path: raw.path, status: raw.status, oldPath: raw.oldPath }, raw)
          continue
        }
        // svn 은 버전 관리 밖 폴더를 한 줄로만 준다 — 안의 파일을 Files 찾기와 같은 규칙(숨김 폴더·링크 제외)으로 편다
        if (isHiddenDir(raw.path.split('/').pop() ?? '')) {
          hiddenCount++
          continue
        }
        const index = await buildFileIndex(join(cwd, raw.path), { maxFiles: MAX_CHANGED_FILES, maxMs: 2000 })
        if (index.isPartial) isTruncated = true
        for (const inner of index.paths) {
          const path = `${raw.path}/${inner}`
          add({ path, status: 'untracked', oldPath: null }, { path, status: 'untracked', oldPath: null })
        }
      }
    }
  } catch (error) {
    if (!(error instanceof VcsCommandError)) throw error
    const message = (error as VcsCommandError & { code?: string }).code === 'too-large' ? 'Too many changes to list' : error.message
    return { result: { kind: vcs.kind, branch, files: [], isTruncated: false, hiddenCount: 0, error: message }, vcs, isInitial, byPath: new Map() }
  }
  const files = [...byPath.values()].map((entry) => entry.file).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { result: { kind: vcs.kind, branch, files, isTruncated, hiddenCount, error: null }, vcs, isInitial, byPath }
}

/**
 * cwd 별 변경 목록 캐시. maxAgeMs 안에 받은 것(또는 받는 중인 것)을 준다 — 목록 API 는 0(받는 중인 것만 같이 기다림),
 * diff API 는 몇 초 전 목록을 써서 파일마다 status 를 다시 돌리지 않는다. 최근 maxRoots 개
 */
export function makeChangesCache({ maxRoots = 8, load = loadChanges, now = () => Date.now() }: { maxRoots?: number; load?: (cwd: string) => Promise<ChangesSnapshot>; now?: () => number } = {}) {
  const entries = new Map<string, { at: number; isPending: boolean; snapshot: Promise<ChangesSnapshot> }>()
  return function changesOf(cwd: string, maxAgeMs: number): Promise<ChangesSnapshot> {
    const key = cwd.toLowerCase()
    const cached = entries.get(key)
    if (cached && (cached.isPending || now() - cached.at < maxAgeMs)) return cached.snapshot
    const entry = { at: now(), isPending: true, snapshot: load(cwd) }
    entries.delete(key)
    entries.set(key, entry)
    entry.snapshot.then(
      () => {
        entry.isPending = false
        entry.at = now()
      },
      () => entries.get(key) === entry && entries.delete(key),
    )
    while (entries.size > maxRoots) entries.delete(entries.keys().next().value as string)
    return entry.snapshot
  }
}

export async function listChanges(changesOf: ReturnType<typeof makeChangesCache>, cwd: string): Promise<WorkspaceChanges> {
  return (await changesOf(cwd, 0)).result
}

/** 그 파일의 diff. 변경 목록(DIFF_LIST_MAX_AGE_MS 안의 것)에 없는 경로면 null */
export async function diffChange(changesOf: ReturnType<typeof makeChangesCache>, cwd: string, path: string): Promise<WorkspaceDiff | null> {
  let snapshot = await changesOf(cwd, DIFF_LIST_MAX_AGE_MS)
  // 방금 생긴 변경일 수 있다 (목록을 받은 뒤 파일이 바뀌었으면 화면은 ↻ 로 다시 받는다)
  if (!snapshot.byPath.has(path)) snapshot = await changesOf(cwd, 0)
  const entry = snapshot.byPath.get(path)
  if (!entry || !snapshot.vcs) return null
  const { file, raw } = entry
  const base = { path: file.path, status: file.status, oldPath: file.oldPath, hunks: [], encoding: null, hasPropertyChanges: false }
  // 추적 안 하는 파일·커밋이 없는 저장소의 새 파일은 비교할 HEAD 가 없어 파일 글 전체를 추가로
  if (file.status === 'untracked' || (snapshot.isInitial && file.status === 'added')) {
    const target = await resolveWorkspacePath(cwd, file.path)
    const content = target ? await readWorkspaceFile(target, MAX_TEXT_BYTES).catch(() => null) : null
    if (!content) return { ...base, kind: 'empty' }
    if (content.kind !== 'text') return { ...base, kind: content.kind }
    const hunks = additionHunks(content.text)
    if (hunks.length === 0) return { ...base, kind: 'empty' }
    return { ...base, kind: 'diff', hunks, encoding: content.encoding === 'euc-kr' ? 'euc-kr' : 'utf-8' }
  }
  if (file.status === 'missing') return { ...base, kind: 'empty' }
  let output: Buffer
  try {
    output =
      snapshot.vcs.kind === 'git'
        ? await run(
            'git',
            [
              ...GIT_BASE,
              'diff',
              'HEAD',
              '--no-color',
              '--no-ext-diff',
              '--no-textconv',
              '--unified=3',
              '--src-prefix=a/',
              '--dst-prefix=b/',
              raw.oldPath ? '-M' : '--no-renames',
              '--',
              ...(raw.oldPath ? [raw.oldPath, raw.path] : [raw.path]),
            ],
            snapshot.vcs.root,
            MAX_DIFF_BYTES,
          )
        : // --force: svn 은 add 할 때 비ASCII 가 많은 글(한글·EUC-KR 소스)에도 바이너리 mime-type 을 붙이고 diff 를 막는다. 진짜 바이너리는 NUL 로 가린다
          await run('svn', ['diff', '--non-interactive', '--internal-diff', '--force', '--', raw.path], cwd, MAX_DIFF_BYTES)
  } catch (error) {
    if ((error as { code?: string }).code === 'too-large') return { ...base, kind: 'too-large' }
    throw error
  }
  const { lines, eucKrLines } = decodeDiffOutput(output)
  const parsed = parseUnifiedDiff(lines, eucKrLines)
  if (parsed.isBinary) return { ...base, kind: 'binary', hasPropertyChanges: parsed.hasPropertyChanges }
  if (parsed.hunks.length === 0) return { ...base, kind: 'empty', hasPropertyChanges: parsed.hasPropertyChanges }
  return { ...base, kind: 'diff', hunks: parsed.hunks, encoding: parsed.isEucKr ? 'euc-kr' : 'utf-8', hasPropertyChanges: parsed.hasPropertyChanges }
}

