import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { TeamApi } from './teamApi.js'
import { createTeamServer, localTimeText, mcpModeOf, reminderAtOf, type McpMode } from './teamServer.js'

/** 모드로 띄운 서버에 클라이언트를 붙여 tools/list 를 받는다 */
async function listTools(mode: McpMode) {
  const server = createTeamServer(mode, new TeamApi(mode.baseUrl, mode.teamId, mode.partId))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  const serverName = client.getServerVersion()?.name
  await client.close()
  return { serverName, tools }
}

describe('mcpModeOf', () => {
  it('PRAY_* env 면 새 모드', () => {
    expect(mcpModeOf({ PRAY_TEAM_ID: 'T1', PRAY_PART_ID: 'P1', PRAY_SERVER: 'http://x' })).toMatchObject({
      serverName: 'pray',
      teamId: 'T1',
      partId: 'P1',
      baseUrl: 'http://x',
      tools: { spawn: 'team_spawn_member', wait: 'team_wait' },
    })
  })

  it('JK_CORP_* env 만 있으면 옛 모드 (옛 리드의 --mcp-config)', () => {
    expect(mcpModeOf({ JK_CORP_TEAM_ID: 'T1', JK_CORP_PART_ID: 'P1', JK_CORP_SERVER: 'http://old' })).toMatchObject({
      serverName: 'jk-corp',
      teamId: 'T1',
      partId: 'P1',
      baseUrl: 'http://old',
      tools: { spawn: 'jk_spawn_member', wait: 'jk_wait' },
    })
  })

  it('접두사를 섞어 읽지 않고, 파트·서버 주소가 없으면 팀 직속·기본 주소', () => {
    const mode = mcpModeOf({ PRAY_TEAM_ID: 'T1', JK_CORP_TEAM_ID: 'T0', JK_CORP_PART_ID: 'P0', JK_CORP_SERVER: 'http://old' })
    expect(mode).toMatchObject({ serverName: 'pray', teamId: 'T1', partId: null, baseUrl: 'http://127.0.0.1:4710' })
    expect(mcpModeOf({ JK_CORP_TEAM_ID: 'T0', PRAY_PART_ID: 'P1' })?.partId).toBeNull()
  })

  it('팀 ID 가 없으면 null', () => {
    expect(mcpModeOf({})).toBeNull()
    expect(mcpModeOf({ PRAY_TEAM_ID: '', PRAY_SERVER: 'http://x' })).toBeNull()
  })
})

describe('createTeamServer', () => {
  it('새 모드는 team_* 도구를 등록하고 설명에도 옛 이름이 없다', async () => {
    const { serverName, tools } = await listTools(mcpModeOf({ PRAY_TEAM_ID: 'T1', PRAY_SERVER: 'http://127.0.0.1:1' })!)
    expect(serverName).toBe('pray')
    expect(tools.map((tool) => tool.name).sort()).toEqual(['team_assign', 'team_dismiss', 'team_remind', 'team_spawn_member', 'team_status', 'team_wait'])
    expect(JSON.stringify(tools)).not.toMatch(/jk_|jk-corp/)
    const assign = tools.find((tool) => tool.name === 'team_assign')!
    expect(assign.description).toContain('team_wait')
    expect(JSON.stringify(assign.inputSchema)).toContain('team_status 또는 team_spawn_member')
  })

  it('옛 모드는 jk_* 도구를 그대로 등록한다', async () => {
    const { serverName, tools } = await listTools(mcpModeOf({ JK_CORP_TEAM_ID: 'T1', JK_CORP_SERVER: 'http://127.0.0.1:1' })!)
    expect(serverName).toBe('jk-corp')
    expect(tools.map((tool) => tool.name).sort()).toEqual(['jk_assign', 'jk_dismiss', 'jk_remind', 'jk_spawn_member', 'jk_status', 'jk_wait'])
    expect(JSON.stringify(tools)).not.toContain('team_')
    expect(tools.find((tool) => tool.name === 'jk_assign')!.description).toContain('jk_wait')
    expect(tools.find((tool) => tool.name === 'jk_status')!.description).toContain('jk_wait 를 그 taskId 로')
  })

  it('team_status 설명은 줄인 규칙과 전문 받는 법을 적는다', async () => {
    const { tools } = await listTools(mcpModeOf({ PRAY_TEAM_ID: 'T1', PRAY_SERVER: 'http://127.0.0.1:1' })!)
    const status = tools.find((tool) => tool.name === 'team_status')!.description
    expect(status).toContain('최근 5개')
    expect(status).toContain('inactiveMembers')
    expect(status).toContain('앞 200자')
    expect(status).toContain('team_wait 를 그 taskId 로')
  })

  it('team_remind 설명은 사람에게만 가고 리드를 깨우지 않는다고 적는다', async () => {
    const { tools } = await listTools(mcpModeOf({ PRAY_TEAM_ID: 'T1', PRAY_SERVER: 'http://127.0.0.1:1' })!)
    const remind = tools.find((tool) => tool.name === 'team_remind')!
    expect(remind.description).toContain('너를 깨우지 않는다')
    expect(remind.description).toContain('date')
    expect(Object.keys((remind.inputSchema as { properties: object }).properties).sort()).toEqual(['at', 'inMinutes', 'text'])
  })
})

describe('reminderAtOf', () => {
  const now = new Date('2026-11-12T06:00:00.000Z')

  it('inMinutes 는 지금부터 그 분 뒤 UTC ISO', () => {
    expect(reminderAtOf(undefined, 30, now)).toEqual({ at: '2026-11-12T06:30:00.000Z' })
    expect(reminderAtOf(undefined, 1.5, now)).toEqual({ at: '2026-11-12T06:01:30.000Z' })
  })

  it('at 은 다듬어 그대로 넘긴다 (검증은 서버)', () => {
    expect(reminderAtOf(' 2026-11-12T15:30 ', undefined, now)).toEqual({ at: '2026-11-12T15:30' })
  })

  it('둘 다 주거나 둘 다 빼면 실패', () => {
    expect(reminderAtOf('2026-11-12T15:30', 30, now)).toHaveProperty('error')
    expect(reminderAtOf(undefined, undefined, now)).toHaveProperty('error')
    expect(reminderAtOf('  ', undefined, now)).toHaveProperty('error')
    expect(reminderAtOf(undefined, 0, now)).toHaveProperty('error')
  })
})

describe('team_remind 호출', () => {
  async function callRemind(args: Record<string, unknown>, partId: string | null = null) {
    const calls: { url: string; body: unknown }[] = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { text: string; at: string }
      calls.push({ url, body })
      const at = new Date(body.at).toISOString()
      return new Response(JSON.stringify({ reminder: { id: 'r1', text: body.text, at } }))
    }) as unknown as typeof fetch
    const mode = mcpModeOf({ PRAY_TEAM_ID: 'T1', PRAY_PART_ID: partId ?? undefined, PRAY_SERVER: 'http://x' })!
    const server = createTeamServer(mode, new TeamApi(mode.baseUrl, mode.teamId, mode.partId, fetchImpl))
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test', version: '0' })
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
    const result = (await client.callTool({ name: 'team_remind', arguments: args })) as { isError?: boolean; content: { text: string }[] }
    await client.close()
    return { calls, result }
  }

  it('inMinutes 를 ISO 로 바꿔 보내고 울릴 시각·지금 시각을 이 PC 시각으로 붙인다', async () => {
    const before = Date.now()
    const { calls, result } = await callRemind({ text: '배포 확인', inMinutes: 30 }, 'P1')
    expect(calls[0].url).toBe('http://x/api/team/T1/reminders?partId=P1')
    const sentAt = Date.parse((calls[0].body as { at: string }).at)
    expect(sentAt - before).toBeGreaterThanOrEqual(30 * 60_000)
    expect(sentAt - before).toBeLessThan(30 * 60_000 + 5_000)
    expect(result.isError).toBeFalsy()
    const body = JSON.parse(result.content[0].text) as { reminder: { id: string }; firesAt: string; now: string }
    expect(body.reminder.id).toBe('r1')
    expect(body.firesAt).toBe(localTimeText(new Date(sentAt)))
    expect(body.now).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$/)
  })

  it('at·inMinutes 를 둘 다 주면 서버를 부르지 않고 실패 결과', async () => {
    const { calls, result } = await callRemind({ text: '배포 확인', at: '2026-11-12T15:30', inMinutes: 30 })
    expect(calls).toEqual([])
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('정확히 하나')
  })
})

describe('localTimeText', () => {
  it('이 PC 시각과 오프셋', () => {
    const date = new Date(2026, 10, 12, 15, 30)
    expect(localTimeText(date)).toMatch(/^2026-11-12 15:30 \(UTC[+-]\d{2}:\d{2}\)$/)
  })
})
