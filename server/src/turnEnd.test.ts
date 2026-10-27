import { describe, expect, it } from 'vitest'
import { endsWithQuestion, turnEndStatus, type TurnEndFacts } from './turnEnd.js'

const facts = (overrides: Partial<TurnEndFacts> = {}): TurnEndFacts => ({
  hasRunningBackground: false,
  latestTask: null,
  lastPromptAt: '2026-10-27T00:00:00.000Z',
  isInterrupted: false,
  lastAssistantText: '테스트를 고쳤고 모두 통과합니다.',
  ...overrides,
})
const doneTask = (finishedAt: string | null = '2026-10-27T00:05:00.000Z') => ({ status: 'done' as const, finishedAt })

describe('turnEndStatus', () => {
  it('is waiting while a background task runs, before every other rule', () => {
    expect(turnEndStatus(facts({ hasRunningBackground: true }))).toBe('waiting')
    expect(turnEndStatus(facts({ hasRunningBackground: true, latestTask: doneTask(), isInterrupted: true, lastAssistantText: '할까요?' }))).toBe('waiting')
  })

  it('is done when the member finished its latest task and no turn started after it, even if it asked something', () => {
    expect(turnEndStatus(facts({ latestTask: doneTask(), lastAssistantText: '다음은 무엇을 할까요?' }))).toBe('done')
    expect(turnEndStatus(facts({ latestTask: doneTask(), isInterrupted: true }))).toBe('done')
    // 차례 시작과 같은 시각에 끝나도 그 차례다
    expect(turnEndStatus(facts({ latestTask: doneTask('2026-10-27T00:00:00.000Z'), lastAssistantText: '할까요?' }))).toBe('done')
    // 차례 시작을 못 봤으면(lastPromptAt 없음) task 를 믿는다
    expect(turnEndStatus(facts({ latestTask: doneTask(), lastPromptAt: null, lastAssistantText: '할까요?' }))).toBe('done')
  })

  it('does not use the task when a new turn started after it, or it is not done', () => {
    const later = { lastPromptAt: '2026-10-27T00:06:00.000Z', lastAssistantText: '어느 쪽으로 할까요?' }
    expect(turnEndStatus(facts({ latestTask: doneTask(), ...later }))).toBe('my-turn')
    expect(turnEndStatus(facts({ latestTask: { status: 'failed', finishedAt: '2026-10-27T00:05:00.000Z' }, lastAssistantText: '할까요?' }))).toBe('my-turn')
    expect(turnEndStatus(facts({ latestTask: { status: 'running', finishedAt: null }, lastAssistantText: '할까요?' }))).toBe('my-turn')
    expect(turnEndStatus(facts({ latestTask: doneTask(null), lastAssistantText: '할까요?' }))).toBe('my-turn')
    expect(turnEndStatus(facts({ latestTask: doneTask('not a date'), lastAssistantText: '할까요?' }))).toBe('my-turn')
  })

  it('is my-turn after a web stop or without last words', () => {
    expect(turnEndStatus(facts({ isInterrupted: true }))).toBe('my-turn')
    expect(turnEndStatus(facts({ lastAssistantText: null }))).toBe('my-turn')
    expect(turnEndStatus(facts({ lastAssistantText: '' }))).toBe('my-turn')
    expect(turnEndStatus(facts({ lastAssistantText: '  \n ' }))).toBe('my-turn')
  })

  it('is my-turn when the last words ask a question, done otherwise', () => {
    expect(turnEndStatus(facts({ lastAssistantText: '진행할까요?' }))).toBe('my-turn')
    expect(turnEndStatus(facts())).toBe('done')
  })
})

describe('endsWithQuestion', () => {
  it('finds ? or ？ anywhere in the last 6 non-empty lines', () => {
    expect(endsWithQuestion('끝.\n\n진행할까요?')).toBe(true)
    expect(endsWithQuestion('어느 쪽으로 할까요？')).toBe(true)
    expect(endsWithQuestion('A 와 B 중 무엇으로 할까요?\n- A: 빠름\n- B: 안전\n\n1. 하나\n2. 둘\n3. 셋')).toBe(true)
    expect(endsWithQuestion('모두 끝났습니다.')).toBe(false)
  })

  it('does not look past 6 lines from the end, skipping empty ones', () => {
    const tail = ['1', '2', '3', '4', '5', '6'].join('\n')
    expect(endsWithQuestion(`할까요?\n${tail}`)).toBe(false)
    expect(endsWithQuestion(`할까요?\n${['1', '2', '3', '4', '5'].join('\n\n\n')}`)).toBe(true)
  })

  it('does not count lines that are only markdown marks once trailing *_` and spaces are removed', () => {
    const fence = ['```', '`', '**', '__', '  '].join('\n')
    expect(endsWithQuestion(`할까요?\n1\n2\n3\n4\n5\n${fence}`)).toBe(true)
    expect(endsWithQuestion('**진행할까요?**')).toBe(true)
    expect(endsWithQuestion('확인 부탁드립니다\r\n`?`')).toBe(true)
  })
})
