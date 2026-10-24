import { describe, expect, it } from 'vitest'
import { TeamApi } from './teamApi.js'

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return { ok: status < 400, status, json: async () => body } as Response
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

describe('TeamApi', () => {
  it('builds team-scoped urls and bodies', async () => {
    const { calls, fetchImpl } = fakeFetch(200, { ok: true })
    const api = new TeamApi('http://x', 'T1', null, fetchImpl)
    await api.assign('S1', '해라')
    await api.wait(null, 30)
    await api.wait('K1', 5)
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
    await api.wait(null, 30)
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
