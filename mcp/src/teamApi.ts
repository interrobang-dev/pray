/** 서버 /api/team/* 호출. 파트장이면 모든 호출에 partId 쿼리를 붙여 지휘 단위를 정한다. fetch 를 주입할 수 있어 테스트에서 서버 없이 쓴다 */
export class TeamApi {
  constructor(
    private readonly baseUrl: string,
    private readonly teamId: string,
    private readonly partId: string | null = null,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private unitQuery(separator: '?' | '&'): string {
    return this.partId ? `${separator}partId=${encodeURIComponent(this.partId)}` : ''
  }

  private async call(path: string, init?: RequestInit): Promise<unknown> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      })
    } catch (error) {
      throw new Error(`Pray 서버(${this.baseUrl})에 연결 실패: ${(error as Error).message}`)
    }
    let raw: string
    try {
      raw = await response.text()
    } catch (error) {
      // wait 는 헤더를 먼저 받고 본문을 오래 기다리므로 서버 재시작 등으로 그 사이에 끊길 수 있다
      throw new Error(`Pray 서버 응답을 받는 중 연결이 끊김: ${(error as Error).message}`)
    }
    const body = parseBody(raw)
    if (!response.ok) throw new Error((body as { message?: string } | null)?.message ?? `HTTP ${response.status}`)
    if (body === null) throw new Error(`Pray 서버 응답을 해석하지 못함: ${raw.trim().slice(0, 200)}`)
    return body
  }

  /** role 이 있으면 서버가 역할(position)로 저장하고 이름을 붙이며 name 은 쓰지 않는다. 둘 다 없으면 서버가 400. model·effort 를 빼면 사용자 기본값 */
  spawnMember(member: { role?: string; name?: string; model?: string; effort?: string }, instruction?: string): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/members${this.unitQuery('?')}`, {
      method: 'POST',
      body: JSON.stringify({ role: member.role, name: member.name, model: member.model, effort: member.effort, instruction }),
    })
  }

  assign(sessionId: string, instruction: string): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/tasks${this.unitQuery('?')}`, { method: 'POST', body: JSON.stringify({ sessionId, instruction }) })
  }

  /**
   * taskIds 가 비면 지휘 단위의 아무 task, 하나면 그 task, 여럿이면 그중 먼저 끝나는 것. 서버는 헤더를 바로 보내고 끝날 때까지
   * 공백을 흘려서 fetch(undici)의 headersTimeout·bodyTimeout(300초)에 걸리지 않는다. signal 이 abort 되면 연결을 끊어 서버도 기다림을 접는다
   */
  wait(taskIds: readonly string[], timeoutSec: number, signal?: AbortSignal): Promise<unknown> {
    const pathTaskId = taskIds.length === 1 ? encodeURIComponent(taskIds[0]) : 'any'
    const listQuery = taskIds.length > 1 ? `&taskIds=${taskIds.map(encodeURIComponent).join(',')}` : ''
    return this.call(`/api/team/${this.teamId}/tasks/${pathTaskId}/wait?timeoutSec=${timeoutSec}${listQuery}${this.unitQuery('&')}`, { signal })
  }

  status(): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}${this.unitQuery('?')}`)
  }

  dismiss(sessionId: string): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/members/${sessionId}${this.unitQuery('?')}`, { method: 'DELETE' })
  }
}

/** 응답 본문 해석. 앞뒤 공백(wait 가 기다리는 동안 흘린 것)은 무시하고, 비면 {}, JSON 이 아니면 null */
function parseBody(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}
