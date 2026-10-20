import { describe, expect, it } from 'vitest'
import { ACK_TIMEOUT_MS, TaskConflictError, TaskStore } from './teamState.js'

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
})
