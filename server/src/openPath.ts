import { realpath, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { chatImagePathKind } from './chatImage.js'
import { isInside } from './scratchpad.js'

/**
 * 대화 속 경로 열기 (`POST /api/sessions/:id/open-path` `{ path }`). claude 답의 경로·경로 링크를 누르면 화면이 이것으로 어디서 열지 묻는다.
 * realpath 기준으로 ① 세션 cwd(Files 탭과 같은 기준) 안 → Files 탭 ② 세션 scratchpad 안 → 작업 파일 창 ③ 그 밖 → 이 PC 의 탐색기(이 PC 접속만).
 * ①② 는 화면에서 읽기 창을 여는 것뿐이라 다른 PC 도 되고, ③ 은 이 PC 화면에 창을 띄우는 것이라 이 PC 만이다
 */

/** 화면으로 보내는 응답 (target 별) */
export type OpenPathBody =
  | { target: 'files'; path: string; isDirectory: boolean; line: number | null }
  | { target: 'work-files'; path: string; isDirectory: boolean }
  | { target: 'explorer' }

/** 판정 결과. explorer 는 라우트가 탐색기를 띄울 실제 경로를 가진다 */
export type OpenPathDecision =
  | { kind: 'open'; body: Exclude<OpenPathBody, { target: 'explorer' }> }
  | { kind: 'explorer'; real: string; isDirectory: boolean }
  | { kind: 'rejected'; status: 403 | 404; message: string }

/** 줄 번호 상한 (그보다 크면 줄 없이 연다) */
const MAX_LINE = 10_000_000

/**
 * 끝의 `:줄`·`:줄:열` 을 뗀다 (순수). `Chat.tsx:422`·`C:\a\b.ts:12:3` → 경로와 줄. 드라이브 콜론(`C:\…`·`C:12`)은 떼지 않는다.
 * 열은 버린다 (Files 탭은 줄만 고른다). 0 이나 너무 큰 줄은 떼기만 하고 line null. Windows 파일 이름에는 `:` 가 들 수 없어 헷갈릴 것이 없다
 */
export function splitLineSuffix(input: string): { path: string; line: number | null } {
  const match = /^((?:[A-Za-z]:)?[^:]+):(\d{1,9})(?::\d{1,9})?$/.exec(input)
  if (!match || /^[A-Za-z]$/.test(match[1])) return { path: input, line: null }
  const line = Number(match[2])
  return { path: match[1], line: line >= 1 && line <= MAX_LINE ? line : null }
}

/** target 이 base 자신이거나 안인지. base·target 이 없으면 false */
function isWithin(base: string | null, target: string | null): boolean {
  return base !== null && target !== null && (relative(base, target) === '' || isInside(base, target))
}

/** base 기준 상대 경로, `/` 구분 (base 자신이면 '') */
function relativeSlash(base: string, target: string): string {
  return relative(base, target).split(sep).join('/')
}

export interface OpenPathFacts {
  /** 요청 경로를 풀어 둔 절대 경로 (realpath 전. cwd 가 없는 상대 경로면 null) */
  requested: string | null
  /** realpath. 없거나 못 풀면 null */
  real: string | null
  isDirectory: boolean
  /** 세션 cwd 의 realpath */
  root: string | null
  /** 세션 scratchpad 의 realpath */
  scratchpad: string | null
  line: number | null
  /** 이 PC(소켓 loopback) 접속 */
  isLocal: boolean
}

/**
 * 어디서 열지 (순수). cwd 를 scratchpad 보다 먼저 본다.
 * 없는 경로는 404 "Path not found" — 단 다른 PC 에서 cwd·scratchpad 밖을 물으면 403 이다 (이 PC 의 아무 경로나 있는지 알려 주지 않는다)
 */
export function decideOpenPath(facts: OpenPathFacts): OpenPathDecision {
  const { requested, real, isDirectory, root, scratchpad, line, isLocal } = facts
  const outsideRejection = { kind: 'rejected', status: 403, message: 'Opens only on this PC' } as const
  if (real === null) {
    const isKnownArea = isWithin(root, requested) || isWithin(scratchpad, requested)
    return !isLocal && !isKnownArea ? outsideRejection : { kind: 'rejected', status: 404, message: 'Path not found' }
  }
  if (root !== null && isWithin(root, real)) {
    return { kind: 'open', body: { target: 'files', path: relativeSlash(root, real), isDirectory, line: isDirectory ? null : line } }
  }
  if (scratchpad !== null && isWithin(scratchpad, real)) {
    return { kind: 'open', body: { target: 'work-files', path: relativeSlash(scratchpad, real), isDirectory } }
  }
  if (!isLocal) return outsideRejection
  return { kind: 'explorer', real, isDirectory }
}

/**
 * 요청 경로(`:줄` 을 뗀 것) → 판정. 꼴은 chatImagePathKind 와 같다 (드라이브 절대·cwd 상대만 — 꼴 검사는 라우트가 먼저 한다).
 * 상대 경로는 cwd(realpath) 기준으로 푼다. junction·링크는 realpath 로 풀어 실제 자리로 판정한다
 */
export async function locateOpenPath(
  path: string,
  line: number | null,
  context: { root: string | null; scratchpad: string | null; isLocal: boolean },
): Promise<OpenPathDecision> {
  const kind = chatImagePathKind(path)
  const requested = kind === 'absolute' ? resolve(path) : kind === 'relative' && context.root !== null ? resolve(context.root, path) : null
  let real: string | null = null
  let isDirectory = false
  if (requested !== null) {
    try {
      real = await realpath(requested)
      isDirectory = (await stat(real)).isDirectory()
    } catch {
      real = null
    }
  }
  return decideOpenPath({ requested, real, isDirectory, line, ...context })
}
