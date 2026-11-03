import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { claudeTempDir, contentTypeOf, isInside } from './scratchpad.js'

/**
 * 대화 속 그림 (`GET /api/sessions/:id/image?path=`). claude 가 마크다운으로 `![](C:\…\a.png)` 처럼 이 PC 파일을 링크하면 화면이 이 API 로 받는다.
 * 허용 범위(realpath 기준): 그 세션 작업 폴더(cwd, Files 탭과 같은 기준) 안, 또는 Claude 임시 폴더 `<os.tmpdir()>/claude/` 아래 전체
 * (세션별 scratchpad 가 거기 있고, 팀장이 팀원 scratchpad 의 캡처를 링크한다). 그림 파일(contentTypeOf 가 image/*)만
 */

/** 요청 경로 상한 (Windows 긴 경로도 넉넉히) */
const MAX_PATH_LENGTH = 2048

/**
 * 요청 경로 꼴: 드라이브 문자 절대 경로(`C:\…`·`C:/…`) → absolute, 상대 경로 → relative, 그 밖은 null(400).
 * 거절: 빈 글·너무 긺·제어 문자(NUL 포함)·UNC(`\\server\share`, 끊긴 네트워크 경로를 기다리다 멈출 수 있다)·`\\?\`·
 * 드라이브 루트 기준(`\x`)·드라이브 상대(`C:x`)·드라이브 뒤 콜론(대체 데이터 스트림)·`<>"|?*`
 */
export function chatImagePathKind(path: unknown): 'absolute' | 'relative' | null {
  if (typeof path !== 'string' || path === '' || path.length > MAX_PATH_LENGTH) return null
  if (/[\x00-\x1f]/.test(path)) return null
  const drive = /^[A-Za-z]:[\\/]/.exec(path)
  const rest = drive ? path.slice(drive[0].length) : path
  if (/[:<>"|?*]/.test(rest)) return null
  if (drive) return 'absolute'
  return /^[\\/]/.test(path) ? null : 'relative'
}

/**
 * 요청 경로 → 보낼 그림 파일의 실제 경로(realpath). 꼴이 틀리면·범위 밖(링크·junction 으로 나가는 것 포함)·없음·파일 아님·그림 아님이면 null.
 * root = 세션 작업 폴더의 realpath (없으면 null — 상대 경로는 못 풀고 절대 경로는 임시 폴더만 된다)
 */
export function resolveChatImage(path: string, root: string | null, tempDir = claudeTempDir): Promise<string | null> {
  return resolveChatFile(path, root, (real) => contentTypeOf(real).type.startsWith('image/'), tempDir)
}

/**
 * 대화 속 파일 경로(그림·링크 공용) → 실제 경로(realpath). 꼴·범위는 위와 같고 받을 파일 종류는 isAccepted(realpath 를 받는다)가 정한다.
 * 대화 속 .html 링크를 Chrome 으로 여는 것(openInChrome.ts)도 이것을 쓴다
 */
export async function resolveChatFile(
  path: string,
  root: string | null,
  isAccepted: (real: string) => boolean,
  tempDir = claudeTempDir,
): Promise<string | null> {
  const kind = chatImagePathKind(path)
  if (!kind || (kind === 'relative' && !root)) return null
  const requested = kind === 'absolute' ? resolve(path) : resolve(root as string, path)
  try {
    const real = await realpath(requested)
    const realTemp = await realpath(tempDir).catch(() => null)
    const isAllowed = (root !== null && isInside(root, real)) || (realTemp !== null && isInside(realTemp, real))
    if (!isAllowed || !isAccepted(real)) return null
    return (await stat(real)).isFile() ? real : null
  } catch {
    return null
  }
}
