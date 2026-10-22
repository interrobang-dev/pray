import { describe, expect, it } from 'vitest'
import { decideInterrupt, isAwaitingFirstResponse, isInterruptText, judgeInterrupt } from './interrupt.js'

const line = (record: Record<string, unknown>) => JSON.stringify(record)
const prompt = (text: string) => line({ type: 'user', message: { role: 'user', content: text } })
const toolUse = line({ type: 'assistant', message: { id: 'm1', role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } })
const rejected = line({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: "The user doesn't want to proceed with this tool use." }] },
  toolUseResult: 'User rejected tool use',
})
const interruptLine = (text: string) =>
  line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, interruptedMessageId: 'msg_1' })
const queueOp = (operation: string, content?: string) => line({ type: 'queue-operation', operation, ...(content === undefined ? {} : { content }) })
const join = (...lines: string[]) => `${lines.join('\n')}\n`

describe('isInterruptText', () => {
  it('matches both interrupt lines Claude Code writes', () => {
    expect(isInterruptText('[Request interrupted by user]')).toBe(true)
    expect(isInterruptText('[Request interrupted by user for tool use]')).toBe(true)
    expect(isInterruptText('[Request interrupted by user]\n')).toBe(true)
  })

  it('does not match a person quoting it inside other text', () => {
    expect(isInterruptText('왜 [Request interrupted by user] 가 떴지?')).toBe(false)
    expect(isInterruptText('[Request interrupted]')).toBe(false)
  })
})

describe('judgeInterrupt', () => {
  const before = join(prompt('일 해 줘'), toolUse)
  const fromLine = before.split('\n').length - 1

  it('is stopped when the interrupt line appears after the Esc point (tool running)', () => {
    expect(judgeInterrupt(before + join(rejected, interruptLine('[Request interrupted by user for tool use]')), fromLine)).toBe('stopped')
  })

  it('is stopped while writing text too', () => {
    const text = line({ type: 'assistant', message: { id: 'm2', role: 'assistant', content: [{ type: 'text', text: '1\n2\n3' }] } })
    expect(judgeInterrupt(before + join(text, interruptLine('[Request interrupted by user]')), fromLine)).toBe('stopped')
  })

  it('is continued when a queued message is dequeued (measured order: dequeue before the interrupt line)', () => {
    const after = join(queueOp('dequeue'), rejected, interruptLine('[Request interrupted by user for tool use]'), prompt('"둘" 이라고만 답해.'))
    expect(judgeInterrupt(before + after, fromLine)).toBe('continued')
  })

  it('is unknown with nothing new, and ignores interrupt lines before the Esc point', () => {
    expect(judgeInterrupt(before, fromLine)).toBe('unknown')
    const old = join(prompt('a'), interruptLine('[Request interrupted by user]'), prompt('b'))
    expect(judgeInterrupt(old, old.split('\n').length - 1)).toBe('unknown')
  })

  it('does not count a dequeue alone (the turn may have ended on its own)', () => {
    expect(judgeInterrupt(before + join(queueOp('dequeue'), prompt('다음')), fromLine)).toBe('unknown')
  })

  it('reads a line that was half written at the Esc point', () => {
    const half = `${before}{"type":"user","message":{"role":"user","content":[{"type":"te`
    const full = `${before}${interruptLine('[Request interrupted by user]')}\n`
    expect(judgeInterrupt(full, half.split('\n').length - 1)).toBe('stopped')
  })
})

describe('isAwaitingFirstResponse', () => {
  it('is true right after a prompt and false once claude wrote anything', () => {
    expect(isAwaitingFirstResponse(join(prompt('일 해 줘')))).toBe(true)
    expect(isAwaitingFirstResponse(join(prompt('일 해 줘'), toolUse))).toBe(false)
    // 도구 결과는 차례 시작이 아니다
    expect(isAwaitingFirstResponse(join(prompt('일 해 줘'), toolUse, rejected))).toBe(false)
  })

  it('starts a turn on a queued_command and ignores interrupt lines, meta and compact summaries', () => {
    const queued = line({ type: 'attachment', attachment: { type: 'queued_command', prompt: '이것도' } })
    expect(isAwaitingFirstResponse(join(prompt('a'), toolUse, queued))).toBe(true)
    expect(isAwaitingFirstResponse(join(prompt('a'), toolUse, interruptLine('[Request interrupted by user]')))).toBe(false)
    const meta = line({ type: 'user', isMeta: true, message: { role: 'user', content: 'reminder' } })
    const summary = line({ type: 'user', isCompactSummary: true, message: { role: 'user', content: '요약' } })
    expect(isAwaitingFirstResponse(join(prompt('a'), toolUse, meta, summary))).toBe(false)
  })
})

describe('decideInterrupt', () => {
  it('keeps what jsonl says', () => {
    expect(decideInterrupt('stopped', true)).toBe('stopped')
    expect(decideInterrupt('continued', false)).toBe('continued')
  })

  it('treats no record before any response as the prompt going back to the input box', () => {
    expect(decideInterrupt('unknown', true)).toBe('restored')
    expect(decideInterrupt('unknown', false)).toBe('unknown')
  })
})
