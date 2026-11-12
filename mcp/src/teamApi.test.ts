import { describe, expect, it } from 'vitest'
import { TeamApi } from './teamApi.js'

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('TeamApi', () => {
  it('builds team-scoped urls and bodies', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { ok: true })
    const api = new TeamApi('http://x', 'T1', null, fetchImpl)
    await api.assign('S1', '해라')
    await api.wait([], 30)
    await api.wait(['K1'], 5)
    await api.dismiss('S1')
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/team/T1/tasks',
      'http://x/api/team/T1/tasks/any/wait?timeoutSec=30',
      'http://x/api/team/T1/tasks/K1/wait?timeoutSec=5',
      'http://x/api/team/T1/members/S1',
    ])
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ sessionId: 'S1', instruction: '해라' })
    expect(calls[3].init?.method).toBe('DELETE')
  })

  it('part lead sends partId on every call', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { ok: true })
    const api = new TeamApi('http://x', 'T1', 'P1', fetchImpl)
    await api.spawnMember({ role: 'FE' })
    await api.assign('S1', '해라')
    await api.wait([], 30)
    await api.status()
    await api.dismiss('S1')
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/api/team/T1/members?partId=P1',
      'http://x/api/team/T1/tasks?partId=P1',
      'http://x/api/team/T1/tasks/any/wait?timeoutSec=30&partId=P1',
      'http://x/api/team/T1?partId=P1',
      'http://x/api/team/T1/members/S1?partId=P1',
    ])
  })

  it('sends role (or the old name) for a new member and leaves out what is not given', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { ok: true })
    const api = new TeamApi('http://x', 'T1', null, fetchImpl)
    await api.spawnMember({ role: 'FE' }, '해라')
    await api.spawnMember({ name: '조사원 A' })
    expect(calls.map((c) => [c.url, c.init?.method, JSON.parse(c.init?.body as string)])).toEqual([
      ['http://x/api/team/T1/members', 'POST', { role: 'FE', instruction: '해라' }],
      ['http://x/api/team/T1/members', 'POST', { name: '조사원 A' }],
    ])
  })

  it('sends model and effort when given', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { ok: true })
    const api = new TeamApi('http://x', 'T1', 'P1', fetchImpl)
    await api.spawnMember({ role: 'QA', model: 'sonnet', effort: 'max' }, '해라')
    await api.spawnMember({ role: 'Ops', model: 'haiku' })
    await api.spawnMember({ role: 'BE', effort: 'low' })
    expect(calls.map((c) => [c.url, JSON.parse(c.init?.body as string)])).toEqual([
      ['http://x/api/team/T1/members?partId=P1', { role: 'QA', model: 'sonnet', effort: 'max', instruction: '해라' }],
      ['http://x/api/team/T1/members?partId=P1', { role: 'Ops', model: 'haiku' }],
      ['http://x/api/team/T1/members?partId=P1', { role: 'BE', effort: 'low' }],
    ])
  })

  it('waits on several tasks through any + taskIds and passes the abort signal', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { task: null, pendingTaskIds: [] })
    const api = new TeamApi('http://x', 'T1', 'P1', fetchImpl)
    const controller = new AbortController()
    await api.wait(['K1', 'K2'], 1800, controller.signal)
    expect(calls[0].url).toBe('http://x/api/team/T1/tasks/any/wait?timeoutSec=1800&taskIds=K1,K2&partId=P1')
    expect(calls[0].init?.signal).toBe(controller.signal)
  })

  it('reads a wait body that starts with keep-alive spaces', async () => {
    const api = new TeamApi('http://x', 'T1', null, (async () =>
      new Response('   \n {"task":{"id":"K1","status":"done"},"pendingTaskIds":["K2"]}')) as unknown as typeof fetch)
    expect(await api.wait(['K1', 'K2'], 60)).toEqual({ task: { id: 'K1', status: 'done' }, pendingTaskIds: ['K2'] })
  })

  it('throws when the body is cut off or is not JSON', async () => {
    const cut = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('   '))
        controller.error(new Error('terminated'))
      },
    })
    const cutApi = new TeamApi('http://x', 'T1', null, (async () => new Response(cut)) as unknown as typeof fetch)
    await expect(cutApi.wait([], 60)).rejects.toThrow('연결이 끊김')
    const halfApi = new TeamApi('http://x', 'T1', null, (async () => new Response('   {"task":')) as unknown as typeof fetch)
    await expect(halfApi.wait([], 60)).rejects.toThrow('해석하지 못함')
  })

  it('posts a reminder to the team (with partId for a part lead)', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { reminder: { id: 'r1' } })
    await new TeamApi('http://x', 'T1', null, fetchImpl).remind('배포 확인', '2026-11-12T15:30')
    await new TeamApi('http://x', 'T1', 'P1', fetchImpl).remind('배포 확인', '2026-11-12T06:30:00.000Z')
    expect(calls.map((c) => [c.url, c.init?.method, JSON.parse(c.init?.body as string)])).toEqual([
      ['http://x/api/team/T1/reminders', 'POST', { text: '배포 확인', at: '2026-11-12T15:30' }],
      ['http://x/api/team/T1/reminders?partId=P1', 'POST', { text: '배포 확인', at: '2026-11-12T06:30:00.000Z' }],
    ])
  })

  it('throws the server message on error status', async () => {
    const { fetchImpl } = fakeFetch(409, { message: '진행 중인 task 가 있음' })
    const api = new TeamApi('http://x', 'T1', null, fetchImpl)
    await expect(api.assign('S1', 'x')).rejects.toThrow('진행 중인 task 가 있음')
  })

  it('wraps connection failures', async () => {
    const api = new TeamApi('http://x', 'T1', null, (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch)
    await expect(api.status()).rejects.toThrow('연결 실패')
  })
})
