import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FLOW_KEY_MISSING_MESSAGE,
  FlowError,
  INITIAL_FLOW_STATUS,
  koreanDateTimeToIso,
  makeFlowClient,
  makeFlowPoller,
  UNCHECKED_FLOW_STATUS,
  readFlowKey,
  type FlowFetch,
  type FlowStatus,
} from './flow.js'

const KEY = 'test-key-123'

interface Call {
  method: string
  url: URL
  headers: Record<string, string>
  body: unknown
}

/** 경로(쿼리 제외) → 응답을 만드는 함수. 부른 요청을 calls 에 남긴다 */
function fakeFetch(routes: Record<string, (url: URL, body: unknown) => Response>) {
  const calls: Call[] = []
  const doFetch: FlowFetch = async (input, init) => {
    const url = new URL(input)
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body })
    const route = routes[`${init.method ?? 'GET'} ${url.pathname}`]
    if (!route) throw new Error(`no route ${init.method} ${url.pathname}`)
    return route(url, body)
  }
  return { doFetch, calls }
}

function ok(data: unknown): Response {
  return Response.json({ response: { success: true, code: 200, message: 'success', data } })
}

function fail(status: number, message: string): Response {
  return Response.json(
    { response: { success: false, code: status, message: 'error', error: { code: 'X', message } } },
    { status },
  )
}

function rawAlarm(alarmId: string, projectId: string, overrides: Record<string, unknown> = {}) {
  return {
    alarmId,
    projectId,
    postId: '100',
    remarkId: '-1',
    replyId: '-1',
    receiverId: 'receiver',
    registerId: 'writer',
    registerName: '작성자',
    registeredDateTime: '20261022181017',
    message: null,
    content: '본문',
    readYn: 'N',
    alarmType: null,
    mentionYn: 'Y',
    registrantYn: 'N',
    workerYn: 'N',
    ...overrides,
  }
}

/** 알림 n 개를 cursor(순번) 쪽으로 나눠 주는 가짜 /user/alarms. 마지막 쪽의 lastCursor 는 -1 */
function alarmsRoute(total: number) {
  return (url: URL) => {
    const cursor = Number(url.searchParams.get('cursor') ?? 0)
    const size = Number(url.searchParams.get('size'))
    const items = Array.from({ length: Math.max(0, Math.min(size, total - cursor)) }, (_, i) => rawAlarm(String(cursor + i), '1'))
    const hasNext = cursor + size < total
    return ok({ alarms: { hasNext, lastCursor: hasNext ? cursor + size : -1, alarms: items } })
  }
}

/** 채팅방 목록. cursor 는 쪽 번호 */
function chatsRoute(pages: number[][]) {
  return (url: URL) => {
    const page = Number(url.searchParams.get('cursor') ?? 0)
    const hasNext = page + 1 < pages.length
    return ok({
      hasNext,
      lastCursor: hasNext ? page + 1 : -1,
      chatRooms: pages[page].map((unreadCount, i) => ({ roomId: `${page}-${i}`, type: '1', unreadCount })),
    })
  }
}

let base: string
let keyPath: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'jk-flow-'))
  keyPath = join(base, 'flow-key.env')
  writeFileSync(keyPath, `# 주석\nFLOW_API_KEY=${KEY}\n`)
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('readFlowKey', () => {
  it('reads the FLOW_API_KEY line', async () => {
    writeFileSync(keyPath, `﻿OTHER=1\r\nFLOW_API_KEY= ${KEY} \r\n`)
    expect(await readFlowKey(keyPath)).toBe(KEY)
  })

  it('is null without the file, the line or a value', async () => {
    expect(await readFlowKey(join(base, 'missing.env'))).toBeNull()
    writeFileSync(keyPath, 'OTHER=1\n')
    expect(await readFlowKey(keyPath)).toBeNull()
    writeFileSync(keyPath, 'FLOW_API_KEY=\n')
    expect(await readFlowKey(keyPath)).toBeNull()
  })
})

describe('koreanDateTimeToIso', () => {
  it('converts YYYYMMDDHHmmss in Korean time', () => {
    expect(koreanDateTimeToIso('20261022181017')).toBe('2026-10-22T18:10:17+09:00')
    expect(new Date(koreanDateTimeToIso('20261022081017')!).toISOString()).toBe('2026-10-21T23:10:17.000Z')
    expect(koreanDateTimeToIso('2026-10-22')).toBeNull()
  })
})

describe('flow client', () => {
  it('sends the key header and relays a page with project names', async () => {
    const { doFetch, calls } = fakeFetch({
      'GET /user/alarms': () =>
        ok({
          alarms: {
            hasNext: true,
            lastCursor: 50,
            alarms: [rawAlarm('9', '1', { readYn: 'Y', message: '댓글', remarkId: '5' }), rawAlarm('8', '404')],
          },
        }),
      'GET /user/projects/participants': () => ok({ projects: [{ projectId: '1', title: '프로젝트 하나', projectUrl: 'u' }] }),
    })
    const client = makeFlowClient({ fetch: doFetch, keyPath })
    const page = await client.listAlarms({ readYn: 'N', cursor: '0' })

    expect(calls[0].url.origin).toBe('https://api.flow.team')
    expect(calls[0].headers['x-flow-api-key']).toBe(KEY)
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ readYn: 'N', cursor: '0', size: '50' })
    expect(page.hasNext).toBe(true)
    expect(page.nextCursor).toBe('50')
    expect(page.alarms[0]).toEqual({
      alarmId: '9',
      projectId: '1',
      projectName: '프로젝트 하나',
      postId: '100',
      remarkId: '5',
      replyId: '-1',
      registerId: 'writer',
      registerName: '작성자',
      registeredDateTime: '20261022181017',
      registeredAt: '2026-10-22T18:10:17+09:00',
      message: '댓글',
      content: '본문',
      isRead: true,
      isMention: true,
      isWorker: false,
      isRegistrant: false,
    })
    expect(page.alarms[1].projectName).toBeNull()
  })

  it('omits readYn and cursor when not given, and nextCursor is null on the last page', async () => {
    const { doFetch, calls } = fakeFetch({
      'GET /user/alarms': () => ok({ alarms: { hasNext: false, lastCursor: -1, alarms: [] } }),
    })
    const page = await makeFlowClient({ fetch: doFetch, keyPath }).listAlarms({})
    expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({ size: '50' })
    expect(page).toEqual({ alarms: [], hasNext: false, nextCursor: null })
    // 알림이 없으면 프로젝트 목록을 받지 않는다
    expect(calls).toHaveLength(1)
  })

  it('caches project names and refetches for an unknown id at most once a minute', async () => {
    let now = 0
    let alarmProjects = ['1']
    const { doFetch, calls } = fakeFetch({
      'GET /user/alarms': () =>
        ok({ alarms: { hasNext: false, lastCursor: -1, alarms: alarmProjects.map((id, i) => rawAlarm(String(i), id)) } }),
      'GET /user/projects/participants': () =>
        ok({ projects: [{ projectId: '1', title: 'A' }, { projectId: '2', title: 'B' }] }),
    })
    const client = makeFlowClient({ fetch: doFetch, keyPath, now: () => now })
    const projectCalls = () => calls.filter((call) => call.url.pathname === '/user/projects/participants').length

    await client.listAlarms({})
    await client.listAlarms({})
    expect(projectCalls()).toBe(1)

    alarmProjects = ['3']
    now = 30_000
    expect((await client.listAlarms({})).alarms[0].projectName).toBeNull()
    expect(projectCalls()).toBe(1)
    now = 60_000
    await client.listAlarms({})
    expect(projectCalls()).toBe(2)
  })

  it('counts unread alarms to the last page and stops on hasNext', async () => {
    const { doFetch, calls } = fakeFetch({ 'GET /user/alarms': alarmsRoute(230) })
    const client = makeFlowClient({ fetch: doFetch, keyPath })
    expect(await client.countUnreadAlarms()).toBe(230)
    expect(calls.map((call) => call.url.searchParams.get('cursor'))).toEqual([null, '100', '200'])
    expect(calls.every((call) => call.url.searchParams.get('readYn') === 'N' && call.url.searchParams.get('size') === '100')).toBe(true)
  })

  it('counts zero unread alarms in one request', async () => {
    const { doFetch, calls } = fakeFetch({ 'GET /user/alarms': alarmsRoute(0) })
    expect(await makeFlowClient({ fetch: doFetch, keyPath }).countUnreadAlarms()).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('sums unread chat counts across pages', async () => {
    const { doFetch, calls } = fakeFetch({ 'GET /user/chats': chatsRoute([[0, 3], [2, 0, 1]]) })
    expect(await makeFlowClient({ fetch: doFetch, keyPath }).countUnreadChats()).toBe(6)
    expect(calls.map((call) => call.url.searchParams.get('cursor'))).toEqual([null, '1'])
  })

  it('sends PATCH bodies for read and read all', async () => {
    const { doFetch, calls } = fakeFetch({
      'PATCH /user/alarms/read': () => ok({}),
      'PATCH /user/alarms/read/all': () => ok({}),
    })
    const client = makeFlowClient({ fetch: doFetch, keyPath })
    await client.readAlarm('77')
    await client.readAllAlarms()
    expect(calls.map((call) => [call.method, call.url.pathname, call.body])).toEqual([
      ['PATCH', '/user/alarms/read', { alarmId: '77' }],
      ['PATCH', '/user/alarms/read/all', {}],
    ])
  })

  it('throws 503 without a key and makes no request', async () => {
    rmSync(keyPath)
    const { doFetch, calls } = fakeFetch({})
    const error = await makeFlowClient({ fetch: doFetch, keyPath }).listAlarms({}).catch((caught) => caught)
    expect(error).toBeInstanceOf(FlowError)
    expect(error.status).toBe(503)
    expect(error.message).toBe(FLOW_KEY_MISSING_MESSAGE)
    expect(calls).toHaveLength(0)
  })

  it('maps flow errors to statuses with Korean messages and never includes the key', async () => {
    const cases: [Response | Error, number, string][] = [
      [fail(401, 'API Key 정보가 올바르지 않습니다.'), 502, '플로우 API 키가 올바르지 않음: API Key 정보가 올바르지 않습니다.'],
      [fail(429, 'too many'), 429, '플로우 요청 한도 초과 (경로마다 분당 120회). 잠시 뒤 다시 시도하세요'],
      [fail(400, '잘못된 query 형식입니다.'), 502, '플로우 오류 (HTTP 400): 잘못된 query 형식입니다.'],
      [new Response('<html>', { status: 500 }), 502, '플로우 응답을 해석하지 못함 (HTTP 500)'],
      [new Error('connect ECONNREFUSED'), 502, '플로우에 연결하지 못함: connect ECONNREFUSED'],
    ]
    for (const [answer, status, message] of cases) {
      const client = makeFlowClient({
        fetch: async () => {
          if (answer instanceof Error) throw answer
          return answer
        },
        keyPath,
      })
      const error = await client.countUnreadChats().catch((caught) => caught)
      expect(error).toBeInstanceOf(FlowError)
      expect([error.status, error.message]).toEqual([status, message])
      expect(error.message).not.toContain(KEY)
    }
  })

  it('treats success: false with HTTP 200 as an error', async () => {
    const client = makeFlowClient({
      fetch: async () => Response.json({ response: { success: false, code: 500, error: { message: '서버 오류' } } }),
      keyPath,
    })
    await expect(client.countUnreadChats()).rejects.toMatchObject({ status: 502, message: '플로우 오류 (HTTP 200): 서버 오류' })
  })
})

describe('flow poller', () => {
  const at = new Date('2026-10-22T09:00:00Z')

  function setup(state: { alarms: number; chats: number[][]; isFailing?: boolean }) {
    const { doFetch } = fakeFetch({
      'GET /user/alarms': (url) => (state.isFailing ? fail(500, '점검 중') : alarmsRoute(state.alarms)(url)),
      'GET /user/chats': (url) => chatsRoute(state.chats)(url),
    })
    const changes: FlowStatus[] = []
    const poller = makeFlowPoller(makeFlowClient({ fetch: doFetch, keyPath }), (status) => changes.push(status), () => at)
    return { poller, changes }
  }

  it('reports only when counts or errors change', async () => {
    const state = { alarms: 3, chats: [[1, 1]], isFailing: false }
    const { poller, changes } = setup(state)
    expect(poller.status()).toEqual(UNCHECKED_FLOW_STATUS)

    await poller.check()
    expect(poller.status()).toEqual({
      isConfigured: true,
      unreadAlarmCount: 3,
      unreadChatCount: 2,
      checkedAt: at.toISOString(),
      error: null,
    })
    expect(changes).toHaveLength(1)

    await poller.check()
    expect(changes).toHaveLength(1)

    state.alarms = 0
    await poller.check()
    expect(changes.map((status) => status.unreadAlarmCount)).toEqual([3, 0])
  })

  it('keeps the last counts with an error, then clears the error on recovery', async () => {
    const state = { alarms: 2, chats: [[0]], isFailing: false }
    const { poller, changes } = setup(state)
    await poller.check()

    state.isFailing = true
    await poller.check()
    expect(poller.status()).toMatchObject({ unreadAlarmCount: 2, unreadChatCount: 0, error: '플로우 오류 (HTTP 500): 점검 중' })
    await poller.check()
    expect(changes).toHaveLength(2)

    state.isFailing = false
    await poller.check()
    expect(poller.status().error).toBeNull()
    expect(changes).toHaveLength(3)
  })

  it('is not configured without a key and reports when the key is removed', async () => {
    const { poller, changes } = setup({ alarms: 1, chats: [[0]] })
    await poller.check()
    rmSync(keyPath)
    await poller.check()
    expect(poller.status()).toEqual(INITIAL_FLOW_STATUS)
    expect(changes.map((status) => status.isConfigured)).toEqual([true, false])
  })

  it('starts unchecked (configured, no counts) and reports the missing key on the first check', async () => {
    rmSync(keyPath)
    const { poller, changes } = setup({ alarms: 1, chats: [[0]] })
    expect(poller.status()).toEqual({ isConfigured: true, unreadAlarmCount: null, unreadChatCount: null, checkedAt: null, error: null })
    await poller.check()
    expect(changes).toEqual([INITIAL_FLOW_STATUS])
  })
})
