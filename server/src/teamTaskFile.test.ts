import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ACK_TIMEOUT_MS,
  RESTORED_CUT_ERROR,
  RESTORED_GONE_ERROR,
  restoredOutcome,
  TaskStore,
  type RestoredMember,
} from './teamState.js'
import {
  EVENT_RETENTION_MS,
  parseTeamTaskData,
  readTeamTaskFile,
  TASK_RETENTION_MS,
  TeamTaskLog,
  writeTeamTaskFile,
} from './teamTaskFile.js'

const DAY = 24 * 60 * 60 * 1000

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pray-team-tasks-'))
  path = join(dir, 'team-tasks.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const hook = (session_id: string, hook_event_name: string, last_assistant_message?: string) => ({
  session_id,
  cwd: 'D:/x',
  hook_event_name,
  last_assistant_message,
})

/** 파일에 저장하는 store + log. clock 으로 시각을 움직인다 */
function makeServer(clock: { ms: number }, logs: string[] = []) {
  const now = () => new Date(clock.ms)
  const store: TaskStore = new TaskStore(now, { onChange: () => log.save() })
  const log: TeamTaskLog = new TeamTaskLog(path, store, now, (line) => logs.push(line))
  log.load()
  return { store, log }
}

const alive = (turnEndedAt: string | null, turn: RestoredMember['turn']): RestoredMember => ({ isAlive: true, turnEndedAt, turn })

describe('restoredOutcome', () => {
  const task = { createdAt: '2026-10-31T10:00:00.000Z', isAcknowledged: false }

  it('fails when the member is not on duty or not in the list', () => {
    expect(restoredOutcome(task, null)).toEqual({ status: 'failed', error: RESTORED_GONE_ERROR })
    expect(restoredOutcome(task, { isAlive: false, turnEndedAt: '2026-10-31T10:05:00Z', turn: { kind: 'ended', text: 'x' } })).toEqual({
      status: 'failed',
      error: RESTORED_GONE_ERROR,
    })
  })

  it('takes the turn after the instruction from jsonl', () => {
    expect(restoredOutcome(task, alive('2026-10-31T10:05:00Z', { kind: 'ended', text: '끝' }))).toEqual({ status: 'done', result: '끝' })
    expect(restoredOutcome(task, alive('2026-10-31T10:05:00Z', { kind: 'ended', text: null }))).toEqual({ status: 'done', result: '' })
    expect(restoredOutcome(task, alive('2026-10-31T10:05:00Z', { kind: 'cut', text: null }))).toEqual({ status: 'failed', error: RESTORED_CUT_ERROR })
    expect(restoredOutcome(task, alive('2026-10-31T10:05:00Z', { kind: 'interrupted', text: null }))).toEqual({
      status: 'failed',
      error: RESTORED_CUT_ERROR,
    })
    expect(restoredOutcome(task, alive('2026-10-31T10:05:00Z', { kind: 'in-progress', text: null }))).toEqual({
      status: 'running',
      isAcknowledged: true,
    })
  })

  it('keeps running when jsonl has nothing after the instruction (an earlier turn ended)', () => {
    expect(restoredOutcome(task, alive('2026-10-31T09:59:00Z', { kind: 'ended', text: '옛 차례' }))).toEqual({
      status: 'running',
      isAcknowledged: false,
    })
    expect(restoredOutcome(task, alive(null, null))).toEqual({ status: 'running', isAcknowledged: false })
  })
})

describe('TeamTaskLog', () => {
  it('starts empty without a file and writes nothing until something changes', () => {
    const { store } = makeServer({ ms: 0 })
    expect(store.list()).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('keeps tasks across a restart: a finished, undelivered result still reaches the next wait', async () => {
    const clock = { ms: Date.parse('2026-10-31T10:00:00Z') }
    const first = makeServer(clock)
    const task = first.store.assign('t1', 'm1', '조사해', null, { contextTokens: 1200, idleSince: '2026-10-31T09:00:00Z' })
    first.store.applyHook(hook('m1', 'UserPromptSubmit'))
    first.store.applyHook(hook('m1', 'Stop', '결과'))
    first.store.setEndContextTokens(task.id, 5400)

    const second = makeServer(clock)
    expect(second.store.latestOf('m1')).toMatchObject({ id: task.id, status: 'done', result: '결과' })
    expect(await second.store.wait('t1', null, 10)).toMatchObject({
      id: task.id,
      startContextTokens: 1200,
      startIdleSince: '2026-10-31T09:00:00Z',
      endContextTokens: 5400,
    })
    // 가져간 것도 저장돼 다음 재시작 뒤 아무 task wait 가 다시 주지 않는다
    const third = makeServer(clock)
    expect(await third.store.wait('t1', null, 10)).toBeNull()
    expect(third.store.get(task.id)?.isDelivered).toBe(true)
  })

  it('does not expire a restored running task before it is reconciled, then follows the jsonl turn', async () => {
    const clock = { ms: Date.parse('2026-10-31T10:00:00Z') }
    const first = makeServer(clock)
    const done = first.store.assign('t1', 'm1', 'A')
    const working = first.store.assign('t1', 'm2', 'B')
    const gone = first.store.assign('t1', 'm3', 'C')

    clock.ms += ACK_TIMEOUT_MS * 10
    const second = makeServer(clock)
    second.store.expireUnacknowledged()
    expect(second.store.list().every((t) => t.status === 'running')).toBe(true)
    const pending = second.store.wait('t1', done.id, 1000)
    const after = '2026-10-31T10:01:00Z'
    second.store.reconcileRestored((id) =>
      id === 'm1' ? alive(after, { kind: 'ended', text: 'A 끝' }) : id === 'm2' ? alive(after, { kind: 'in-progress', text: null }) : null,
    )
    expect(await pending).toMatchObject({ id: done.id, status: 'done', result: 'A 끝' })
    expect(second.store.get(gone.id)).toMatchObject({ status: 'failed', error: RESTORED_GONE_ERROR })
    expect(second.store.get(working.id)).toMatchObject({ status: 'running', isAcknowledged: true })
    expect(second.store.hasUnreconciled()).toBe(false)
    // 접수된 것으로 봤으니 시간 초과로 안 끝나고 다음 Stop 이 평소처럼 끝낸다
    second.store.expireUnacknowledged()
    second.store.applyHook(hook('m2', 'Stop', 'B 끝'))
    expect(makeServer(clock).store.get(working.id)).toMatchObject({ status: 'done', result: 'B 끝' })
  })

  it('a Stop that arrives before reconciling finishes the restored task normally', () => {
    const clock = { ms: 0 }
    const task = makeServer(clock).store.assign('t1', 'm1', 'A')
    const second = makeServer(clock)
    second.store.applyHook(hook('m1', 'Stop', '끝'))
    second.store.reconcileRestored(() => null)
    expect(second.store.get(task.id)).toMatchObject({ status: 'done', result: '끝' })
  })

  it('a restored unacknowledged task with nothing in jsonl still expires after reconciling', () => {
    const clock = { ms: 0 }
    const task = makeServer(clock).store.assign('t1', 'm1', 'A')
    clock.ms += ACK_TIMEOUT_MS + 1
    const second = makeServer(clock)
    second.store.reconcileRestored(() => alive(null, null))
    second.store.expireUnacknowledged()
    expect(second.store.get(task.id)?.status).toBe('failed')
  })

  it('prunes finished tasks after 7 days and events after 30 days, keeping running tasks', () => {
    const clock = { ms: Date.parse('2026-10-01T00:00:00Z') }
    const first = makeServer(clock)
    const old = first.store.assign('t1', 'm1', 'old')
    first.store.applyHook(hook('m1', 'Stop', 'x'))
    const stillRunning = first.store.assign('t1', 'm2', 'running')
    first.log.record({ kind: 'spawn', teamId: 't1', partId: null, sessionId: 'm1', position: 'FE', model: 'sonnet', effort: null, contextTokens: null, idleSince: null })

    clock.ms += TASK_RETENTION_MS
    const atBoundary = makeServer(clock)
    expect(atBoundary.store.get(old.id)).toBeDefined()

    clock.ms += 1
    const later = makeServer(clock)
    expect(later.store.get(old.id)).toBeUndefined()
    expect(later.store.get(stillRunning.id)).toBeDefined()
    expect(later.log.listEvents()).toHaveLength(1)

    clock.ms = Date.parse('2026-10-01T00:00:00Z') + EVENT_RETENTION_MS + 1
    later.log.save()
    expect(later.log.listEvents()).toEqual([])
    const saved = JSON.parse(readFileSync(path, 'utf8'))
    expect(saved.events).toEqual([])
    expect(saved.tasks.map((t: { id: string }) => t.id)).toEqual([stillRunning.id])
  })

  it('records spawn and dismiss events with the time', () => {
    const clock = { ms: Date.parse('2026-10-31T10:00:00Z') }
    const { log } = makeServer(clock)
    log.record({ kind: 'spawn', teamId: 't1', partId: 'p1', sessionId: 'm1', position: 'BE', model: 'opus', effort: 'high', contextTokens: null, idleSince: null })
    clock.ms += 1000
    log.record({
      kind: 'dismiss',
      teamId: 't1',
      partId: 'p1',
      sessionId: 'm1',
      position: 'BE',
      model: 'claude-opus-5-5',
      effort: 'high',
      contextTokens: 160_000,
      idleSince: '2026-10-31T09:00:00Z',
    })
    const events = makeServer(clock).log.listEvents()
    expect(events.map((e) => [e.kind, e.at])).toEqual([
      ['spawn', '2026-10-31T10:00:00.000Z'],
      ['dismiss', '2026-10-31T10:00:01.000Z'],
    ])
    expect(events[1]).toMatchObject({ contextTokens: 160_000, idleSince: '2026-10-31T09:00:00Z' })
  })

  it('starts empty and moves a broken file aside instead of throwing', () => {
    writeFileSync(path, '{ broken')
    const logs: string[] = []
    const { store } = makeServer({ ms: Date.parse('2026-10-31T10:00:00Z') }, logs)
    expect(store.list()).toEqual([])
    expect(logs[0]).toContain('깨져')
    expect(readdirSync(dir)).toEqual(['team-tasks.json.broken-2026-10-31T10-00-00-000Z'])
    store.assign('t1', 'm1', 'A')
    expect(parseTeamTaskData(readFileSync(path, 'utf8')).tasks).toHaveLength(1)
  })

  it('logs a failed save once and does not throw', () => {
    const logs: string[] = []
    // 파일 자리에 폴더가 있어 rename 이 실패한다
    const blocked = join(dir, 'blocked')
    writeTeamTaskFile(join(blocked, 'x.json'), { version: 1, tasks: [], events: [] })
    const store = new TaskStore(() => new Date(0), { onChange: () => log.save() })
    const log = new TeamTaskLog(blocked, store, () => new Date(0), (line) => logs.push(line))
    store.assign('t1', 'm1', 'A')
    store.applyHook(hook('m1', 'Stop', 'x'))
    expect(logs.filter((line) => line.includes('저장 실패'))).toHaveLength(1)
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('parseTeamTaskData', () => {
  it('drops malformed entries and fills fields an old file lacks', () => {
    const data = parseTeamTaskData(
      JSON.stringify({
        tasks: [
          { id: 'a', teamId: 't', partId: null, memberSessionId: 'm', instruction: 'i', status: 'done', createdAt: 'c', finishedAt: 'f', result: 'r' },
          { id: 'b', status: 'weird' },
          null,
        ],
        events: [{ kind: 'other' }],
      }),
    )
    expect(data.tasks).toEqual([
      expect.objectContaining({ id: 'a', isDelivered: false, startContextTokens: null, startIdleSince: null, endContextTokens: null }),
    ])
    expect(data.events).toEqual([])
    expect(() => parseTeamTaskData('[]')).toThrow()
  })

  it('reads a missing file as empty without a warning', () => {
    expect(readTeamTaskFile(join(dir, 'none.json'))).toEqual({ data: { version: 1, tasks: [], events: [] }, warning: null })
  })
})
