import type { Response } from 'express'

/**
 * jk_wait 롱폴링 (GET /api/team/:teamId/tasks/:taskId/wait). 기다리는 동안 응답 헤더를 먼저 보내고 공백을 흘려
 * MCP 쪽 fetch(undici)의 headersTimeout·bodyTimeout(각 300초)에 걸리지 않게 한다.
 */

/** timeoutSec 를 안 주거나 숫자가 아닐 때 */
export const DEFAULT_WAIT_SECONDS = 1800
/** 이보다 길게 주면 이 값으로 줄인다. mcp jk_wait 의 최대와 같다 */
export const MAX_WAIT_SECONDS = 3600
/** 기다리는 동안 공백 한 글자를 흘리는 간격. undici bodyTimeout(데이터 사이 300초)보다 충분히 짧게 */
export const WAIT_HEARTBEAT_MS = 30_000

export interface WaitRequest {
  /** 기다릴 task. null 이면 지휘 단위의 아무 task */
  taskIds: string[] | null
  timeoutSec: number
}

/** 경로의 taskId('any' = 지정 없음)와 `?taskIds=a,b`(여러 번 줘도 된다)를 합친다. 둘 다 없으면 taskIds null */
export function parseWaitRequest(pathTaskId: string, query: { taskIds?: unknown; timeoutSec?: unknown }): WaitRequest {
  const listed = [query.taskIds].flat().filter((value): value is string => typeof value === 'string')
  const ids = [pathTaskId === 'any' ? '' : pathTaskId, ...listed.flatMap((value) => value.split(','))]
    .map((id) => id.trim())
    .filter((id) => id !== '')
  const requested = Number(query.timeoutSec ?? DEFAULT_WAIT_SECONDS)
  const timeoutSec = Number.isFinite(requested) ? Math.min(MAX_WAIT_SECONDS, Math.max(1, requested)) : DEFAULT_WAIT_SECONDS
  return { taskIds: ids.length > 0 ? [...new Set(ids)] : null, timeoutSec }
}

/**
 * 오래 걸리는 JSON 응답. 헤더(200, application/json)를 바로 보내고, work 가 끝날 때까지 heartbeatMs 마다 공백 한 글자를
 * 흘린 뒤 JSON 을 써서 끝낸다 (JSON 앞 공백은 JSON.parse 가 허용한다). `Cache-Control: no-transform` 으로 compression 을
 * 끈다 — 압축하면 흘린 공백이 압축 버퍼에 쌓여 나가지 않는다. 클라이언트가 먼저 끊으면 work 의 signal 이 abort 된다.
 * 헤더를 먼저 보내므로 상태 코드는 늘 200 이다 — 거절(404 등)은 이 함수를 부르기 전에 한다
 */
export async function respondJsonAfter(
  res: Response,
  work: (signal: AbortSignal) => Promise<unknown>,
  heartbeatMs = WAIT_HEARTBEAT_MS,
): Promise<void> {
  const controller = new AbortController()
  const heartbeat = setInterval(() => res.write(' '), heartbeatMs)
  res.on('close', () => {
    clearInterval(heartbeat)
    controller.abort()
  })
  res.status(200).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' })
  res.flushHeaders()
  try {
    const body = await work(controller.signal)
    if (!controller.signal.aborted) res.end(JSON.stringify(body))
  } finally {
    clearInterval(heartbeat)
  }
}
