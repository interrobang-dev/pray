import { describe, expect, it } from 'vitest'
import {
  contextGrowthText,
  durationText,
  eventDetailText,
  memberNameOf,
  taskDuration,
  taskStatusLabel,
  timelineRows,
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
