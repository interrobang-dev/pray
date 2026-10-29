import { createHash } from 'node:crypto'
import { open, readFile, stat } from 'node:fs/promises'
import { decodeText, isBinaryBuffer, MAX_TEXT_BYTES, type TextEncoding } from './workspaceFiles.js'

/**
 * 세션 작업 폴더(cwd) 파일 저장 (Files 탭 편집). 이 PC(loopback) 접속에서만, 기존 글 파일 덮어쓰기만 한다 — 새 파일·지우기·이름 바꾸기 없음.
 * 받은 글은 줄바꿈이 `\n` 이다(CodeMirror). 원래 파일의 줄바꿈(CRLF·LF)과 UTF-8 BOM 을 되살려 쓴다. EUC-KR 파일은 거절한다
 */

/** 편집을 막는 형상관리 내부 폴더 (대소문자 무시). 숨김 목록(HIDDEN_DIRS)의 node_modules·dist 등은 막지 않는다 */
const VCS_META_DIRS = new Set(['.git', '.svn', '.hg'])

/** 경로 어느 칸이든 .git·.svn·.hg 면 true (worktree 의 `.git` 파일 자신도) */
export function isVcsMetaPath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => VCS_META_DIRS.has(part.toLowerCase()))
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * 쓰기 요청이 이 PC 의 화면에서 왔는지 (CSRF 막기). Origin(없으면 Referer)이 loopback 주소(127.0.0.1·localhost·[::1], 포트 무관 — Vite 개발 서버 4711 도)여야 하고,
 * Host 머리도 loopback 이름이어야 한다 — DNS rebinding(공격 사이트 이름을 127.0.0.1 로 풀기)은 Origin 과 Host 가 둘 다 그 사이트 이름이라 Origin==Host 비교로는 못 막는다
 */
export function isLocalPageRequest(headers: { origin?: string; referer?: string; host?: string }): boolean {
  const source = headers.origin ?? headers.referer
  if (!source || source === 'null') return false
  if (!headers.host || !isLoopbackUrl(`http://${headers.host}`)) return false
  return isLoopbackUrl(source)
}

export type LineEnding = 'crlf' | 'lf'

/** 원래 글의 줄바꿈: CRLF 가 혼자 쓰인 LF 보다 많으면 crlf (섞인 파일은 많은 쪽으로 맞춰진다). 줄바꿈이 없으면 lf */
export function detectLineEnding(text: string): LineEnding {
  const crlf = text.split('\r\n').length - 1
  const lf = text.split('\n').length - 1 - crlf
  return crlf > lf ? 'crlf' : 'lf'
}

/** 저장할 바이트: 줄바꿈을 원래 것으로, utf-8-bom 이면 BOM 을 앞에. 받은 글에 CR 이 섞여 있어도 먼저 `\n` 으로 맞춘다 */
export function encodeForSave(text: string, encoding: Exclude<TextEncoding, 'euc-kr'>, lineEnding: LineEnding): Buffer {
  const normalized = text.replace(/\r\n?/g, '\n')
  const body = Buffer.from(lineEnding === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized, 'utf8')
  return encoding === 'utf-8-bom' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body
}

export function sha1Of(data: Uint8Array): string {
  return createHash('sha1').update(data).digest('hex')
}

/** 이 파일을 편집할 수 없는 이유 (화면 글자, 영어). 편집할 수 있으면 null. 파일 응답의 editBlockReason */
export function editBlockReason(options: { isLocal: boolean; path: string; encoding: TextEncoding }): string | null {
  if (!options.isLocal) return 'Editing works only on this PC (open it at 127.0.0.1)'
  if (isVcsMetaPath(options.path)) return "Files inside .git, .svn or .hg can't be edited"
  if (options.encoding === 'euc-kr') return "EUC-KR files can't be edited (saving would change the encoding)"
  return null
}

export type SaveResult =
  | { kind: 'saved'; hash: string; mtime: string; size: number }
  /** 연 뒤 디스크의 파일이 바뀌었다 (지금 것의 정보) */
  | { kind: 'conflict'; hash: string; mtime: string; size: number }
  /** 지금 파일을 글로 편집할 수 없다 (바이너리·1MB 초과·EUC-KR) 또는 저장할 글이 1MB 를 넘는다 */
  | { kind: 'rejected'; status: 413 | 422; message: string }

/**
 * 기존 글 파일을 덮어쓴다. 지금 파일의 sha1 이 expectedHash 와 다르면 쓰지 않고 conflict.
 * **제자리 쓰기**(같은 파일을 열어 앞에서부터 쓰고 길이를 자르고 fsync): 임시 파일 + rename 은 Windows 에서 다른 프로세스(편집기·백신·빌드 감시)가
 * 공유 삭제 없이 연 파일이면 EPERM/EBUSY 로 실패하고, 바뀐 파일이 새 파일이라 읽기 전용·숨김 속성·ACL·하드 링크·대체 데이터 스트림·만든 시각이 사라진다.
 * 대신 쓰다 실패하면 반쯤 쓴 파일이 남을 수 있어 메모리에 둔 원래 바이트로 되돌려 쓴 뒤 던진다
 */
export async function saveTextFile(file: string, text: string, expectedHash: string): Promise<SaveResult> {
  const current = await readFile(file)
  const info = await stat(file)
  const currentHash = sha1Of(current)
  if (currentHash !== expectedHash) return { kind: 'conflict', hash: currentHash, mtime: info.mtime.toISOString(), size: current.length }
  if (current.length > MAX_TEXT_BYTES || isBinaryBuffer(current)) return { kind: 'rejected', status: 422, message: "This file can't be edited as text" }
  const { text: currentText, encoding } = decodeText(current)
  if (encoding === 'euc-kr') return { kind: 'rejected', status: 422, message: "EUC-KR files can't be edited (saving would change the encoding)" }
  const data = encodeForSave(text, encoding, detectLineEnding(currentText))
  if (data.length > MAX_TEXT_BYTES) return { kind: 'rejected', status: 413, message: 'The file would be over 1 MB' }
  await writeInPlace(file, data, current)
  const saved = await stat(file)
  return { kind: 'saved', hash: sha1Of(data), mtime: saved.mtime.toISOString(), size: data.length }
}

async function writeInPlace(file: string, data: Buffer, original: Buffer): Promise<void> {
  // r+ = 있는 파일만 (없으면 ENOENT — 새 파일을 만들지 않는다), 자르지 않고 연다
  const handle = await open(file, 'r+')
  try {
    try {
      await handle.write(data, 0, data.length, 0)
      await handle.truncate(data.length)
      await handle.sync()
    } catch (error) {
      await handle
        .write(original, 0, original.length, 0)
        .then(() => handle.truncate(original.length))
        .catch(() => {})
      throw error
    }
  } finally {
    await handle.close()
  }
}
