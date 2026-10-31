import { describe, expect, it } from 'vitest'
import { leadExtraArgs, leadMcpConfig, leadSystemPrompt } from './lead.js'

const team = { id: 'abc12345', name: '개발', cwd: 'D:/x', groupId: 'lobby', x: 1, y: 1, desks: {}, parts: [], partOf: {}, todos: [], leadSessionId: 'lead', createdAt: '2026-10-20T00:00:00Z' }

describe('lead', () => {
  it('prompt names the team and tells the lead how results come back', () => {
    const prompt = leadSystemPrompt(team)
    expect(prompt).toContain('"개발" 팀 팀장')
    expect(prompt).toContain('abc12345')
    expect(prompt).toContain('마지막 메시지')
    expect(prompt).toContain('팀원 배치·재사용·정리 규칙')
  })

  it('prompt keeps members per role and dismisses them on context size or long idle', () => {
    const prompt = leadSystemPrompt(team)
    expect(prompt).toContain('contextTokens 가 15만을 넘었다')
    expect(prompt).toContain('60분 넘게 쉬었다')
    expect(prompt).toContain('같은 영역의 일이면 있는 팀원에게 team_assign')
    expect(prompt).toContain('알게 된 것·고친 파일·남은 일')
    expect(prompt).not.toContain('30분')
    expect(prompt).not.toContain('5개쯤')
  })

  it('prompt uses the Pray office and team_* tool names only', () => {
    const part = { id: 'p1', name: 'api', createdAt: '' }
    for (const prompt of [leadSystemPrompt(team), leadSystemPrompt(team, part)]) {
      expect(prompt).toContain('Pray 사무실')
      expect(prompt).toContain('team_wait')
      expect(prompt).not.toMatch(/jk_|jk-corp/)
    }
  })

  it('prompt tells the lead when to pick a model and effort for a member', () => {
    const prompt = leadSystemPrompt(team)
    expect(prompt).toContain('team_spawn_member 의 model·effort')
    expect(prompt).toContain('애매하면 늘 둘 다 빼서')
    for (const word of ['- opus:', '- sonnet:', '- haiku:', '- fable:', 'max 는', 'low·medium 은']) expect(prompt).toContain(word)
  })

  it('extra args carry name, permission mode and the prompt', () => {
    const args = leadExtraArgs(team, null, 'http://127.0.0.1:4710')
    expect(args.slice(0, 4)).toEqual(['--name', '개발 팀장', '--permission-mode', 'bypassPermissions'])
    expect(args[4]).toBe('--append-system-prompt')
    expect(args[5]).toBe(leadSystemPrompt(team))
    expect(args[6]).toBe('--mcp-config')
    expect(leadExtraArgs(team, null, 'http://x', 'acceptEdits')[3]).toBe('acceptEdits')
  })

  it('mcp config runs mcp/src/index.ts with tsx loader and team env', () => {
    const config = JSON.parse(leadMcpConfig(team, null, 'http://127.0.0.1:4710', 'C:/node.exe'))
    const server = config.mcpServers.pray
    expect(server.command).toBe('C:/node.exe')
    expect(server.args[0]).toBe('--import')
    expect(server.args[1]).toMatch(/^file:\/\/\/.*tsx\/dist\/loader\.mjs$/)
    expect(server.args[2].replace(/\\/g, '/')).toMatch(/\/mcp\/src\/index\.ts$/)
    expect(server.env).toEqual({ PRAY_TEAM_ID: 'abc12345', PRAY_SERVER: 'http://127.0.0.1:4710' })
  })

  it('part lead gets its own name, prompt and part env', () => {
    const part = { id: 'p1', name: 'api', worktree: { cwd: 'D:/x.worktrees/api', branch: 'part/api' }, createdAt: '' }
    const args = leadExtraArgs(team, part, 'http://x')
    expect(args[1]).toBe('api 파트장')
    expect(args[5]).toContain('"api" 파트 파트장')
    expect(args[5]).toContain('part/api')
    expect(JSON.parse(args[7]).mcpServers.pray.env).toEqual({ PRAY_TEAM_ID: 'abc12345', PRAY_PART_ID: 'p1', PRAY_SERVER: 'http://x' })
  })
})
