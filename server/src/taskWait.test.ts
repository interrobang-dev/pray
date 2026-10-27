import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import compression from 'compression'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, parseWaitRequest, respondJsonAfter } from './taskWait.js'

describe('parseWaitRequest', () => {
  it('reads the path task, a taskIds list and the timeout', () => {
    expect(parseWaitRequest('any', {})).toEqual({ taskIds: null, timeoutSec: DEFAULT_WAIT_SECONDS })
    expect(parseWaitRequest('K1', { timeoutSec: '30' })).toEqual({ taskIds: ['K1'], timeoutSec: 30 })
    expect(parseWaitRequest('any', { taskIds: 'K1, K2,,K1', timeoutSec: '99999' })).toEqual({
      taskIds: ['K1', 'K2'],
      timeoutSec: MAX_WAIT_SECONDS,
    })
    expect(parseWaitRequest('K0', { taskIds: ['K1', 'K2'], timeoutSec: '0' })).toEqual({ taskIds: ['K0', 'K1', 'K2'], timeoutSec: 1 })
    expect(parseWaitRequest('any', { taskIds: '', timeoutSec: 'x' })).toEqual({ taskIds: null, timeoutSec: DEFAULT_WAIT_SECONDS })
  })
})

describe('respondJsonAfter', () => {
  let server: Server | null = null
  afterEach(() => {
    server?.closeAllConnections()
    server?.close()
    server = null
  })

  /** index.ts 와 같은 compression 설정 위에 work 하나를 거는 시험 서버 */
  async function start(work: (signal: AbortSignal) => Promise<unknown>): Promise<string> {
    const app = express()
    app.use(
      compression({
        filter: (req, res) =>
          !String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream') && compression.filter(req, res),
      }),
    )
    app.get('/wait', async (_req, res) => {
      await respondJsonAfter(res, work, 20)
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server!.once('listening', resolve))
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}/wait`
  }

  it('sends headers at once, streams spaces uncompressed while waiting, then ends with the JSON', async () => {
    let finish: (value: unknown) => void = () => {}
    const url = await start(() => new Promise((resolve) => (finish = resolve)))
    const response = await fetch(url, { headers: { 'Accept-Encoding': 'gzip, br' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    expect(response.headers.get('content-encoding')).toBeNull()
    const reader = response.body!.getReader()
    const firstChunk = await reader.read()
    expect(new TextDecoder().decode(firstChunk.value)).toMatch(/^ +$/)
    finish({ task: { id: 'K1' }, pendingTaskIds: [] })
    let rest = ''
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) rest += new TextDecoder().decode(chunk.value)
    expect(JSON.parse(rest)).toEqual({ task: { id: 'K1' }, pendingTaskIds: [] })
  })

  it('aborts the work when the client goes away', async () => {
    let workSignal: AbortSignal | null = null
    const url = await start(
      (signal) =>
        new Promise((resolve) => {
          workSignal = signal
          signal.addEventListener('abort', () => resolve(null))
        }),
    )
    const controller = new AbortController()
    const response = await fetch(url, { signal: controller.signal })
    expect(response.status).toBe(200)
    controller.abort()
    await expect.poll(() => workSignal?.aborted).toBe(true)
  })
})
