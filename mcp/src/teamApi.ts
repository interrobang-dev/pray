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
      throw new Error(`jk-corp 서버(${this.baseUrl})에 연결 실패: ${(error as Error).message}`)
    }
    const body = (await response.json().catch(() => ({}))) as { message?: string }
    if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
    return body
  }

  spawnMember(name: string, instruction?: string): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/members${this.unitQuery('?')}`, { method: 'POST', body: JSON.stringify({ name, instruction }) })
  }

  assign(sessionId: string, instruction: string): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/tasks${this.unitQuery('?')}`, { method: 'POST', body: JSON.stringify({ sessionId, instruction }) })
  }

  wait(taskId: string | null, timeoutSec: number): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/tasks/${taskId ?? 'any'}/wait?timeoutSec=${timeoutSec}${this.unitQuery('&')}`)
  }

  status(): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}${this.unitQuery('?')}`)
  }

  dismiss(sessionId: string): Promise<unknown> {
    return this.call(`/api/team/${this.teamId}/members/${sessionId}${this.unitQuery('?')}`, { method: 'DELETE' })
  }
}
