import { describe, expect, it } from 'vitest'
import { leadExtraArgs, leadSystemPrompt } from './lead.js'

const team = { id: 'abc12345', name: '개발', cwd: 'D:/x', leadSessionId: 'lead', createdAt: '2026-10-20T00:00:00Z', members: [] }

describe('lead', () => {
  it('prompt names the team and tells the lead how results come back', () => {
    const prompt = leadSystemPrompt(team)
    expect(prompt).toContain('"개발" 팀 팀장')
    expect(prompt).toContain('abc12345')
    expect(prompt).toContain('마지막 메시지')
  })

  it('extra args carry name, permission mode and the prompt', () => {
    const args = leadExtraArgs(team)
    expect(args.slice(0, 4)).toEqual(['--name', '개발 팀장', '--permission-mode', 'bypassPermissions'])
    expect(args[4]).toBe('--append-system-prompt')
    expect(args[5]).toBe(leadSystemPrompt(team))
    expect(leadExtraArgs(team, 'acceptEdits')[3]).toBe('acceptEdits')
  })
})
