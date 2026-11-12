import { copyText } from './copyText'
import { alertDialog } from './Dialog'

/**
 * 대화 속 경로 열기 (ChatPath.tsx 가 부른다). 서버 `POST /api/sessions/:id/open-path` 가 어디서 열지 정하고
 * (세션 cwd 안 → Files 탭, scratchpad 안 → 작업 파일 창, 그 밖 → 이 PC 의 탐색기), 화면은 그 답대로 연다
 */

/** Files 탭에 열 것 (cwd 기준 상대 경로 `/` 구분, '' 은 cwd 자신) */
export interface FilesOpenRequest {
  path: string
  line: number | null
  isDirectory: boolean
}

/** 작업 파일 창에 열 것 (scratchpad 기준 상대 경로, '' 은 scratchpad 자신) */
export interface WorkFilesOpenRequest {
  path: string
  isDirectory: boolean
}

export type OpenPathAction =
  | { kind: 'files'; request: FilesOpenRequest }
  | { kind: 'work-files'; request: WorkFilesOpenRequest }
  /** 서버가 탐색기를 띄웠다 */
  | { kind: 'none' }
  /** 다른 PC 에서 cwd·scratchpad 밖: 경로를 복사한다 */
  | { kind: 'copy' }
  | { kind: 'alert'; message: string }

/** 서버 403 문구 중 "다른 PC 라 못 연다" (그 밖의 403 — Origin 거절 등 — 은 알림) */
const OTHER_PC_MESSAGE = 'Opens only on this PC'

/** 응답 → 화면이 할 일 (순수) */
export function openPathAction(status: number, body: unknown): OpenPathAction {
  const value = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (status >= 200 && status < 300) {
    const isDirectory = value.isDirectory === true
    if (value.target === 'files' && typeof value.path === 'string') {
      const line = typeof value.line === 'number' && Number.isInteger(value.line) && value.line >= 1 && !isDirectory ? value.line : null
      return { kind: 'files', request: { path: value.path, line, isDirectory } }
    }
    if (value.target === 'work-files' && typeof value.path === 'string') return { kind: 'work-files', request: { path: value.path, isDirectory } }
    if (value.target === 'explorer') return { kind: 'none' }
    return { kind: 'alert', message: "Couldn't open: Unexpected response" }
  }
  const message = typeof value.message === 'string' ? value.message : `HTTP ${status}`
  if (status === 403 && message === OTHER_PC_MESSAGE) return { kind: 'copy' }
  return { kind: 'alert', message: `Couldn't open: ${message}` }
}

/** 경로 하나를 연다. Files 탭·작업 파일 창은 부른 쪽이 연다 (handlers) */
export async function openChatPath(
  sessionId: string,
  path: string,
  handlers: { onFiles: (request: FilesOpenRequest) => void; onWorkFiles: (request: WorkFilesOpenRequest) => void },
): Promise<void> {
  let action: OpenPathAction
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/open-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    action = openPathAction(response.status, await response.json().catch(() => null))
  } catch {
    action = { kind: 'alert', message: "Couldn't open: Network error" }
  }
  if (action.kind === 'files') handlers.onFiles(action.request)
  else if (action.kind === 'work-files') handlers.onWorkFiles(action.request)
  else if (action.kind === 'alert') void alertDialog(action.message)
  else if (action.kind === 'copy') {
    const isCopied = await copyText(path)
    void alertDialog(isCopied ? `Opens only on this PC. Path copied:\n${path}` : `Opens only on this PC. Couldn't copy the path:\n${path}`)
  }
}
