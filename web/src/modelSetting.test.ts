import { describe, expect, it } from 'vitest'
import type { Shell } from './types'
import { blockReason, initialChoice, isChanged, modelAlias, nextLabel, noticeLines } from './modelSetting'

const NOW = Date.parse('2026-10-26T12:00:00.000Z')
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

describe('modelAlias', () => {
  it('모델 ID 에서 별칭을 뽑고 모르면 null', () => {
    expect(modelAlias('claude-opus-5-5')).toBe('opus')
    expect(modelAlias('claude-fable-5-1')).toBe('fable')
    expect(modelAlias('claude-3-opus')).toBeNull()
    expect(modelAlias('gpt')).toBeNull()
    expect(modelAlias(null)).toBeNull()
  })
})

describe('initialChoice', () => {
  it('설정이 없으면 지금 모델·effort, effort 가 없으면 Auto', () => {
    expect(initialChoice({ model: 'claude-opus-5-5', effort: 'xhigh' })).toEqual({ model: 'opus', effort: 'xhigh' })
    expect(initialChoice({ model: 'claude-sonnet-5-5', effort: null })).toEqual({ model: 'sonnet', effort: 'auto' })
    expect(initialChoice({ model: null, effort: null })).toEqual({ model: null, effort: 'auto' })
  })
  it('저장된 설정이 칸마다 먼저고 null 칸은 지금 값으로', () => {
    expect(initialChoice({ model: 'claude-opus-5-5', effort: 'high', modelSetting: { model: 'haiku', effort: 'low' } })).toEqual({ model: 'haiku', effort: 'low' })
    expect(initialChoice({ model: 'claude-opus-5-5', effort: 'high', modelSetting: { model: 'haiku', effort: null } })).toEqual({ model: 'haiku', effort: 'high' })
    expect(initialChoice({ model: 'claude-opus-5-5', effort: 'high', modelSetting: null })).toEqual({ model: 'opus', effort: 'high' })
  })
})

describe('nextLabel', () => {
  const current = { model: 'claude-opus-5-5', effort: 'xhigh' }
  it('설정이 없거나 지금과 같으면 null', () => {
    expect(nextLabel({ ...current })).toBeNull()
    expect(nextLabel({ ...current, modelSetting: { model: 'opus', effort: 'xhigh' } })).toBeNull()
    expect(nextLabel({ ...current, modelSetting: { model: null, effort: null } })).toBeNull()
  })
  it('다르면 다음 값', () => {
    expect(nextLabel({ ...current, modelSetting: { model: 'sonnet', effort: 'high' } })).toBe('Sonnet · high')
    expect(nextLabel({ ...current, modelSetting: { model: null, effort: 'max' } })).toBe('Opus · max')
  })
})

describe('blockReason', () => {
  const idle = { status: 'my-turn' as const, pendingTool: null as string | null, question: null, shells: [] as Shell[] }
  it('막을 이유가 없으면 null', () => {
    expect(blockReason({ ...idle }, false)).toBeNull()
    expect(blockReason({ status: 'idle', pendingTool: null, shells: [] }, false)).toBeNull()
  })
  it('작업 중·승인 대기·질문 중', () => {
    expect(blockReason({ ...idle, status: 'working' }, false)).toBe('Wait until claude finishes')
    expect(blockReason({ ...idle, status: 'needs-approval' }, false)).toBe('Wait until claude finishes')
    expect(blockReason({ ...idle, pendingTool: 'AskUserQuestion' }, false)).toBe('Wait until claude finishes')
  })
  it('대기 메시지, shell', () => {
    expect(blockReason({ ...idle }, true)).toBe('Cancel or wait for the queued message')
    const shell = { id: 'b1', command: 'x', description: null, startedAt: '' }
    expect(blockReason({ ...idle, shells: [shell] }, false)).toBe('Wait for the running shells to finish')
  })
})

describe('noticeLines', () => {
  const initial = { model: 'opus', effort: 'xhigh' } as const
  const restart = 'The session restarts for a few seconds.'
  it('모델이 바뀌고 60분 안이면 다시 읽기 경고 + 토큰', () => {
    const lines = noticeLines({ role: null, turnEndedAt: minutesAgo(10), contextTokens: 182_000 }, initial, { model: 'sonnet', effort: 'xhigh' }, NOW)
    expect(lines).toEqual(['Switching model re-reads the whole conversation on the next turn (~182k tokens).', restart])
  })
  it('문맥 크기를 모르면 숫자 없이, 차례 시각을 몰라도 경고', () => {
    expect(noticeLines({ role: null, turnEndedAt: minutesAgo(10), contextTokens: null }, initial, { model: 'sonnet', effort: 'xhigh' }, NOW)[0]).toBe(
      'Switching model re-reads the whole conversation on the next turn.',
    )
    expect(noticeLines({ role: null, turnEndedAt: null }, initial, { model: 'sonnet', effort: 'xhigh' }, NOW)).toHaveLength(2)
  })
  it('60분이 지났으면 경고 없이 재시작 안내만', () => {
    expect(noticeLines({ role: null, turnEndedAt: minutesAgo(60), contextTokens: 1 }, initial, { model: 'sonnet', effort: 'xhigh' }, NOW)).toEqual([restart])
  })
  it('effort 만 바뀌면 캐시 유지', () => {
    expect(noticeLines({ role: null, turnEndedAt: minutesAgo(1) }, initial, { model: 'opus', effort: 'low' }, NOW)).toEqual(['Effort changes keep the prompt cache.', restart])
  })
  it('팀장·파트장이면 도구 재시작 안내', () => {
    const lines = noticeLines({ role: 'lead', turnEndedAt: minutesAgo(1) }, initial, { model: 'opus', effort: 'low' }, NOW)
    expect(lines.at(-1)).toBe('Its team tools restart too; a background jk_wait stops and has to be called again.')
  })
})

describe('isChanged', () => {
  it('모델 또는 effort 가 다르면 true', () => {
    expect(isChanged({ model: 'opus', effort: 'auto' }, { model: 'opus', effort: 'auto' })).toBe(false)
    expect(isChanged({ model: 'opus', effort: 'auto' }, { model: 'opus', effort: 'low' })).toBe(true)
  })
})
