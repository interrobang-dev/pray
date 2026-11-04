import { describe, expect, it } from 'vitest'
import {
  contextGrowthText,
  durationText,
  eventDetailText,
  memberNameOf,
  taskDuration,
  taskStatusLabel,
  timelineRows,
  usageDetailText,
  usageMetaText,
  usageTotalOf,
  usageTotalText,
  type TaskHistoryItem,
  type TeamEventItem,
} from './teamTasks'

const task = (id: string, createdAt: string): TaskHistoryItem => ({
  id,
  partId: null,
  memberSessionId: 'abcdef1234',
  memberName: 'Jisoo',
  memberPosition: 'FE',
  status: 'done',
  isAcknowledged: true,
  createdAt,
  finishedAt: null,
  startContextTokens: null,
  endContextTokens: null,
  usage: null,
  model: null,
  instruction: '지시',
  isInstructionClipped: false,
  error: null,
  hasResult: true,
})

const event = (at: string, fields: Partial<TeamEventItem> = {}): TeamEventItem => ({
  kind: 'spawn',
  at,
  partId: null,
  sessionId: 'abcdef1234',
  position: 'FE',
  model: null,
  effort: null,
  contextTokens: null,
  idleSince: null,
  memberName: 'Jisoo',
  ...fields,
})

describe('timelineRows', () => {
  it('mixes tasks and member events newest first, an event at the same time below the task', () => {
    const rows = timelineRows({
      tasks: [task('b', '2026-10-31T02:00:00Z'), task('a', '2026-10-31T01:00:00Z')],
      events: [event('2026-10-31T03:00:00Z', { kind: 'dismiss' }), event('2026-10-31T01:00:00Z')],
    })
    expect(rows.map((row) => (row.kind === 'task' ? row.task.id : row.event.kind))).toEqual(['dismiss', 'b', 'a', 'spawn'])
  })
})

describe('taskStatusLabel', () => {
  it('names the three states and a not yet received instruction', () => {
    expect(taskStatusLabel({ status: 'done', isAcknowledged: true })).toBe('Done')
    expect(taskStatusLabel({ status: 'failed', isAcknowledged: false })).toBe('Failed')
    expect(taskStatusLabel({ status: 'running', isAcknowledged: true })).toBe('Running')
    expect(taskStatusLabel({ status: 'running', isAcknowledged: false })).toBe('Sent')
  })
})

describe('durationText', () => {
  it('uses the largest two units', () => {
    expect(durationText(-5)).toBe('0s')
    expect(durationText(45_000)).toBe('45s')
    expect(durationText(12 * 60_000 + 30_000)).toBe('12m')
    expect(durationText(60 * 60_000)).toBe('1h')
    expect(durationText(65 * 60_000)).toBe('1h 5m')
    expect(durationText(51 * 3600_000)).toBe('2d 3h')
    expect(durationText(48 * 3600_000)).toBe('2d')
  })

  it('measures a running task up to now', () => {
    const now = new Date('2026-10-31T01:04:00Z').getTime()
    expect(taskDuration({ createdAt: '2026-10-31T01:00:00Z', finishedAt: null }, now)).toBe('4m')
    expect(taskDuration({ createdAt: '2026-10-31T01:00:00Z', finishedAt: '2026-10-31T01:00:30Z' }, now)).toBe('30s')
  })
})

describe('contextGrowthText', () => {
  it('shows start → end with the context size text', () => {
    expect(contextGrowthText(12_300, 98_400, false)).toBe('12k → 98k')
    expect(contextGrowthText(null, 45_000, false)).toBe('new → 45k')
    expect(contextGrowthText(12_300, null, true)).toBe('12k → …')
    expect(contextGrowthText(12_300, null, false)).toBe('12k → ?')
    expect(contextGrowthText(null, null, false)).toBeNull()
  })
})

describe('memberNameOf', () => {
  it('falls back to the id head when the session left the list', () => {
    expect(memberNameOf('Jisoo', 'abcdef1234')).toBe('Jisoo')
    expect(memberNameOf(null, 'abcdef1234')).toBe('Member abcdef12')
  })
})

describe('eventDetailText', () => {
  it('shows the chosen model and effort for a spawn', () => {
    expect(eventDetailText(event('2026-10-31T01:00:00Z', { model: 'sonnet', effort: 'high' }))).toBe('sonnet · high')
    expect(eventDetailText(event('2026-10-31T01:00:00Z'))).toBe('')
  })

  it('shows model alias, context and idle time for a dismiss', () => {
    const dismiss = event('2026-10-31T02:12:00Z', { kind: 'dismiss', model: 'claude-opus-5-5', contextTokens: 143_254, idleSince: '2026-10-31T01:00:00Z' })
    expect(eventDetailText(dismiss)).toBe('opus · 143k · idle 1h 12m')
  })
})

describe('usage text', () => {
  const usage = { inputTokens: 12_345, outputTokens: 48_000, cacheCreationTokens: 1_234, cacheReadTokens: 1_200_000, turns: 7 }

  it('gives the meta line with the model alias, output and all input', () => {
    expect(usageMetaText(usage, 'claude-opus-5-5')).toBe('Opus · 48k out · 1.2M in · 99% cached')
    expect(usageMetaText(usage, 'some-model')).toBe('some-model · 48k out · 1.2M in · 99% cached')
    expect(usageMetaText(usage, null)).toBe('48k out · 1.2M in · 99% cached')
    expect(usageMetaText(null, 'claude-opus-5-5')).toBeNull()
    // 입력이 0 이면 캐시율을 뺀다
    expect(usageMetaText({ ...usage, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }, null)).toBe('48k out · 0 in')
  })

  it('gives the four counts and responses for the tooltip', () => {
    expect(usageDetailText(usage)).toBe('Input 12,345 · Cache write 1,234 · Cache read 1,200,000 · Output 48,000 · 99% cached · 7 responses')
    expect(usageDetailText({ ...usage, turns: 1 })).toMatch(/· 1 response$/)
  })

  it('totals finished tasks with usage, counts the rest, and skips running ones', () => {
    const tasks = [
      { status: 'done' as const, usage },
      { status: 'failed' as const, usage: { ...usage, outputTokens: 2_000 } },
      { status: 'done' as const, usage: null },
      { status: 'running' as const, usage: null },
    ]
    const total = usageTotalOf(tasks)
    expect([total.withUsage, total.withoutUsage, total.usage.outputTokens, total.usage.turns]).toEqual([2, 1, 50_000, 14])
    expect(usageTotalText(total)).toBe('2 tasks · 50k out · 2.4M in · 99% cached (1 without usage)')
    expect(usageTotalText(usageTotalOf(tasks.slice(0, 1)))).toBe('1 task · 48k out · 1.2M in · 99% cached')
    expect(usageTotalText(usageTotalOf(tasks.slice(2)))).toBe('1 task without usage')
    expect(usageTotalText(usageTotalOf([]))).toBeNull()
  })
})
