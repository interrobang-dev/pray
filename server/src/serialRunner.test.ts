import { describe, expect, it } from 'vitest'
import { serialRunner } from './serialRunner.js'

/** 밖에서 풀 수 있는 Promise */
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

/** 시작할 때 상태를 읽고, 밖에서 풀어 줄 때까지 기다렸다가 읽은 값을 보낸다 (broadcast 의 스냅숏 → 전송과 같은 꼴) */
function snapshotTask(read: () => number) {
  const sent: number[] = []
  const gates: ReturnType<typeof deferred>[] = []
  let calls = 0
  const task = async () => {
    calls += 1
    const value = read()
    const gate = deferred()
    gates.push(gate)
    await gate.promise
    sent.push(value)
  }
  return { task, sent, gates, calls: () => calls }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('serialRunner', () => {
  it('runs one at a time and reruns with the latest state, so the last result sent is the newest', async () => {
    let state = 1
    const t = snapshotTask(() => state)
    const run = serialRunner(t.task, () => {})

    const first = run()
    state = 2
    void run()
    state = 3
    const last = run()
    expect(t.calls()).toBe(1)

    t.gates[0].resolve()
    await flush()
    expect(t.calls()).toBe(2)
    t.gates[1].resolve()
    await last
    await first

    expect(t.sent).toEqual([1, 3])
  })

  it('merges many requests made during a run into one rerun', async () => {
    const t = snapshotTask(() => 0)
    const run = serialRunner(t.task, () => {})

    const done = run()
    for (let i = 0; i < 5; i++) void run()
    t.gates[0].resolve()
    await flush()
    t.gates[1].resolve()
    await done

    // 처음 1번 + 겹친 5번을 합친 1번
    expect(t.calls()).toBe(2)
  })

  it('runs immediately again when called after a run has finished', async () => {
    let calls = 0
    const run = serialRunner(async () => void (calls += 1), () => {})
    await run()
    await run()
    expect(calls).toBe(2)
  })

  it('passes a thrown error to onError and keeps serving the pending and later requests', async () => {
    const errors: unknown[] = []
    let calls = 0
    const gate = deferred()
    const run = serialRunner(async () => {
      calls += 1
      if (calls === 1) {
        await gate.promise
        throw new Error('boom')
      }
    }, (error) => errors.push(error))

    const first = run()
    const pending = run()
    gate.resolve()
    await expect(first).resolves.toBeUndefined()
    await pending
    expect(calls).toBe(2)
    expect(errors.map((e) => (e as Error).message)).toEqual(['boom'])

    await run()
    expect(calls).toBe(3)
  })
})
