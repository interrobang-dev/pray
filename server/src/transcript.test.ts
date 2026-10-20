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
    })
  })

  it('returns nulls for empty input', () => {
    expect(summarizeTranscript('')).toEqual({ title: null, lastAt: null, lastAssistantText: null })
  })
})
