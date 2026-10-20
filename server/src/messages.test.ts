import { describe, expect, it } from 'vitest'
import { parseMessages } from './messages.js'

const line = (record: unknown) => JSON.stringify(record)

describe('parseMessages', () => {
  it('builds user/assistant turns, merges assistant blocks by message id, attaches tool results', () => {
    const jsonl = [
      line({ type: 'user', uuid: 'u1', timestamp: 't1', message: { role: 'user', content: '안녕' } }),
      line({
        type: 'assistant',
        uuid: 'a1',
        timestamp: 't2',
        message: { id: 'm1', content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '확인할게요' }] },
      }),
      line({
        type: 'assistant',
        uuid: 'a2',
        timestamp: 't3',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] },
      }),
      line({
        type: 'user',
        uuid: 'u2',
        timestamp: 't4',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt' }] },
      }),
      line({ type: 'user', uuid: 'u3', timestamp: 't5', isMeta: true, message: { role: 'user', content: 'meta' } }),
      line({ type: 'user', uuid: 'u4', timestamp: 't6', isSidechain: true, message: { role: 'user', content: 'side' } }),
      line({ type: 'user', uuid: 'u5', timestamp: 't7', message: { role: 'user', content: '<local-command-caveat>x' } }),
    ].join('\n')

    const messages = parseMessages(jsonl)
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['user', '안녕'],
      ['assistant', '확인할게요'],
      ['system', '<local-command-caveat>x'],
    ])
    expect(messages[1].toolUses).toEqual([{ id: 'tu1', name: 'Bash', input: { command: 'ls' }, result: 'a.txt' }])
  })
})
