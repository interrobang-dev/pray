import { describe, expect, it } from 'vitest'
import { runningToolNames } from './runningTools'
import type { ChatMessage, ToolUse } from './types'

let nextId = 0
const tool = (name: string, result: string | null = null): ToolUse => ({ id: `t${nextId++}`, name, input: {}, result })
const message = (role: ChatMessage['role'], toolUses: ToolUse[] = [], patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${nextId++}`,
  role,
  timestamp: '2026-10-24T10:00:00.000Z',
  text: '',
  toolUses,
  ...patch,
})

describe('runningToolNames', () => {
  it('이번 차례에서 결과가 없는 도구만', () => {
    const messages = [message('user'), message('assistant', [tool('Read', '내용'), tool('Bash')])]
    expect(runningToolNames(messages)).toEqual(['Bash'])
  })

  it('결과가 다 있으면 빈 배열', () => {
    expect(runningToolNames([message('user'), message('assistant', [tool('Read', '내용'), tool('Bash', '')])])).toEqual([])
    expect(runningToolNames([])).toEqual([])
  })

  it('이전 차례의 결과 없는 도구는 세지 않는다', () => {
    const messages = [message('user'), message('assistant', [tool('Bash')]), message('user'), message('assistant', [tool('Read', '내용')])]
    expect(runningToolNames(messages)).toEqual([])
  })

  it('대기 중 메시지는 차례 시작으로 치지 않는다', () => {
    const messages = [message('user'), message('assistant', [tool('Bash')]), message('user', [], { isQueued: true })]
    expect(runningToolNames(messages)).toEqual(['Bash'])
  })

  it('system 메시지(백그라운드 알림 등)는 지나간다', () => {
    const messages = [message('user'), message('assistant', [tool('Bash')]), message('system')]
    expect(runningToolNames(messages)).toEqual(['Bash'])
  })

  it('MCP 도구는 <서버>/<도구>', () => {
    const messages = [message('user'), message('assistant', [tool('mcp__pray__team_wait'), tool('mcp__claude_ai_Claude_Docs__batch')])]
    expect(runningToolNames(messages)).toEqual(['pray/team_wait', 'claude_ai_Claude_Docs/batch'])
  })

  it('여러 개면 처음 나온 순서로, 같은 이름은 한 번만', () => {
    const messages = [
      message('user'),
      message('assistant', [tool('Read'), tool('Grep')]),
      message('assistant', [tool('Read'), tool('Bash', '끝'), tool('Grep')]),
    ]
    expect(runningToolNames(messages)).toEqual(['Read', 'Grep'])
  })
})
