import { describe, expect, it } from 'vitest'
import { attachInstructions, parseInstructionLog, parseMessages, type ChatMessage, type InstructionRecord } from './messages.js'

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

  it('keeps long jk-corp tool results whole and cuts other long results at 2000 chars', () => {
    const longText = 'x'.repeat(5000)
    const jsonl = [
      line({
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'm1',
          content: [
            { type: 'tool_use', id: 'jk', name: 'mcp__jk-corp__jk_wait', input: {} },
            { type: 'tool_use', id: 'bash', name: 'Bash', input: {} },
          ],
        },
      }),
      line({
        type: 'user',
        uuid: 'u1',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'jk', content: [{ type: 'text', text: longText }] },
            { type: 'tool_result', tool_use_id: 'bash', content: longText },
          ],
        },
      }),
    ].join('\n')

    const [message] = parseMessages(jsonl)
    expect(message.toolUses.map((t) => t.result?.length)).toEqual([5000, 2000])
  })
})

describe('parseInstructionLog', () => {
  it('keeps only well-formed records of the session and skips broken lines', () => {
    const log = [
      line({ sessionId: 's1', fromSessionId: 'lead', text: '지시 A', at: 't1' }),
      '{깨진 줄',
      'null',
      line({ sessionId: 's2', fromSessionId: 'lead', text: '다른 팀원', at: 't2' }),
      line({ sessionId: 's1', fromSessionId: null, at: 't3' }),
      line({ sessionId: 's1', fromSessionId: null, text: '지시자 없음', at: 't4' }),
      '',
    ].join('\n')

    expect(parseInstructionLog(log, 's1')).toEqual([
      { sessionId: 's1', fromSessionId: 'lead', text: '지시 A', at: 't1' },
      { sessionId: 's1', fromSessionId: null, text: '지시자 없음', at: 't4' },
    ])
  })
})

describe('attachInstructions', () => {
  const message = (id: string, role: ChatMessage['role'], text: string): ChatMessage => ({
    id,
    role,
    timestamp: '',
    text,
    toolUses: [],
  })
  const record = (text: string, fromSessionId: string | null = 'lead-1'): InstructionRecord => ({
    sessionId: 'member',
    fromSessionId,
    text,
    at: '',
  })
  const nameOf = (sessionId: string | null) => (sessionId ? `이름:${sessionId}` : '지시자 없음')

  it('matches the stored paste form (tags, 4096-byte chunk breaks inside a word) and restores the sent text', () => {
    const sent = '배경: 첫 문단.\n\n금지: 설정 파일은 열거나 출력하지 마라.'
    // Claude Code 가 jsonl 에 남기는 꼴: 붙여넣기 조각을 태그로 감싸고 조각 경계("열거|나")에 줄바꿈을 넣는다
    const stored = '\n\n<pasted_content id="d70d">\n배경: 첫 문단.\n\n금지: 설정 파일은 열거\n</pasted_content id="d70d">\n\n나 출력하지 마라.'
    const [attached] = attachInstructions([message('u1', 'user', stored)], [record(sent)], nameOf)

    expect(attached.text).toBe(sent)
    expect(attached.from).toEqual({ sessionId: 'lead-1', name: '이름:lead-1' })
  })

  it('ignores CRLF and surrounding whitespace differences', () => {
    const [attached] = attachInstructions([message('u1', 'user', '  첫 줄\n둘째 줄\n')], [record('첫 줄\r\n둘째 줄')], nameOf)
    expect(attached.from?.name).toBe('이름:lead-1')
  })

  it('leaves human and assistant messages alone and uses each record once', () => {
    const messages = [
      message('u1', 'user', '사람이 쓴 말'),
      message('a1', 'assistant', '같은 지시'),
      message('u2', 'user', '같은 지시'),
      message('u3', 'user', '같은 지시'),
    ]
    const attached = attachInstructions(messages, [record('같은 지시', null)], nameOf)

    expect(attached.map((m) => m.from ?? null)).toEqual([null, null, { sessionId: null, name: '지시자 없음' }, null])
    expect(attached[0]).toBe(messages[0])
  })
})
