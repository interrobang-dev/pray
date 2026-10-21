import { describe, expect, it } from 'vitest'
import { answerBox, decideOutcome, judgeQueue, type UnqueueProgress, type UnqueueStep } from './unqueue.js'

/** 단계를 하나씩 밟는다: 알림마다 답을 받고 progress 를 바꾼다 */
function run(queued: string[], reports: [string, string][]) {
  const progress: UnqueueProgress = { queued, step: { kind: 'popping' } }
  const answers = reports.map(([text, origin]) => {
    const answer = answerBox(progress, text, origin)
    progress.step = answer.step
    return { reply: answer.reply, isEnterNeeded: answer.isEnterNeeded }
  })
  return { step: progress.step, answers }
}

describe('answerBox', () => {
  it('re-enters every message but the last one: fill → Enter → empty → next fill', () => {
    const { step, answers } = run(
      ['대기1', '대기2', '대기3'],
      [
        ['대기1\n대기2\n대기3', 'engine'],
        ['대기1', 'plugin'],
        ['', 'clear'],
        ['대기2', 'plugin'],
        ['', 'clear'],
      ],
    )
    expect(answers).toEqual([
      { reply: { fill: '대기1' }, isEnterNeeded: false },
      { reply: {}, isEnterNeeded: true },
      { reply: { fill: '대기2' }, isEnterNeeded: false },
      { reply: {}, isEnterNeeded: true },
      { reply: {}, isEnterNeeded: false },
    ])
    expect(step).toEqual({ kind: 'done' })
  })

  it('only empties the box when the cancelled message was the only one', () => {
    const { step, answers } = run(['하나뿐'], [
      ['하나뿐', 'engine'],
      ['', 'plugin'],
    ])
    expect(answers.map((a) => a.reply)).toEqual([{ fill: '' }, {}])
    expect(step).toEqual({ kind: 'done' })
  })

  it('waits for the pop itself: other changes before it do not count', () => {
    const { step, answers } = run(['대기1', '대기2'], [['', 'clear']])
    expect(answers).toEqual([{ reply: {}, isEnterNeeded: false }])
    expect(step).toEqual({ kind: 'popping' })
  })

  it('stops without further instructions when the box is not what was expected', () => {
    // 꺼낸 글이 대기 글과 다름 (다른 메시지가 끼었거나 쓰던 글이 붙음)
    expect(run(['대기1', '대기2'], [['대기1\n대기2\n쓰던 글', 'engine']]).step).toEqual({ kind: 'stuck' })
    // fill 한 글이 그대로 들어가지 않음
    expect(run(['대기1', '대기2'], [['대기1\n대기2', 'engine'], ['[Pasted text #1]', 'plugin']]).step).toEqual({ kind: 'stuck' })
    // Enter 뒤 입력칸이 비지 않음
    expect(run(['대기1', '대기2'], [['대기1\n대기2', 'engine'], ['대기1', 'plugin'], ['대기1', 'engine']]).step).toEqual({ kind: 'stuck' })
    const stuck = run(['대기1', '대기2'], [['다른 글', 'engine'], ['', 'clear'], ['대기1', 'plugin']])
    expect(stuck.step).toEqual({ kind: 'stuck' })
    expect(stuck.answers.every((a) => Object.keys(a.reply).length === 0 && !a.isEnterNeeded)).toBe(true)
  })
})

describe('judgeQueue', () => {
  const op = (operation: string, content?: string, reason?: string) =>
    JSON.stringify({ type: 'queue-operation', operation, timestamp: 't', sessionId: 's', ...(content !== undefined && { content }), ...(reason && { reason }) })
  const delivered = (prompt: string) => JSON.stringify({ type: 'attachment', uuid: 'q', attachment: { type: 'queued_command', prompt } })
  const before = [op('enqueue', 'A'), op('enqueue', 'B')]

  it('popAll of the target only → cancelled (other popped and re-entered messages do not matter)', () => {
    const jsonl = [...before, op('popAll', 'A'), op('popAll', 'B'), op('enqueue', 'A'), op('dequeue')].join('\n')
    expect(judgeQueue(jsonl, 2, 'B')).toBe('cancelled')
    expect(judgeQueue([...before, op('popOne', 'B')].join('\n'), 2, 'B')).toBe('cancelled')
  })

  it('popAll with a queued_command of the same text → accepted (popped while being absorbed)', () => {
    const jsonl = [...before, delivered('B'), op('popAll', 'A'), op('popAll', 'B')].join('\n')
    expect(judgeQueue(jsonl, 2, 'B')).toBe('accepted')
  })

  it('not popped but absorbed mid-turn or dequeued after the turn → accepted', () => {
    expect(judgeQueue([...before, op('remove', 'B', 'absorbed_mid_turn'), delivered('B')].join('\n'), 2, 'B')).toBe('accepted')
    expect(judgeQueue([...before, op('dequeue')].join('\n'), 2, 'B')).toBe('accepted')
  })

  it('nothing about the target yet → unknown (lines before fromLine and other texts are ignored)', () => {
    expect(judgeQueue(before.join('\n'), 2, 'B')).toBe('unknown')
    expect(judgeQueue([op('popAll', 'B'), ...before].join('\n'), 1, 'B')).toBe('unknown')
    expect(judgeQueue([...before, op('remove', 'B', 'cleared_on_cancel'), op('popAll', 'A'), 'not json'].join('\n'), 2, 'B')).toBe('unknown')
  })
})

describe('decideOutcome', () => {
  const step = (kind: UnqueueStep['kind']): UnqueueStep => (kind === 'filling' || kind === 'submitting' ? { kind, index: 0 } : { kind }) as UnqueueStep

  it('combines the box progress and the jsonl judgement', () => {
    expect(decideOutcome(step('done'), 'cancelled')).toBe('cancelled')
    expect(decideOutcome(step('done'), 'accepted')).toBe('accepted')
    expect(decideOutcome(step('done'), 'unknown')).toBe('failed')
    expect(decideOutcome(step('stuck'), 'cancelled')).toBe('stuck')
    expect(decideOutcome(step('stuck'), 'accepted')).toBe('stuck')
    // 꺼냄 알림이 없었다: 이미 받아서 꺼낼 게 없었거나, 꺼냈는데 mod 가 안 붙었다
    expect(decideOutcome(step('popping'), 'accepted')).toBe('accepted')
    expect(decideOutcome(step('popping'), 'cancelled')).toBe('failed')
    expect(decideOutcome(step('popping'), 'unknown')).toBe('failed')
    // 다시 넣는 도중 시간이 다 됨: 입력칸 상태를 모른다
    for (const kind of ['filling', 'submitting', 'clearing'] as const) expect(decideOutcome(step(kind), 'cancelled')).toBe('failed')
  })
})
