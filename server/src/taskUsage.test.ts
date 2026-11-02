import { describe, expect, it } from 'vitest'
import { readTaskEnd, taskUsageOf } from './taskUsage.js'

const SINCE = '2026-11-01T10:00:00.000Z'

const assistant = (timestamp: string, message: Record<string, unknown>, fields: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp, message: { role: 'assistant', ...message }, ...fields })

const usage = (input: number, output: number, cacheCreation = 0, cacheRead = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: cacheCreation,
  cache_read_input_tokens: cacheRead,
})

const user = (timestamp: string) => JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: '지시' } })

describe('taskUsageOf', () => {
  it('sums responses after the task started, counting a streamed message id once with its last line', () => {
    const text = [
      assistant('2026-11-01T09:59:00Z', { id: 'before', model: 'claude-sonnet-5-5', usage: usage(1000, 1000) }),
      user('2026-11-01T10:00:01Z'),
      assistant('2026-11-01T10:00:05Z', { id: 'm1', model: 'claude-sonnet-5-5', usage: usage(10, 1, 500, 0) }),
      assistant('2026-11-01T10:00:06Z', { id: 'm1', model: 'claude-sonnet-5-5', usage: usage(10, 40, 500, 0) }),
      assistant('2026-11-01T10:00:09Z', { id: 'm2', model: 'claude-opus-5-5', usage: usage(3, 200, 100, 20_000) }),
      '',
    ].join('\n')
    expect(taskUsageOf(text, SINCE)).toEqual({
      usage: { inputTokens: 13, outputTokens: 240, cacheCreationTokens: 600, cacheReadTokens: 20_000, turns: 2 },
      model: 'claude-opus-5-5',
    })
  })

  it('skips sidechain, synthetic, usage-less and broken lines', () => {
    const text = [
      assistant('2026-11-01T10:00:05Z', { id: 'a', model: 'claude-opus-5-5', usage: usage(1, 2) }),
      assistant('2026-11-01T10:00:06Z', { id: 'side', model: 'claude-haiku-5-5', usage: usage(100, 100) }, { isSidechain: true }),
      assistant('2026-11-01T10:00:07Z', { id: 'syn', model: '<synthetic>', usage: usage(0, 0) }),
      assistant('2026-11-01T10:00:08Z', { id: 'nousage', model: 'claude-opus-5-5' }),
      '{"type":"assistant", broken',
    ].join('\n')
    expect(taskUsageOf(text, SINCE)).toEqual({
      usage: { inputTokens: 1, outputTokens: 2, cacheCreationTokens: 0, cacheReadTokens: 0, turns: 1 },
      model: 'claude-opus-5-5',
    })
  })

  it('gives null when no response came after the task started', () => {
    const text = [assistant('2026-11-01T09:00:00Z', { id: 'a', model: 'claude-opus-5-5', usage: usage(1, 2) }), user(SINCE)].join('\n')
    expect(taskUsageOf(text, SINCE)).toEqual({ usage: null, model: null })
    expect(taskUsageOf('', SINCE)).toEqual({ usage: null, model: null })
  })
})

describe('readTaskEnd', () => {
  const task = { memberSessionId: 'm1', createdAt: SINCE }

  it('combines the summary context size with the usage of the transcript text', async () => {
    const text = assistant('2026-11-01T10:00:05Z', { id: 'a', model: 'claude-opus-5-5', usage: usage(5, 6, 7, 8) })
    const reads: string[] = []
    const end = await readTaskEnd(task, {
      summary: async (id) => (reads.push(`summary ${id}`), { contextTokens: 4200 }),
      text: async (id) => (reads.push(`text ${id}`), text),
    })
    expect(end).toEqual({
      contextTokens: 4200,
      usage: { inputTokens: 5, outputTokens: 6, cacheCreationTokens: 7, cacheReadTokens: 8, turns: 1 },
      model: 'claude-opus-5-5',
    })
    expect(reads.sort()).toEqual(['summary m1', 'text m1'])
  })

  it('gives nulls when the transcript is missing', async () => {
    expect(await readTaskEnd(task, { summary: async () => null, text: async () => null })).toEqual({
      contextTokens: null,
      usage: null,
      model: null,
    })
  })
})
