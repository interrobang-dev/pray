/** Files 탭 API 부르기 (FilesTab·SearchPanel 이 같이 쓴다) */

export const apiUrl = (sessionId: string, route: string, params: Record<string, string>) => `/api/sessions/${sessionId}/${route}?${new URLSearchParams(params)}`

/** JSON 받기. 실패는 서버 message → HTTP 코드 → "Network error" 를 담은 Error */
export async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', signal })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new Error('Network error')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null
    throw new Error(typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}
