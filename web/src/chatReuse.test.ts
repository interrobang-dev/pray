import { describe, expect, it } from 'vitest'
import { buildChatRows, type ChatRow } from './chatRows'
import { isSameMessage, reuseMessages, reuseRows } from './chatReuse'
import type { ChatMessage, ToolUse } from './types'

let nextId = 0
const tool = (name: string, result: string | null = '결과'): ToolUse => ({ id: `t${nextId++}`, name, input: { command: 'ls' }, result })
const message = (role: ChatMessage['role'], text = '', toolUses: ToolUse[] = [], patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${nextId++}`,
  role,
  timestamp: new Date(Date.UTC(2026, 9, 24, 1, 0, nextId)).toISOString(),
  text,
  toolUses,
  ...patch,
})
/** 서버에서 다시 받은 것처럼 내용은 같고 객체만 새것 */
const refetched = (messages: ChatMessage[]): ChatMessage[] => JSON.parse(JSON.stringify(messages))

describe('isSameMessage', () => {
  it('필드 하나라도 다르면 다르다', () => {
    const base = message('assistant', '글', [tool('Bash', null)])
    expect(isSameMessage(base, refetched([base])[0])).toBe(true)
    expect(isSameMessage(base, { ...base, text: '다른 글' })).toBe(false)
    expect(isSameMessage(base, { ...base, isQueued: true })).toBe(false)
    expect(isSameMessage(base, { ...base, from: { sessionId: null, name: 'Lead' } })).toBe(false)
    expect(isSameMessage(base, { ...base, toolUses: [{ ...base.toolUses[0], result: '끝' }] })).toBe(false)
    expect(isSameMessage(base, { ...base, toolUses: [{ ...base.toolUses[0], input: { command: 'pwd' } }] })).toBe(false)
    expect(isSameMessage(base, { ...base, toolUses: [{ ...base.toolUses[0], answers: { q: 'a' } }] })).toBe(false)
  })
})

describe('reuseMessages', () => {
  it('하나도 안 바뀌면 이전 배열 그대로', () => {
    const previous = [message('user', '고쳐 줘'), message('assistant', '고쳤다')]
    expect(reuseMessages(previous, refetched(previous))).toBe(previous)
  })

  it('같은 것은 이전 객체, 바뀌거나 새로 온 것은 새 객체', () => {
    const previous = [message('user', '고쳐 줘'), message('assistant', '', [tool('Bash', null)])]
    const next = refetched(previous)
    next[1].toolUses[0].result = '끝'
    next.push(message('assistant', '고쳤다'))
    const merged = reuseMessages(previous, next)
    expect(merged).not.toBe(previous)
    expect(merged[0]).toBe(previous[0])
    expect(merged[1]).toBe(next[1])
    expect(merged[2]).toBe(next[2])
  })

  it('처음 받을 때는 받은 것 그대로', () => {
    const next = [message('user', '고쳐 줘')]
    expect(reuseMessages([], next)).toBe(next)
  })

  it('개수가 줄면 바뀐 것', () => {
    const previous = [message('user', '고쳐 줘'), message('user', '대기', [], { isQueued: true })]
    const merged = reuseMessages(previous, refetched(previous).slice(0, 1))
    expect(merged).toEqual([previous[0]])
    expect(merged[0]).toBe(previous[0])
    expect(merged).not.toBe(previous)
  })
})

describe('reuseRows', () => {
  const classify = (toolUse: ToolUse) => (toolUse.name === 'Relay' ? { name: toolUse.name, result: toolUse.result } : null)
  const isSameSpecial = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const build = (messages: ChatMessage[], isTurnInProgress = false) => buildChatRows(messages, classify, isTurnInProgress)
  const rebuild = (previousRows: ChatRow<unknown>[], previousMessages: ChatMessage[], nextMessages: ChatMessage[], isTurnInProgress = false) =>
    reuseRows(previousRows, build(reuseMessages(previousMessages, nextMessages), isTurnInProgress), isSameSpecial)

  it('메시지가 그대로면 줄 배열도 그대로', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '찾아본다', [tool('Read')]), message('assistant', '', [tool('Relay')]), message('assistant', '고쳤다')]
    const rows = build(messages)
    expect(rebuild(rows, messages, refetched(messages))).toBe(rows)
  })

  it('새 차례가 붙으면 앞 줄은 이전 객체, 새 줄만 새것', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '찾아본다', [tool('Read')]), message('assistant', '고쳤다')]
    const rows = build(messages)
    const next = [...refetched(messages), message('user', '또'), message('assistant', '했다')]
    const merged = rebuild(rows, messages, next)
    expect(merged.slice(0, rows.length).every((row, index) => row === rows[index])).toBe(true)
    expect(merged.length).toBe(rows.length + 2)
  })

  it('진행 중 묶음에 도구 결과가 들어오면 그 묶음만 새것', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '찾아본다', [tool('Read')]), message('assistant', '', [tool('Bash', null)])]
    const rows = build(messages, true)
    const next = refetched(messages)
    next[2].toolUses[0].result = '끝'
    const merged = rebuild(rows, messages, next, true)
    expect(merged[0]).toBe(rows[0])
    expect(merged[1]).not.toBe(rows[1])
    expect(merged[1].kind === 'work' && merged[1].work.toolCount).toBe(2)
  })

  it('차례가 끝나 진행 중 묶음이 끝난 묶음이 되면 새것', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '찾아본다', [tool('Read')]), message('assistant', '고쳤다')]
    const rows = build(messages, true)
    const merged = rebuild(rows, messages, refetched(messages), false)
    expect(merged[0]).toBe(rows[0])
    expect(merged[1]).not.toBe(rows[1])
  })

  it('특별한 줄은 내용이 바뀌면 새것', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Relay', null)])]
    const rows = build(messages)
    const next = refetched(messages)
    next[1].toolUses[0].result = '{}'
    const merged = rebuild(rows, messages, next)
    expect(merged[0]).toBe(rows[0])
    expect(merged.find((row) => row.kind === 'special')).not.toBe(rows.find((row) => row.kind === 'special'))
  })
})
