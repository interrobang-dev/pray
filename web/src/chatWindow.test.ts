import { describe, expect, it } from 'vitest'
import type { ChatRow } from './chatRows'
import { expandedStartIndex, RENDER_STEP, resolveStartIndex, REVEAL_MARGIN, startIndexRevealing, windowStartAt } from './chatWindow'
import type { ChatMessage } from './types'

const rowsOf = (count: number, prefix = 'm'): ChatRow<never>[] =>
  Array.from({ length: count }, (_, index): ChatRow<never> => {
    const message: ChatMessage = { id: `${prefix}${index}`, role: 'user', timestamp: '', text: '', toolUses: [] }
    return { kind: 'message', message }
  })

describe('resolveStartIndex', () => {
  it('정하지 않았으면 최근 RENDER_STEP 줄', () => {
    expect(resolveStartIndex(rowsOf(1000), null)).toBe(1000 - RENDER_STEP)
    expect(resolveStartIndex(rowsOf(20), null)).toBe(0)
  })

  it('새 줄이 붙어도 같은 키의 줄에서 시작', () => {
    const rows = rowsOf(1000)
    const start = windowStartAt(rows, 850)
    expect(resolveStartIndex([...rows, ...rowsOf(5, 'n')], start)).toBe(850)
  })

  it('키가 사라지면 기억한 번호 (줄 수 안으로)', () => {
    const start = windowStartAt(rowsOf(1000), 850)
    expect(resolveStartIndex(rowsOf(1000, 'x'), start)).toBe(850)
    expect(resolveStartIndex(rowsOf(10, 'x'), start)).toBe(9)
  })
})

describe('expandedStartIndex · startIndexRevealing', () => {
  it('위로 RENDER_STEP 줄 더, 0 아래로는 안 간다', () => {
    expect(expandedStartIndex(400)).toBe(400 - RENDER_STEP)
    expect(expandedStartIndex(30)).toBe(0)
  })

  it('안 그린 줄이면 그 위 REVEAL_MARGIN 줄부터, 그린 줄·없는 줄이면 그대로', () => {
    expect(startIndexRevealing(800, 300)).toBe(300 - REVEAL_MARGIN)
    expect(startIndexRevealing(800, 5)).toBe(0)
    expect(startIndexRevealing(800, 900)).toBe(800)
    expect(startIndexRevealing(800, -1)).toBe(800)
  })
})
