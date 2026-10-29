import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TeamApi } from './teamApi.js'
import { createTeamServer, mcpModeOf } from './teamServer.js'

/**
 * 팀장·파트장 claude 세션에 붙는 stdio MCP 서버. 서버의 /api/team/* 를 호출하는 얇은 어댑터.
 * 지시자는 --mcp-config 로 이 프로세스를 띄우고, env 로 팀 ID·서버 주소(파트장은 파트 ID 도)를 받는다 (새 리드 PRAY_*, 옛 리드 JK_CORP_* — mcpModeOf).
 * 도구가 보는 "팀" 은 자기 지휘 단위(팀장 = 팀 직속, 파트장 = 그 파트)다.
 */
const mode = mcpModeOf(process.env)
if (!mode) {
  console.error('PRAY_TEAM_ID 환경변수 필요')
  process.exit(1)
}

const server = createTeamServer(mode, new TeamApi(mode.baseUrl, mode.teamId, mode.partId))
await server.connect(new StdioServerTransport())
