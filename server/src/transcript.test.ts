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
      lastAt: '2026-10-20T01:00:05Z',
      turnEndedAt: '2026-10-20T01:00:05Z',
      lastAssistantText: '답변',
      model: null,
      effort: null,
    })
  })

  it('returns nulls for empty input', () => {
    expect(summarizeTranscript('')).toEqual({ title: null, lastAt: null, turnEndedAt: null, lastAssistantText: null, model: null, effort: null })
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
