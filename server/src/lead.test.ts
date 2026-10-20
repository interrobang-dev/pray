import { describe, expect, it } from 'vitest'
import { leadExtraArgs, leadMcpConfig, leadSystemPrompt } from './lead.js'

const team = { id: 'abc12345', name: '개발', cwd: 'D:/x', groupId: 'lobby', x: 1, y: 1, desks: {}, leadSessionId: 'lead', createdAt: '2026-10-20T00:00:00Z' }

describe('lead', () => {
  it('prompt names the team and tells the lead how results come back', () => {
    const prompt = leadSystemPrompt(team)
    expect(prompt).toContain('"개발" 팀 팀장')
    expect(prompt).toContain('abc12345')
    expect(prompt).toContain('마지막 메시지')
  })

  it('extra args carry name, permission mode and the prompt', () => {
    const args = leadExtraArgs(team, 'http://127.0.0.1:4710')
    expect(args.slice(0, 4)).toEqual(['--name', '개발 팀장', '--permission-mode', 'bypassPermissions'])
    expect(args[4]).toBe('--append-system-prompt')
    expect(args[5]).toBe(leadSystemPrompt(team))
    expect(args[6]).toBe('--mcp-config')
    expect(leadExtraArgs(team, 'http://x', 'acceptEdits')[3]).toBe('acceptEdits')
  })

  it('mcp config runs mcp/src/index.ts with tsx loader and team env', () => {
    const config = JSON.parse(leadMcpConfig(team, 'http://127.0.0.1:4710', 'C:/node.exe'))
    const server = config.mcpServers['jk-corp']
    expect(server.command).toBe('C:/node.exe')
    expect(server.args[0]).toBe('--import')
    expect(server.args[1]).toMatch(/^file:\/\/\/.*tsx\/dist\/loader\.mjs$/)
    expect(server.args[2].replace(/\\/g, '/')).toMatch(/\/mcp\/src\/index\.ts$/)
    expect(server.env).toEqual({ JK_CORP_TEAM_ID: 'abc12345', JK_CORP_SERVER: 'http://127.0.0.1:4710' })
  })
})
