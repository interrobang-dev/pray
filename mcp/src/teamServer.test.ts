import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { TeamApi } from './teamApi.js'
import { createTeamServer, mcpModeOf, type McpMode } from './teamServer.js'

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
    expect(tools.map((tool) => tool.name).sort()).toEqual(['team_assign', 'team_dismiss', 'team_spawn_member', 'team_status', 'team_wait'])
    expect(JSON.stringify(tools)).not.toMatch(/jk_|jk-corp/)
    const assign = tools.find((tool) => tool.name === 'team_assign')!
    expect(assign.description).toContain('team_wait')
    expect(JSON.stringify(assign.inputSchema)).toContain('team_status 또는 team_spawn_member')
  })

  it('옛 모드는 jk_* 도구를 그대로 등록한다', async () => {
    const { serverName, tools } = await listTools(mcpModeOf({ JK_CORP_TEAM_ID: 'T1', JK_CORP_SERVER: 'http://127.0.0.1:1' })!)
    expect(serverName).toBe('jk-corp')
    expect(tools.map((tool) => tool.name).sort()).toEqual(['jk_assign', 'jk_dismiss', 'jk_spawn_member', 'jk_status', 'jk_wait'])
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
})
