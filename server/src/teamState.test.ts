import { describe, expect, it } from 'vitest'
import { ACK_TIMEOUT_MS, INTERRUPTED_ERROR, TaskConflictError, TaskStore } from './teamState.js'

function makeStore(startMs = 0) {
  let nowMs = startMs
  const store = new TaskStore(() => new Date(nowMs))
  return { store, advance: (ms: number) => (nowMs += ms) }
}

const hook = (session_id: string, hook_event_name: string, last_assistant_message?: string) => ({
  session_id,
  cwd: 'D:/x',
  hook_event_name,
  last_assistant_message,
})

describe('TaskStore', () => {
  it('finishes a task on Stop with the last assistant message', async () => {
    const { store } = makeStore()
    const task = store.assign('t1', 'm1', '조사해')
    store.applyHook(hook('m1', 'UserPromptSubmit'))
    store.applyHook(hook('m1', 'Stop', '결과입니다'))
    expect(store.get(task.id)).toMatchObject({ status: 'done', result: '결과입니다', isAcknowledged: true })
    expect(await store.wait('t1', task.id, 10)).toMatchObject({ id: task.id, status: 'done' })
  })

  it('latestOf gives the newest task of that member across units', () => {
    const { store } = makeStore()
    expect(store.latestOf('m1')).toBeUndefined()
    const first = store.assign('t1', 'm1', '하나')
    store.applyHook(hook('m1', 'Stop', '끝'))
    store.assign('t1', 'm2', '다른 팀원')
    const second = store.assign('t1', 'm1', '둘', 'p1')
    expect(store.latestOf('m1')?.id).toBe(second.id)
    expect(store.get(first.id)?.status).toBe('done')
  })

  it('rejects a second assignment while one is running', () => {
    const { store } = makeStore()
    store.assign('t1', 'm1', 'a')
    expect(() => store.assign('t1', 'm1', 'b')).toThrow(TaskConflictError)
    expect(() => store.assign('t1', 'm2', 'b')).not.toThrow()
  })

  it('fails when the member never acknowledges', () => {
    const { store, advance } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    advance(ACK_TIMEOUT_MS - 1)
    store.expireUnacknowledged()
    expect(store.get(task.id)?.status).toBe('running')
    advance(2)
    store.expireUnacknowledged()
    expect(store.get(task.id)).toMatchObject({ status: 'failed', error: expect.stringContaining('받지 못함') })
  })

  it('does not expire an acknowledged task', () => {
    const { store, advance } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    store.applyHook(hook('m1', 'UserPromptSubmit'))
    advance(ACK_TIMEOUT_MS * 10)
    store.expireUnacknowledged()
    expect(store.get(task.id)?.status).toBe('running')
  })

  it('fails the running task when the member exits', () => {
    const { store } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    store.markExited('m1')
    expect(store.get(task.id)?.status).toBe('failed')
  })

  it('fails the running task when a person interrupts the member, waking the wait, and ignores a later Stop', async () => {
    const { store } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    store.applyHook(hook('m1', 'UserPromptSubmit'))
    const pending = store.wait('t1', task.id, 1000)
    store.markInterrupted('m1')
    expect(await pending).toMatchObject({ status: 'failed', error: INTERRUPTED_ERROR, result: null })
    store.applyHook(hook('m1', 'Stop', '대기 메시지 답'))
    expect(store.get(task.id)?.status).toBe('failed')
    // 다음 지시를 받을 수 있다
    expect(store.assign('t1', 'm1', 'b').status).toBe('running')
  })

  it('wakes a pending wait when the task finishes', async () => {
    const { store } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    const pending = store.wait('t1', task.id, 1000)
    store.applyHook(hook('m1', 'Stop', '끝'))
    expect(await pending).toMatchObject({ status: 'done', result: '끝' })
  })

  it('wait without taskId returns each finished task once', async () => {
    const { store } = makeStore()
    const a = store.assign('t1', 'm1', 'a')
    const b = store.assign('t1', 'm2', 'b')
    store.applyHook(hook('m2', 'Stop', 'b 끝'))
    expect((await store.wait('t1', null, 10))?.id).toBe(b.id)
    const pending = store.wait('t1', null, 1000)
    store.applyHook(hook('m1', 'Stop', 'a 끝'))
    expect((await pending)?.id).toBe(a.id)
    expect(await store.wait('t1', null, 10)).toBeNull()
  })

  it('returns null for unknown task or other team', async () => {
    const { store } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    expect(await store.wait('t1', 'nope', 10)).toBeNull()
    expect(await store.wait('t2', task.id, 10)).toBeNull()
  })

  it('keeps each unit (team direct, part) from taking the other unit results', async () => {
    const { store } = makeStore()
    const direct = store.assign('t1', 'm1', 'a')
    const part = store.assign('t1', 'm2', 'b', 'p1')
    expect(await store.wait('t1', part.id, 10)).toBeNull()
    const directWait = store.wait('t1', null, 1000)
    store.applyHook(hook('m2', 'Stop', '파트 끝'))
    expect((await store.wait('t1', null, 10, 'p1'))?.id).toBe(part.id)
    store.applyHook(hook('m1', 'Stop', '직속 끝'))
    expect((await directWait)?.id).toBe(direct.id)
    expect(store.listByUnit('t1').map((t) => t.id)).toEqual([direct.id])
    expect(store.listByUnit('t1', 'p1').map((t) => t.id)).toEqual([part.id])
  })

  it('waits on a list of tasks: gives the first to finish, then the next, and keeps the rest pending', async () => {
    const { store } = makeStore()
    const a = store.assign('t1', 'm1', 'a')
    const b = store.assign('t1', 'm2', 'b')
    const other = store.assign('t1', 'm3', 'c')
    expect(store.pendingIds('t1', [a.id, b.id])).toEqual([a.id, b.id])
    const first = store.wait('t1', [a.id, b.id], 1000)
    store.applyHook(hook('m3', 'Stop', '목록 밖'))
    store.applyHook(hook('m2', 'Stop', 'b 끝'))
    expect((await first)?.id).toBe(b.id)
    expect(store.pendingIds('t1', [a.id, b.id])).toEqual([a.id])
    // 목록 밖 task 는 아무 task wait 가 가져간다
    expect(store.pendingIds('t1', null)).toEqual([a.id, other.id])
    store.applyHook(hook('m1', 'Stop', 'a 끝'))
    expect((await store.wait('t1', [a.id, b.id], 10))?.id).toBe(a.id)
    expect(store.pendingIds('t1', [a.id, b.id])).toEqual([])
    // 다 가져간 목록은 null, 하나를 콕 집으면 다시 준다
    expect(await store.wait('t1', [a.id, b.id], 10)).toBeNull()
    expect((await store.wait('t1', a.id, 10))?.id).toBe(a.id)
  })

  it('gives a task finished before the wait at once, and a task taken by id is not given again to an any wait', async () => {
    const { store } = makeStore()
    const a = store.assign('t1', 'm1', 'a')
    const b = store.assign('t1', 'm2', 'b')
    store.applyHook(hook('m1', 'Stop', 'a 끝'))
    expect((await store.wait('t1', a.id, 10))?.id).toBe(a.id)
    store.applyHook(hook('m2', 'Stop', 'b 끝'))
    expect((await store.wait('t1', [a.id, b.id], 10))?.id).toBe(b.id)
    expect(await store.wait('t1', null, 10)).toBeNull()
  })

  it('ignores unknown and other-unit ids in a list', async () => {
    const { store } = makeStore()
    const part = store.assign('t1', 'm1', 'a', 'p1')
    expect(await store.wait('t1', ['nope', part.id], 10)).toBeNull()
    expect(store.pendingIds('t1', ['nope', part.id])).toEqual([])
    const direct = store.assign('t1', 'm2', 'b')
    const pending = store.wait('t1', ['nope', part.id, direct.id], 1000)
    store.applyHook(hook('m1', 'Stop', '파트 끝'))
    store.applyHook(hook('m2', 'Stop', '직속 끝'))
    expect((await pending)?.id).toBe(direct.id)
  })

  it('stops waiting when the signal aborts and leaves the task for the next wait', async () => {
    const { store } = makeStore()
    const task = store.assign('t1', 'm1', 'a')
    const controller = new AbortController()
    const pending = store.wait('t1', [task.id], 60_000, null, controller.signal)
    controller.abort()
    expect(await pending).toBeNull()
    store.applyHook(hook('m1', 'Stop', '끝'))
    expect(store.get(task.id)?.isDelivered).toBe(false)
    expect((await store.wait('t1', null, 10))?.id).toBe(task.id)
    expect(await store.wait('t1', [task.id], 10, null, AbortSignal.abort())).toMatchObject({ id: task.id })
  })
})
