import { describe, expect, it } from 'vitest'
import { applySuggestion, MAX_SUGGESTION_LENGTH } from './suggestion.js'

const WEB = 'web-1'
const webSessionIds = new Set([WEB])

describe('applySuggestion', () => {
  it('sets, keeps the same value without a change, and clears with null', () => {
    const suggestions = new Map<string, string>()
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: WEB, text: '커밋해 줘' })).toBe('changed')
    expect(suggestions.get(WEB)).toBe('커밋해 줘')
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: WEB, text: '  커밋해 줘\n' })).toBe('unchanged')
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: WEB, text: null })).toBe('changed')
    expect(suggestions.has(WEB)).toBe(false)
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: WEB, text: null })).toBe('unchanged')
  })

  it('treats blank text as clearing and cuts long text', () => {
    const suggestions = new Map([[WEB, '이전 제안']])
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: WEB, text: '   ' })).toBe('changed')
    expect(suggestions.has(WEB)).toBe(false)
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: WEB, text: 'x'.repeat(MAX_SUGGESTION_LENGTH + 50) })).toBe('changed')
    expect(suggestions.get(WEB)).toHaveLength(MAX_SUGGESTION_LENGTH)
  })

  it('ignores sessions that are not web sessions and rejects malformed bodies', () => {
    const suggestions = new Map<string, string>()
    expect(applySuggestion(suggestions, webSessionIds, { sessionId: 'external', text: '남의 세션' })).toBe('ignored')
    for (const body of [null, 'text', {}, { sessionId: WEB }, { sessionId: 1, text: 'x' }, { sessionId: WEB, text: 3 }]) {
      expect(applySuggestion(suggestions, webSessionIds, body)).toBe('invalid')
    }
    expect(suggestions.size).toBe(0)
  })
})
