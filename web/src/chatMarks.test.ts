import { describe, expect, it } from 'vitest'
import { buildMarkList, isMarkableMessage, markPreview, withMark, withoutMark, type ChatMark } from './chatMarks'
import type { ChatMessage } from './types'

function message(id: string, role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, timestamp: '2026-11-11T00:00:00.000Z', text, toolUses: [], ...extra }
}

describe('isMarkableMessage', () => {
  it('marks claude answers and my own messages', () => {
    expect(isMarkableMessage(message('a', 'assistant', 'Done'))).toBe(true)
    expect(isMarkableMessage(message('u', 'user', 'Fix it'))).toBe(true)
  })

  it('skips empty, queued, relayed, system and notice messages', () => {
    expect(isMarkableMessage(message('a', 'assistant', '  '))).toBe(false)
    expect(isMarkableMessage(message('q', 'user', 'later', { isQueued: true }))).toBe(false)
    expect(isMarkableMessage(message('r', 'user', 'do it', { from: { sessionId: null, name: 'Lead' } }))).toBe(false)
    expect(isMarkableMessage(message('s', 'system', 'note'))).toBe(false)
    expect(isMarkableMessage(message('c', 'system', 'summary', { isCompactSummary: true }))).toBe(false)
    expect(isMarkableMessage(message('i', 'user', '[Request interrupted by user]', { isInterrupt: true }))).toBe(false)
  })
})

describe('buildMarkList', () => {
  const messages = [message('m1', 'user', 'one'), message('m2', 'assistant', 'two'), message('m3', 'user', 'three')]

  it('orders found marks by conversation and puts missing ones last in mark order', () => {
    const marks: ChatMark[] = [
      { key: 'm3', createdAt: '1' },
      { key: 'gone-b', createdAt: '2' },
      { key: 'm1', createdAt: '3' },
      { key: 'gone-a', createdAt: '4' },
    ]
    const list = buildMarkList(marks, messages)
    expect(list.map((item) => item.key)).toEqual(['m1', 'm3', 'gone-b', 'gone-a'])
    expect(list[0].message).toBe(messages[0])
    expect(list[2].message).toBeNull()
    expect(list[0].createdAt).toBe('3')
  })

  it('is empty without marks', () => {
    expect(buildMarkList([], messages)).toEqual([])
  })
})

describe('markPreview', () => {
  it('takes the first non-empty line without markdown marks', () => {
    expect(markPreview('\n\n## **Plan** for `x`\nmore')).toBe('Plan for x')
    expect(markPreview('- item one\n- item two')).toBe('item one')
    expect(markPreview('> quoted')).toBe('quoted')
    expect(markPreview('1. first')).toBe('first')
    expect(markPreview('plain text')).toBe('plain text')
    expect(markPreview('')).toBe('')
  })

  it('cuts long lines', () => {
    const preview = markPreview('a'.repeat(300))
    expect(preview).toHaveLength(201)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('withMark / withoutMark', () => {
  const marks: ChatMark[] = [{ key: 'a', createdAt: '1' }]

  it('adds once and removes once', () => {
    expect(withMark(marks, 'a', '2')).toBe(marks)
    expect(withMark(marks, 'b', '2')).toEqual([...marks, { key: 'b', createdAt: '2' }])
    expect(withoutMark(marks, 'b')).toBe(marks)
    expect(withoutMark(marks, 'a')).toEqual([])
  })
})
