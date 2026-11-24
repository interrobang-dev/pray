import { describe, expect, it } from 'vitest'
import { lastLoginNeededId } from './loginNeeded'
import type { ChatMessage } from './types'

const message = (id: string, role: ChatMessage['role'], isLoginNeeded = false): ChatMessage => ({
  id,
  role,
  timestamp: 't',
  text: id,
  toolUses: [],
  ...(isLoginNeeded ? { isLoginNeeded: true as const } : {}),
})

describe('lastLoginNeededId', () => {
  it('picks the last claude reply when it is the login error, even with user messages after it', () => {
    expect(lastLoginNeededId([message('u1', 'user'), message('a1', 'assistant', true)])).toBe('a1')
    expect(lastLoginNeededId([message('a1', 'assistant', true), message('u2', 'user'), message('s1', 'system')])).toBe('a1')
  })

  it('ignores an old login error once claude replied again, and empty or normal chats', () => {
    expect(lastLoginNeededId([message('a1', 'assistant', true), message('u2', 'user'), message('a2', 'assistant')])).toBeNull()
    expect(lastLoginNeededId([message('a1', 'assistant')])).toBeNull()
    expect(lastLoginNeededId([])).toBeNull()
  })
})
