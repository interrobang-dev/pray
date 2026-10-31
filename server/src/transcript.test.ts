import { describe, expect, it } from 'vitest'
import { summarizeTranscript } from './transcript.js'

describe('summarizeTranscript', () => {
  it('extracts title, last timestamp and last assistant text', () => {
    const jsonl = [
      JSON.stringify({ type: 'ai-title', aiTitle: '제목' }),
      JSON.stringify({ type: 'user', timestamp: '2026-10-20T01:00:00Z', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-10-20T01:00:05Z',
        message: { content: [{ type: 'tool_use' }, { type: 'text', text: ' 답변 ' }] },
      }),
      '{"broken',
      '',
    ].join('\n')
    expect(summarizeTranscript(jsonl)).toEqual({
      title: '제목',
      startedAt: '2026-10-20T01:00:00Z',
      lastAt: '2026-10-20T01:00:05Z',
      turnEndedAt: '2026-10-20T01:00:05Z',
      lastAssistantText: '답변',
      model: null,
      effort: null,
      contextTokens: null,
      turn: { kind: 'in-progress', text: null },
    })
  })

  it('returns nulls for empty input', () => {
    expect(summarizeTranscript('')).toEqual({
      title: null,
      startedAt: null,
      lastAt: null,
      turnEndedAt: null,
      lastAssistantText: null,
      model: null,
      effort: null,
      contextTokens: null,
      turn: { kind: 'none', text: null },
    })
  })

  it('takes startedAt from the first line that has a timestamp', () => {
    const jsonl = [
      JSON.stringify({ type: 'ai-title', aiTitle: '제목' }),
      JSON.stringify({ type: 'user', timestamp: '2026-10-20T01:00:00Z', message: { role: 'user', content: 'hi' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-10-20T02:00:00Z', message: { role: 'user', content: 'again' } }),
    ].join('\n')
    expect(summarizeTranscript(jsonl).startedAt).toBe('2026-10-20T01:00:00Z')
  })

  it('returns null startedAt when no line has a timestamp', () => {
    expect(summarizeTranscript(JSON.stringify({ type: 'ai-title', aiTitle: '제목' })).startedAt).toBeNull()
  })

  const assistant = (fields: Record<string, unknown>, model = 'claude-opus-5-5') =>
    JSON.stringify({ type: 'assistant', message: { model, content: [{ type: 'text', text: '응답' }] }, ...fields })

  it('takes model and effort from the last assistant line, preferring perTurnEffort', () => {
    const jsonl = [
      assistant({ effort: 'low', perTurnEffort: 'low' }, 'claude-sonnet-5-5'),
      assistant({ effort: 'xhigh', perTurnEffort: 'high' }),
    ].join('\n')
    expect(summarizeTranscript(jsonl)).toMatchObject({ model: 'claude-opus-5-5', effort: 'high' })
  })

  it('falls back to effort when perTurnEffort is missing', () => {
    expect(summarizeTranscript(assistant({ effort: 'xhigh' }))).toMatchObject({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('takes effort from the same line as the model (null when that line has none)', () => {
    const jsonl = [assistant({ effort: 'high' }), assistant({}, 'claude-fable-5-1')].join('\n')
    expect(summarizeTranscript(jsonl)).toMatchObject({ model: 'claude-fable-5-1', effort: null })
  })

  it('skips <synthetic> responses and keeps the real one before them', () => {
    const jsonl = [
      assistant({ effort: 'medium', perTurnEffort: 'medium' }, 'claude-haiku-5-5'),
      assistant({ perTurnEffort: 'high' }, '<synthetic>'),
    ].join('\n')
    expect(summarizeTranscript(jsonl)).toMatchObject({ model: 'claude-haiku-5-5', effort: 'medium' })
  })

  it('returns null model and effort when there are only user lines or synthetic responses', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, effort: 'high' }),
      assistant({}, '<synthetic>'),
    ].join('\n')
    expect(summarizeTranscript(jsonl)).toMatchObject({ model: null, effort: null })
  })

  describe('contextTokens', () => {
    const usage = (input: unknown, cacheRead: unknown, cacheCreation: unknown) => ({
      input_tokens: input,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheCreation,
      output_tokens: 345,
    })
    const reply = (fields: Record<string, unknown>, model = 'claude-opus-5-5') =>
      JSON.stringify({ type: 'assistant', message: { model, content: [{ type: 'text', text: '응답' }], ...fields } })

    it('sums input, cache read and cache creation tokens of the last response (not output)', () => {
      const jsonl = [reply({ usage: usage(5, 100, 10) }), reply({ usage: usage(2, 166928, 10970) })].join('\n')
      expect(summarizeTranscript(jsonl).contextTokens).toBe(177900)
    })

    it('skips <synthetic> responses like model and effort', () => {
      const jsonl = [reply({ usage: usage(2, 1000, 0) }), reply({ usage: usage(0, 0, 0) }, '<synthetic>')].join('\n')
      expect(summarizeTranscript(jsonl).contextTokens).toBe(1002)
    })

    it('skips sidechain and meta responses (model, effort and context stay from the main conversation)', () => {
      const side = JSON.stringify({
        type: 'assistant',
        isSidechain: true,
        effort: 'low',
        message: { model: 'claude-haiku-5-5', content: [{ type: 'text', text: '서브' }], usage: usage(1, 2, 3) },
      })
      const jsonl = [reply({ usage: usage(2, 150000, 1000) }), side].join('\n')
      expect(summarizeTranscript(jsonl)).toMatchObject({ model: 'claude-opus-5-5', contextTokens: 151002 })
    })

    it('counts missing fields as 0 and is null without usage or any number', () => {
      expect(summarizeTranscript(reply({ usage: { input_tokens: 7 } })).contextTokens).toBe(7)
      expect(summarizeTranscript(reply({ usage: usage(null, '3', undefined) })).contextTokens).toBeNull()
      // 앞 응답 값이 남지 않는다 (모델·effort 와 같은 줄)
      expect(summarizeTranscript([reply({ usage: usage(1, 2, 3) }), reply({})].join('\n')).contextTokens).toBeNull()
    })

    it('becomes unknown after a compact boundary until the next response', () => {
      const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' })
      const before = reply({ usage: usage(2, 400000, 0) })
      expect(summarizeTranscript([before, boundary].join('\n'))).toMatchObject({ model: 'claude-opus-5-5', contextTokens: null })
      expect(summarizeTranscript([before, boundary, reply({ usage: usage(3, 0, 20000) })].join('\n')).contextTokens).toBe(20003)
    })
  })

  describe('turnEndedAt', () => {
    const line = (timestamp: string, fields: Record<string, unknown>) => JSON.stringify({ timestamp, ...fields })
    const user = (timestamp: string, content: unknown, fields: Record<string, unknown> = {}) =>
      line(timestamp, { type: 'user', message: { role: 'user', content }, ...fields })
    const reply = (timestamp: string, model = 'claude-opus-5-5', fields: Record<string, unknown> = {}) =>
      line(timestamp, { type: 'assistant', message: { model, content: [{ type: 'text', text: '응답' }] }, ...fields })

    it('takes the last human or claude line and skips lines unrelated to the conversation', () => {
      const jsonl = [
        user('2026-10-20T01:00:00Z', '지시'),
        reply('2026-10-20T01:00:05Z'),
        line('2026-10-20T01:10:00Z', { type: 'ai-title', aiTitle: '제목' }),
        line('2026-10-20T01:20:00Z', { type: 'cost-state' }),
        user('2026-10-20T01:30:00Z', '<task-notification><status>completed</status></task-notification>'),
        user('2026-10-20T01:31:00Z', '<command-name>/help</command-name>'),
        reply('2026-10-20T01:32:00Z', '<synthetic>'),
        reply('2026-10-20T01:33:00Z', 'claude-opus-5-5', { isSidechain: true }),
        user('2026-10-20T01:34:00Z', 'meta', { isMeta: true }),
        user('2026-10-20T01:35:00Z', '요약', { isCompactSummary: true }),
        line('2026-10-20T01:36:00Z', { type: 'queue-operation', operation: 'enqueue', content: '대기' }),
      ].join('\n')
      expect(summarizeTranscript(jsonl)).toMatchObject({ lastAt: '2026-10-20T01:36:00Z', turnEndedAt: '2026-10-20T01:00:05Z' })
    })

    it('counts tool results, interrupt lines and pasted prompts', () => {
      expect(summarizeTranscript(user('2026-10-20T02:00:00Z', [{ type: 'tool_result', content: 'ok' }])).turnEndedAt).toBe('2026-10-20T02:00:00Z')
      expect(summarizeTranscript(user('2026-10-20T02:01:00Z', [{ type: 'text', text: '[Request interrupted by user]' }])).turnEndedAt).toBe(
        '2026-10-20T02:01:00Z',
      )
      const pasted = '\n\n<pasted_content id="ab12">\n긴 글\n</pasted_content id="ab12">\n\n'
      expect(summarizeTranscript(user('2026-10-20T02:02:00Z', pasted)).turnEndedAt).toBe('2026-10-20T02:02:00Z')
    })
  })
})
