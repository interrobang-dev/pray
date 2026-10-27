import { describe, expect, it } from 'vitest'
import { applyMessagesResponse, messagesUrl, versionOfEtag, type HeldMessages } from './chatDelta'
import type { ChatMessage } from './types'

const message = (id: string, text = id): ChatMessage => ({ id, role: 'user', timestamp: 't', text, toolUses: [] })
const V1 = 'a'.repeat(40)
const V2 = 'b'.repeat(40)
const held: HeldMessages = { sessionId: 's', version: V1, messages: [message('1'), message('2'), message('3')] }

describe('versionOfEtag·messagesUrl', () => {
  it('takes only a sha1 weak ETag as a version', () => {
    expect(versionOfEtag(`W/"${V1}"`)).toBe(V1)
    // 옛 서버(Express)의 ETag·강한 ETag·없음
    expect(versionOfEtag('W/"1f-abcdef"')).toBeNull()
    expect(versionOfEtag(`"${V1}"`)).toBeNull()
    expect(versionOfEtag(null)).toBeNull()
  })

  it('asks for changes only with a version of the same session', () => {
    expect(messagesUrl('s', held)).toBe(`/api/sessions/s/messages?since=${V1}`)
    expect(messagesUrl('other', held)).toBe('/api/sessions/other/messages')
    expect(messagesUrl('s', null)).toBe('/api/sessions/s/messages')
  })
})

describe('applyMessagesResponse', () => {
  it('takes an array as the whole list with the ETag version', () => {
    const data = [message('1')]
    expect(applyMessagesResponse(data, `W/"${V2}"`, held)).toEqual({ messages: data, version: V2 })
    expect(applyMessagesResponse(data, null, null)).toEqual({ messages: data, version: null })
  })

  it('keeps messages before fromIndex and replaces the rest, including changed earlier messages', () => {
    const changed = message('2', '도구 결과가 붙음')
    const result = applyMessagesResponse({ version: V2, fromIndex: 1, total: 4, messages: [changed, message('3'), message('4')] }, null, held)
    expect(result).toEqual({ messages: [held.messages[0], changed, message('3'), message('4')], version: V2 })
    expect(result!.messages[0]).toBe(held.messages[0])
  })

  it('shrinks when messages went away (queued messages dropped)', () => {
    expect(applyMessagesResponse({ version: V2, fromIndex: 2, total: 2, messages: [] }, null, held)).toEqual({ messages: held.messages.slice(0, 2), version: V2 })
  })

  it('returns the held array itself when nothing changed', () => {
    expect(applyMessagesResponse({ version: V1, fromIndex: 3, total: 3, messages: [] }, null, held)!.messages).toBe(held.messages)
  })

  it('takes everything from 0 even without a held list', () => {
    expect(applyMessagesResponse({ version: V2, fromIndex: 0, total: 1, messages: [message('1')] }, null, null)).toEqual({ messages: [message('1')], version: V2 })
  })

  it('rejects responses that do not fit, so the caller loads the whole list again', () => {
    const fits = { version: V2, fromIndex: 1, total: 2, messages: [message('x')] }
    expect(applyMessagesResponse(fits, null, held)).not.toBeNull()
    expect(applyMessagesResponse({ ...fits, total: 3 }, null, held)).toBeNull()
    expect(applyMessagesResponse({ ...fits, fromIndex: 4, total: 5 }, null, held)).toBeNull()
    expect(applyMessagesResponse({ ...fits, fromIndex: 1 }, null, null)).toBeNull()
    expect(applyMessagesResponse({ ...fits, fromIndex: -1, total: 0 }, null, held)).toBeNull()
    expect(applyMessagesResponse({ ...fits, fromIndex: 0.5 }, null, held)).toBeNull()
    expect(applyMessagesResponse({ ...fits, version: 'x' }, null, held)).toBeNull()
    expect(applyMessagesResponse({ ...fits, messages: null }, null, held)).toBeNull()
    expect(applyMessagesResponse(null, null, held)).toBeNull()
    expect(applyMessagesResponse({ message: 'error' }, null, held)).toBeNull()
  })
})
