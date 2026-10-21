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
      lastAssistantText: '답변',
      model: null,
      effort: null,
    })
  })

  it('returns nulls for empty input', () => {
    expect(summarizeTranscript('')).toEqual({ title: null, lastAt: null, lastAssistantText: null, model: null, effort: null })
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
})
