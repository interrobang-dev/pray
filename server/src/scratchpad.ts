import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** Claude Code 가 세션마다 만드는 작업 폴더의 부모. 실제 위치는 <여기>/<프로젝트 슬러그>/<세션 ID>/scratchpad */
export const claudeTempDir = join(tmpdir(), 'claude')

/** 목록 상한. headless 브라우저 프로필 같은 것이 들어 있으면 폴더 하나에 파일이 천 개를 넘는다 */
export const MAX_FILES = 1000

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ScratchpadFile {
  /** scratchpad 기준 상대 경로. 구분자는 `/` */
  path: string
  size: number
  modifiedAt: string
}

export function isSessionId(value: string): boolean {
  return SESSION_ID.test(value)
}

/** target 이 root 안(root 자신 제외)인지. Windows 의 path.relative 는 대소문자를 무시한다 */
export function isInside(root: string, target: string): boolean {
  const path = relative(root, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/**
 * 요청으로 받은 상대 경로가 쓸 수 있는 꼴인지 (풀어서 밖으로 나가는지는 resolveScratchpadFile 이 따로 본다).
 * 콜론은 드라이브 문자(`C:x` 는 절대 경로가 아니어도 다른 드라이브로 풀린다)와 NTFS 대체 데이터 스트림(`a.txt:s`)이라 막는다
 */
export function isSafeRelativePath(path: string): boolean {
  return path !== '' && !path.includes('\0') && !path.includes(':') && !isAbsolute(path)
}

/** 세션의 scratchpad 실제 경로(realpath). 없거나, 링크로 claude 임시 폴더 밖을 가리키면 null */
export async function findScratchpad(sessionId: string, baseDir = claudeTempDir): Promise<string | null> {
  if (!isSessionId(sessionId)) return null
  let projects: string[]
  let realBase: string
  try {
    projects = await readdir(baseDir)
    realBase = await realpath(baseDir)
  } catch {
    return null
  }
  for (const project of projects) {
    try {
      const real = await realpath(join(baseDir, project, sessionId, 'scratchpad'))
      if (isInside(realBase, real) && (await stat(real)).isDirectory()) return real
    } catch {
      continue
    }
  }
  return null
}

/** 하위 폴더를 포함한 파일 목록. 얕은 폴더부터 모아 상한에서 멈춘다. 링크·junction 은 따라가지 않는다 (밖의 파일이 보이지 않게) */
export async function listScratchpad(dir: string, limit = MAX_FILES): Promise<{ files: ScratchpadFile[]; isTruncated: boolean }> {
  const files: ScratchpadFile[] = []
  const queue = ['']
  while (queue.length > 0) {
    const folder = queue.shift() as string
    let entries
    try {
      entries = await readdir(join(dir, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = folder ? `${folder}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        queue.push(path)
        continue
      }
      if (!entry.isFile()) continue
      if (files.length >= limit) return { files, isTruncated: true }
      try {
        const info = await stat(join(dir, path))
        files.push({ path, size: info.size, modifiedAt: info.mtime.toISOString() })
      } catch {
        // 읽는 사이 지워진 파일
      }
    }
  }
  return { files, isTruncated: false }
}

/**
 * 세션의 Claude Code 임시 폴더(<base>/<프로젝트 슬러그>/<세션 ID>/, scratchpad·tasks 의 부모) 안의 파일이면 그 실제 경로.
 * 링크를 풀어 밖이거나, 다른 세션 폴더거나, 없거나, 파일이 아니면 null. path 는 jsonl 에 적힌 절대 경로 (백그라운드 shell 출력 파일)
 */
export async function resolveSessionTempFile(sessionId: string, path: string, baseDir = claudeTempDir): Promise<string | null> {
  if (!isSessionId(sessionId) || !isAbsolute(path) || path.includes('\0')) return null
  try {
    const realBase = await realpath(baseDir)
    const real = await realpath(path)
    const parts = relative(realBase, real).split(sep)
    if (!isInside(realBase, real) || parts.length < 3 || parts[1].toLowerCase() !== sessionId.toLowerCase()) return null
    return (await stat(real)).isFile() ? real : null
  } catch {
    return null
  }
}

/** 요청 경로를 scratchpad 안 실제 파일 경로로. 꼴이 잘못됐거나, 링크를 풀어 밖이거나, 없거나, 파일이 아니면 null */
export async function resolveScratchpadFile(scratchpad: string, path: string): Promise<string | null> {
  if (!isSafeRelativePath(path)) return null
  const requested = resolve(scratchpad, path)
  if (!isInside(scratchpad, requested)) return null
  try {
    const real = await realpath(requested)
    if (!isInside(scratchpad, real)) return null
    return (await stat(real)).isFile() ? real : null
  } catch {
    return null
  }
}

/** 대화 첨부를 두는 scratchpad 하위 폴더 */
export const ATTACHMENTS_DIR = 'attachments'
/** 첨부 이름(시각 접두사 빼고) 최대 글자 수. 긴 scratchpad 경로에 붙어도 Windows MAX_PATH(260)를 넘지 않게 */
const MAX_ATTACHMENT_NAME = 80
/** 이름을 자를 때 남기는 확장자 최대 글자 수 (점 포함). 더 길면 확장자로 보지 않고 같이 자른다 */
const MAX_EXTENSION = 16
const DEFAULT_ATTACHMENT_NAME = 'attachment'

/**
 * 받은 파일 이름을 저장해도 되는 이름으로. 경로 앞부분(`/`·`\` 앞)은 버리고(`../x` → `x`), 제어 문자와 Windows 금지 문자(`<>:"|?*`)는 `_`,
 * 끝의 점·공백은 뺀다(Windows 가 저장할 때 지워 이름이 달라지고, `..` 같은 이름은 빈 이름이 된다). 확장자를 남기고 자른다. 비면 기본 이름
 */
export function safeAttachmentName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\p{Cc}<>:"|?*]/gu, '_').trim().replace(/[.\s]+$/, '')
  if (Array.from(cleaned).length <= MAX_ATTACHMENT_NAME) return cleaned || DEFAULT_ATTACHMENT_NAME
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 && Array.from(cleaned.slice(dot)).length <= MAX_EXTENSION ? cleaned.slice(dot) : ''
  const stem = Array.from(extension ? cleaned.slice(0, dot) : cleaned)
    .slice(0, MAX_ATTACHMENT_NAME - Array.from(extension).length)
    .join('')
    .replace(/[.\s]+$/, '')
  return stem + extension || DEFAULT_ATTACHMENT_NAME
}

/** 저장 이름 = 이 PC 시각 `YYYYMMDD-HHmmss-` + 이름. 같은 초에 같은 이름이 있으면 counter(2부터)를 시각 뒤에 붙인다 */
export function attachmentFileName(name: string, at: Date, counter = 1): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  return `${date}-${time}-${counter > 1 ? `${counter}-` : ''}${name}`
}

/**
 * 첨부를 scratchpad 의 attachments/ 에 새 파일로 저장한다 (폴더가 없으면 만든다). path 는 claude 에게 넘길 절대 경로.
 * attachments 가 링크로 scratchpad 밖을 가리키면 던진다. 이미 있는 이름(링크 포함)은 덮어쓰지 않고 counter 를 올린다
 */
export async function saveAttachment(
  scratchpad: string,
  rawName: string,
  data: Uint8Array,
  now = new Date(),
): Promise<{ path: string; name: string; size: number }> {
  const dir = join(scratchpad, ATTACHMENTS_DIR)
  await mkdir(dir, { recursive: true })
  const realDir = await realpath(dir)
  if (!isInside(scratchpad, realDir)) throw new Error(`${ATTACHMENTS_DIR} 폴더가 scratchpad 밖을 가리킴`)
  const safeName = safeAttachmentName(rawName)
  for (let counter = 1; counter <= 100; counter++) {
    const name = attachmentFileName(safeName, now, counter)
    const path = join(realDir, name)
    try {
      await writeFile(path, data, { flag: 'wx' })
      return { path, name, size: data.byteLength }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error(`같은 이름의 첨부가 너무 많음: ${safeName}`)
}

const TEXT = 'text/plain; charset=utf-8'
/** 확장자 → Content-Type. 코드·로그는 브라우저가 글자로 보이게 text/plain (.ts 를 영상(video/mp2t)으로 보내지 않게) */
const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.xhtml': 'application/xhtml+xml',
  '.xml': 'application/xml',
  '.xsl': 'application/xml',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}
const TEXT_EXTENSIONS = new Set(
  '.txt .log .jsonl .ndjson .js .mjs .cjs .jsx .ts .mts .cts .tsx .py .sh .bash .ps1 .psm1 .bat .cmd .yml .yaml .toml .ini .cfg .conf .env .sql .go .rs .java .kt .c .h .cpp .hpp .cs .rb .php .lua .diff .patch .tsv .scss .less .vbs'.split(' '),
)
/** 브라우저가 문서로 열어 스크립트를 돌릴 수 있는 종류. 응답에 CSP sandbox 를 붙인다 */
const ACTIVE_TYPES = new Set(['text/html; charset=utf-8', 'application/xhtml+xml', 'application/xml', 'image/svg+xml'])

/** 파일 응답의 Content-Type 과 스크립트가 돌 수 있는 종류인지. 모르는 확장자는 내려받기(application/octet-stream) */
export function contentTypeOf(path: string): { type: string; isActive: boolean } {
  const extension = extname(path).toLowerCase()
  const type = CONTENT_TYPES[extension] ?? (TEXT_EXTENSIONS.has(extension) ? TEXT : 'application/octet-stream')
  return { type, isActive: ACTIVE_TYPES.has(type) }
}
