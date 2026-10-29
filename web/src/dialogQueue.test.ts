import { describe, expect, it, vi } from 'vitest'
import { cancelAnswer, createDialogQueue } from './dialogQueue'

describe('createDialogQueue', () => {
  it('비어 있으면 current 는 null', () => {
    expect(createDialogQueue().current()).toBeNull()
  })

  it('겹쳐 부르면 부른 차례로 하나씩 보이고 각자 자기 답을 받는다', async () => {
    const queue = createDialogQueue()
    const first = queue.open('confirm', '첫째', { isDanger: true })
    const second = queue.open('prompt', '둘째', { defaultValue: 'a' })
    const shown = queue.current()
    expect(shown).toMatchObject({ kind: 'confirm', message: '첫째', isDanger: true })
    queue.close(shown!.id, true)
    expect(queue.current()).toMatchObject({ kind: 'prompt', message: '둘째', defaultValue: 'a' })
    queue.close(queue.current()!.id, 'b')
    expect(queue.current()).toBeNull()
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe('b')
  })

  it('맨 앞이 아닌 id·이미 닫은 id 로 닫으면 아무것도 안 한다', async () => {
    const queue = createDialogQueue()
    const first = queue.open('alert', '하나')
    void queue.open('alert', '둘')
    const firstId = queue.current()!.id
    queue.close(firstId + 1, null)
    expect(queue.current()!.message).toBe('하나')
    queue.close(firstId, null)
    queue.close(firstId, null)
    expect(queue.current()!.message).toBe('둘')
    await expect(first).resolves.toBeNull()
  })

  it('바뀔 때마다 구독자를 부르고, 같은 동안은 같은 객체를 준다', () => {
    const queue = createDialogQueue()
    const listener = vi.fn()
    const unsubscribe = queue.subscribe(listener)
    void queue.open('alert', '하나')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(queue.current()).toBe(queue.current())
    queue.close(queue.current()!.id, null)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    void queue.open('alert', '둘')
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('cancelAnswer', () => {
  it('confirm 은 false, prompt·alert 는 null', () => {
    expect(cancelAnswer('confirm')).toBe(false)
    expect(cancelAnswer('prompt')).toBeNull()
    expect(cancelAnswer('alert')).toBeNull()
    expect(cancelAnswer('choice')).toBeNull()
  })
})
