import { describe, expect, it } from 'vitest'
import { asPlainText, sentAsTextIds, unknownCommandTitle } from './unknownCommand'
import type { ChatMessage } from './types'

const unknown = (id: string, text: string): ChatMessage => ({
  id,
  role: 'system',
  timestamp: 't',
  text,
  toolUses: [],
  unknownCommand: { command: text.split(' ')[0] },
})
const user = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role: 'user', timestamp: 't', text, toolUses: [], ...extra })

describe('unknown command', () => {
  it('titles the line and puts a space in front so Claude Code reads it as text', () => {
    expect(unknownCommandTitle('/tracking')).toBe('Unknown command /tracking')
    expect(asPlainText('/tracking 페이지')).toBe(' /tracking 페이지')
  })

  it('marks unknown commands whose text was sent again later as text', () => {
    const messages = [
      unknown('u1', '/tracking 페이지 구현 안 된거지 아직?'),
      unknown('u2', '/tracking 페이지 구현 안 된거지 아직?'),
      unknown('u3', '/other'),
      user('m1', ' /tracking 페이지 구현 안 된거지 아직?'),
      user('m2', '/other', { from: { sessionId: null, name: 'Lead' } }),
    ]
    expect(sentAsTextIds(messages)).toEqual(new Set(['u1', 'u2']))
  })

  it('does not count the same text sent before the unknown command', () => {
    expect(sentAsTextIds([user('m1', ' /x'), unknown('u1', '/x')])).toEqual(new Set())
  })
})
