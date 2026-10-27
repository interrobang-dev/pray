import { describe, expect, it } from 'vitest'
import { BTW_HISTORY_LIMIT, BTW_QUESTION_MAX_LENGTH, BtwStore, parseBtwQuestion, parseBtwResult } from './btw.js'

const SESSION = 'web-1'

function store() {
  let tick = 0
  return new BtwStore(() => new Date(Date.UTC(2026, 9, 27, 0, 0, tick++)))
}

describe('parseBtwQuestion', () => {
  it('trims and accepts 1 to 4000 characters', () => {
    expect(parseBtwQuestion('  what is this?\n')).toBe('what is this?')
    expect(parseBtwQuestion('x'.repeat(BTW_QUESTION_MAX_LENGTH))).toHaveLength(BTW_QUESTION_MAX_LENGTH)
    for (const value of ['', '   ', 'x'.repeat(BTW_QUESTION_MAX_LENGTH + 1), null, 3, {}]) expect(parseBtwQuestion(value)).toBeNull()
  })
})

describe('parseBtwResult', () => {
  it('reads an answer and turns each failure reason into a message', () => {
    expect(parseBtwResult({ isAnswered: true, text: 'MANGO', usage: {} })).toEqual({ isAnswered: true, text: 'MANGO' })
    expect(parseBtwResult({ isAnswered: false, reason: 'nothing-to-fork' })).toEqual({
      isAnswered: false,
      message: 'Nothing to answer from yet: wait for claude to finish its first reply',
    })
    expect(parseBtwResult({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} })).toEqual({
      isAnswered: false,
      message: 'API error 529 (overloaded)',
    })
    expect(parseBtwResult({ isAnswered: false, reason: 'api-error', status: null, error: 'unknown' })).toEqual({
      isAnswered: false,
      message: 'API error (unknown)',
    })
    expect(parseBtwResult({ isAnswered: false, reason: 'empty-reply' })).toEqual({ isAnswered: false, message: 'Claude replied with no text' })
    expect(parseBtwResult({ isAnswered: false, reason: 'aborted' })).toEqual({ isAnswered: false, message: 'The answer was cut off' })
    expect(parseBtwResult({ isAnswered: false, reason: 'new-reason' })).toEqual({ isAnswered: false, message: 'No answer (new-reason)' })
  })

  it('rejects malformed bodies', () => {
    for (const body of [null, 'x', {}, { isAnswered: true }, { isAnswered: true, text: 3 }, { isAnswered: false }, { isAnswered: 'yes', text: 'x' }]) {
      expect(parseBtwResult(body)).toBeNull()
    }
  })
})

describe('BtwStore', () => {
  it('gives the mod the question with the answered exchanges before it, oldest first', () => {
    const btw = store()
    btw.ask(SESSION, 'a', 'First?')
    btw.settle(SESSION, 'a', { isAnswered: true, text: 'One.' })
    btw.ask(SESSION, 'b', 'Second?')
    btw.settle(SESSION, 'b', { isAnswered: false, message: 'API error' })
    btw.ask(SESSION, 'c', 'Third?')
    expect(btw.hasPending(SESSION)).toBe(true)
    expect(btw.request(SESSION, 'c')).toEqual({ question: 'Third?', history: [{ question: 'First?', answer: 'One.' }] })
    // 다른 세션·모르는 ID·이미 끝난 요청은 없다
    expect(btw.request('other', 'c')).toBeNull()
    expect(btw.request(SESSION, 'x')).toBeNull()
    expect(btw.request(SESSION, 'a')).toBeNull()
  })

  it('settles only a pending request once, with times', () => {
    const btw = store()
    const asked = btw.ask(SESSION, 'a', 'Q?')
    expect(asked).toEqual({ id: 'a', question: 'Q?', status: 'pending', answer: null, error: null, askedAt: '2026-10-27T00:00:00.000Z', answeredAt: null })
    expect(btw.settle('other', 'a', { isAnswered: true, text: 'A' })).toBe(false)
    expect(btw.settle(SESSION, 'a', { isAnswered: true, text: 'A' })).toBe(true)
    expect(btw.settle(SESSION, 'a', { isAnswered: false, message: 'late' })).toBe(false)
    expect(btw.list(SESSION)).toEqual([{ ...asked, status: 'answered', answer: 'A', answeredAt: '2026-10-27T00:00:01.000Z' }])
    expect(btw.hasPending(SESSION)).toBe(false)
  })

  it('keeps the latest 20 per session', () => {
    const btw = store()
    for (let i = 0; i < BTW_HISTORY_LIMIT + 3; i++) btw.ask(SESSION, `q${i}`, `Q${i}`)
    const ids = btw.list(SESSION).map((item) => item.id)
    expect(ids).toHaveLength(BTW_HISTORY_LIMIT)
    expect(ids[0]).toBe('q3')
    expect(ids.at(-1)).toBe(`q${BTW_HISTORY_LIMIT + 2}`)
  })

  it('removes, clears one session and clears all', () => {
    const btw = store()
    btw.ask(SESSION, 'a', 'A?')
    btw.remove(SESSION, 'a')
    expect(btw.list(SESSION)).toEqual([])
    btw.ask(SESSION, 'b', 'B?')
    btw.ask('web-2', 'c', 'C?')
    expect(btw.clear(SESSION)).toBe(true)
    expect(btw.clear(SESSION)).toBe(false)
    expect(btw.clearAll()).toEqual(['web-2'])
    expect(btw.list('web-2')).toEqual([])
  })
})
