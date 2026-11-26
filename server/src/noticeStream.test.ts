import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from '@pray/host/notificationSettings'
import type { Reminder } from '@pray/host/reminder'
import type { NotifySession } from '@pray/host/sessionNotice'
import {
  formatNoticeEvent,
  NOTICE_BUFFER_MS,
  NOTICE_BUFFER_SIZE,
  NOTICE_PING,
  NOTICE_PING_MS,
  NOTICE_POLL_MS,
  NoticeBuffer,
  NoticeStream,
  type NoticeEvent,
} from './noticeStream.js'

const START = Date.parse('2026-11-26T03:00:00.000Z')

function session(overrides: Partial<NotifySession> = {}): NotifySession {
  return {
    id: 's1',
    name: 'Park',
    position: 'Lead',
    title: null,
    status: 'working',
    isAlive: true,
    lastAssistantText: '끝났습니다',
    pendingTool: null,
    role: 'lead',
    teamId: 't1',
    partId: null,
    contextTokens: 1000,
    ...overrides,
  }
}

const fields = (title: string) => ({ kind: 'done' as const, sessionId: 's1', title, body: '', place: null })

describe('NoticeBuffer', () => {
  let now = START
  const buffer = () => new NoticeBuffer(() => now)
  beforeEach(() => {
    now = START
  })

  it('id 는 1부터 1씩, at 은 ISO', () => {
    const each = buffer()
    expect(each.add(fields('a'))).toMatchObject({ id: '1', at: '2026-11-26T03:00:00.000Z' })
    expect(each.add(fields('b')).id).toBe('2')
  })

  it('Last-Event-ID 뒤 것만 다시 준다', () => {
    const each = buffer()
    for (const title of ['a', 'b', 'c']) each.add(fields(title))
    expect(each.after('1').map((event) => event.title)).toEqual(['b', 'c'])
    expect(each.after(' 2 ').map((event) => event.title)).toEqual(['c'])
    expect(each.after('3')).toEqual([])
    expect(each.after('0').map((event) => event.title)).toEqual(['a', 'b', 'c'])
  })

  it('없거나 모르는 id(서버 재시작 전의 큰 번호·정수 아님)는 아무것도 다시 주지 않는다', () => {
    const each = buffer()
    each.add(fields('a'))
    expect(each.after(null)).toEqual([])
    expect(each.after(undefined)).toEqual([])
    expect(each.after('99')).toEqual([])
    expect(each.after('abc')).toEqual([])
    expect(each.after('-1')).toEqual([])
    expect(each.after('')).toEqual([])
  })

  it('10분 지난 것은 버린다', () => {
    const each = buffer()
    each.add(fields('old'))
    now += 60_000
    each.add(fields('new'))
    now = START + NOTICE_BUFFER_MS
    expect(each.after('0').map((event) => event.title)).toEqual(['old', 'new'])
    now += 1
    expect(each.after('0').map((event) => event.title)).toEqual(['new'])
  })

  it('최근 50개까지, 밀려난 id 뒤로도 남은 것을 준다', () => {
    const each = buffer()
    for (let index = 1; index <= NOTICE_BUFFER_SIZE + 5; index++) each.add(fields(String(index)))
    const replay = each.after('1')
    expect(replay).toHaveLength(NOTICE_BUFFER_SIZE)
    expect(replay[0].id).toBe('6')
    expect(replay.at(-1)?.id).toBe('55')
  })
})

describe('formatNoticeEvent', () => {
  it('id · event · data 한 줄', () => {
    const event: NoticeEvent = { id: '7', kind: 'my-turn', sessionId: 's1', title: 'a', body: '줄\n바꿈', place: { team: 'Pray', part: null }, at: '2026-11-26T03:00:00.000Z' }
    expect(formatNoticeEvent(event)).toBe(
      'id: 7\nevent: notice\ndata: {"id":"7","kind":"my-turn","sessionId":"s1","title":"a","body":"줄\\n바꿈","place":{"team":"Pray","part":null},"at":"2026-11-26T03:00:00.000Z"}\n\n',
    )
  })
})

describe('NoticeStream', () => {
  let sessions: NotifySession[]
  let settings: NotificationSettings
  let readCount: number
  let stream: NoticeStream

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    sessions = [session()]
    settings = { ...DEFAULT_NOTIFICATION_SETTINGS }
    readCount = 0
    stream = new NoticeStream({
      readSessions: async () => {
        readCount++
        return sessions
      },
      readOffice: () => ({ teams: [{ id: 't1', name: 'Pray', leadSessionId: 's1', parts: [{ id: 'p1', name: 'Design' }] }] }),
      readSettings: () => settings,
      log: () => {},
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function subscriber() {
    const chunks: string[] = []
    return { chunks, write: (chunk: string) => chunks.push(chunk), events: () => chunks.filter((chunk) => chunk !== NOTICE_PING) }
  }

  it('구독자가 없으면 세션 목록을 읽지 않는다', async () => {
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 5)
    expect(readCount).toBe(0)
    expect(stream.isRunning).toBe(false)
  })

  it('첫 회차는 기준만 잡고, 상태가 바뀌면 이벤트를 보낸다', async () => {
    const one = subscriber()
    stream.subscribe(one, null)
    await vi.advanceTimersByTimeAsync(0)
    expect(readCount).toBe(1)
    expect(one.events()).toEqual([])
    sessions = [session({ status: 'done' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    expect(one.events()).toEqual([
      formatNoticeEvent({ id: '1', kind: 'done', sessionId: 's1', title: '[Lead] Park · Done', body: '끝났습니다', place: { team: 'Pray', part: null }, at: new Date(START + NOTICE_POLL_MS).toISOString() }),
    ])
  })

  it('구독자 0 이면 멈추고 기준을 버린다 — 다시 붙으면 첫 회차는 기준만', async () => {
    const unsubscribe = stream.subscribe(subscriber(), null)
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    expect(readCount).toBe(2)
    unsubscribe()
    unsubscribe()
    expect(stream.isRunning).toBe(false)
    sessions = [session({ status: 'done' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS * 3)
    expect(readCount).toBe(2)
    const again = subscriber()
    stream.subscribe(again, null)
    await vi.advanceTimersByTimeAsync(0)
    expect(again.events()).toEqual([])
  })

  it('15초마다 ping', async () => {
    const one = subscriber()
    stream.subscribe(one, null)
    await vi.advanceTimersByTimeAsync(NOTICE_PING_MS)
    expect(one.chunks.filter((chunk) => chunk === NOTICE_PING)).toHaveLength(1)
  })

  it('다시 붙을 때 Last-Event-ID 뒤 것을 먼저 받는다', async () => {
    const unsubscribe = stream.subscribe(subscriber(), null)
    await vi.advanceTimersByTimeAsync(0)
    sessions = [session({ status: 'needs-approval', pendingTool: 'Bash' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    sessions = [session({ status: 'working' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    sessions = [session({ status: 'my-turn' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    unsubscribe()
    const again = subscriber()
    stream.subscribe(again, '1')
    expect(again.events().map((chunk) => chunk.split('\n')[0])).toEqual(['id: 2'])
    expect(again.events()[0]).toContain('"kind":"my-turn"')
  })

  it('알림 설정에서 끈 종류는 보내지도 버퍼에 넣지도 않는다', async () => {
    const one = subscriber()
    stream.subscribe(one, null)
    await vi.advanceTimersByTimeAsync(0)
    settings = { ...settings, done: false }
    sessions = [session({ status: 'done' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    expect(one.events()).toEqual([])
    settings = { ...settings, done: true, enabled: false }
    sessions = [session({ status: 'working' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    sessions = [session({ status: 'my-turn' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    expect(one.events()).toEqual([])
    expect(stream.buffer.after('0')).toEqual([])
  })

  it('세션 목록을 못 읽은 회차는 건너뛰고 기준은 그대로', async () => {
    let isBroken = false
    const broken = new NoticeStream({
      readSessions: async () => {
        if (isBroken) throw new Error('hq')
        return sessions
      },
      readOffice: () => null,
      readSettings: () => settings,
      log: () => {},
    })
    const one = subscriber()
    broken.subscribe(one, null)
    await vi.advanceTimersByTimeAsync(0)
    isBroken = true
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    isBroken = false
    sessions = [session({ status: 'done' })]
    await vi.advanceTimersByTimeAsync(NOTICE_POLL_MS)
    expect(one.events()).toHaveLength(1)
    expect(one.events()[0]).toContain('"place":null')
  })

  const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
    id: 'r1',
    text: 'Check the deploy',
    at: '2026-11-26T03:00:00.000Z',
    createdAt: '2026-11-26T02:00:00.000Z',
    createdBy: { kind: 'lead', teamId: 't1', partId: null, sessionId: 'old-lead' },
    firedAt: '2026-11-26T03:00:05.000Z',
    acknowledgedAt: null,
    ...overrides,
  })

  it('울린 알림(Reminders)은 구독자가 없어도 버퍼에 남고, 대상은 지금 리드', async () => {
    await stream.publishReminders([reminder(), reminder({ id: 'r2', createdBy: { kind: 'user' }, isLate: true })])
    const replay = stream.buffer.after('0')
    expect(replay).toMatchObject([
      { kind: 'reminder', sessionId: 's1', title: '[Lead] Reminder', body: 'Check the deploy', place: { team: 'Pray', part: null } },
      { kind: 'reminder', sessionId: null, title: 'Late reminder', place: null },
    ])
    settings = { ...settings, reminders: false }
    await stream.publishReminders([reminder({ id: 'r3' })])
    expect(stream.buffer.after('0')).toHaveLength(2)
  })
})
