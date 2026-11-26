import type { NotificationSettings } from '@pray/host/notificationSettings'
import type { Reminder } from '@pray/host/reminder'
import {
  diffSessions,
  placeOf,
  reminderPlace,
  reminderTarget,
  reminderTitle,
  type NoticePlace,
  type NotifyKind,
  type NotifyOffice,
  type NotifySession,
  type StatusBaseline,
} from '@pray/host/sessionNotice'

/**
 * 알림 이벤트 스트림 `GET /api/notifications/stream` (SSE, 안드로이드 앱이 받는다) 의 버퍼·구독·회차.
 * 판정·글자는 `@pray/host/sessionNotice` (트레이와 같은 규칙), 거르기는 알림 설정(notifications.json) — 트레이가 거르는 규칙과 같다.
 * 라우트·의존성 연결은 index.ts. 타이머는 전역 setInterval 이라 시험은 가짜 시계로 돌린다
 */

export type NoticeEventKind = NotifyKind | 'reminder'

/** SSE `data:` 의 꼴 (안드로이드 앱과의 약속 — 바꾸면 앱도 고친다) */
export interface NoticeEvent {
  /** 서버가 뜬 뒤 1부터 1씩 느는 정수의 글. SSE `id:` 와 같다 */
  id: string
  kind: NoticeEventKind
  /** 누르면 열 세션. 알림(Reminders)은 그 지휘 단위의 지금 리드(없으면 등록한 리드), 사람이 등록한 것은 null */
  sessionId: string | null
  title: string
  body: string
  /** 팀·파트 이름. 팀이 없거나(Focus Zone·사람이 등록한 알림) 팀 정보를 못 읽었으면 null */
  place: NoticePlace | null
  /** 알린 시각 (ISO) */
  at: string
}

export const NOTICE_POLL_MS = 3_000
export const NOTICE_PING_MS = 15_000
export const NOTICE_BUFFER_SIZE = 50
export const NOTICE_BUFFER_MS = 10 * 60_000

/** 종류 → 알림 설정 키 (트레이 desktop/src/notificationSettings.ts 의 settingKeyOf 에 reminder 를 더한 것) */
const KIND_SETTING: Record<NoticeEventKind, keyof NotificationSettings> = {
  done: 'done',
  'my-turn': 'myTurn',
  'needs-approval': 'needsApproval',
  'hand-over': 'handOver',
  reminder: 'reminders',
}

/** 보낼지: 전체가 꺼졌으면 아무것도, 아니면 종류별 스위치 */
export function isNoticeKindAllowed(kind: NoticeEventKind, settings: NotificationSettings): boolean {
  return settings.enabled && settings[KIND_SETTING[kind]]
}

/** SSE 한 덩이: `id:` · `event: notice` · `data:` (JSON 은 줄바꿈을 이스케이프해 한 줄이다) */
export function formatNoticeEvent(event: NoticeEvent): string {
  return `id: ${event.id}\nevent: notice\ndata: ${JSON.stringify(event)}\n\n`
}

export const NOTICE_PING = ': ping\n\n'

/**
 * 최근 이벤트 버퍼 (메모리. 최근 50개·10분). 놓친 것 다시 받기용 — 서버를 다시 켜면 비고 번호도 1부터다
 */
export class NoticeBuffer {
  private events: { seq: number; atMs: number; event: NoticeEvent }[] = []
  private lastSeq = 0

  constructor(private readonly now: () => number = Date.now) {}

  add(fields: Omit<NoticeEvent, 'id' | 'at'>): NoticeEvent {
    const atMs = this.now()
    const seq = ++this.lastSeq
    const event: NoticeEvent = { id: String(seq), kind: fields.kind, sessionId: fields.sessionId, title: fields.title, body: fields.body, place: fields.place, at: new Date(atMs).toISOString() }
    this.events.push({ seq, atMs, event })
    this.prune()
    return event
  }

  /**
   * Last-Event-ID 뒤의 것 중 10분 안의 것 (오래된 것 먼저). 없거나(첫 연결) 이 서버가 아직 내지 않은 id·정수가 아닌 글(서버 재시작 전의 id)이면 [].
   * 그 id 가 버퍼에서 이미 밀려났어도 이 서버가 낸 것이면 남은 것을 준다
   */
  after(lastEventId: string | null | undefined): NoticeEvent[] {
    this.prune()
    if (lastEventId === null || lastEventId === undefined || !/^\d{1,15}$/.test(lastEventId.trim())) return []
    const last = Number(lastEventId.trim())
    if (last > this.lastSeq) return []
    return this.events.filter((each) => each.seq > last).map((each) => each.event)
  }

  private prune(): void {
    const oldest = this.now() - NOTICE_BUFFER_MS
    this.events = this.events.filter((each) => each.atMs >= oldest).slice(-NOTICE_BUFFER_SIZE)
  }
}

export interface NoticeSubscriber {
  write(chunk: string): void
}

export interface NoticeStreamDeps {
  /** 서버의 세션 목록 (`GET /api/sessions` 와 같은 것). 던지면 그 회차만 건너뛴다 */
  readSessions(): Promise<NotifySession[]>
  /** 팀·파트 이름과 지금 리드 (hq 의 teams). 못 읽으면 null (자리 없이 알린다) */
  readOffice(): NotifyOffice | null
  /** 알림 설정. 보낼 때마다 읽는다 */
  readSettings(): NotificationSettings
  now?(): number
  log?(message: string): void
}

/**
 * 구독자가 하나 이상일 때만 3초마다 세션 목록을 읽어 직전 기준과 비교한다 (첫 회차는 기준만). 구독자가 0 이 되면 멈추고 기준도 버린다.
 * 알림(Reminders)은 서버가 울릴 때 publishReminders 로 들어온다 (구독자가 없어도 버퍼에 남긴다 — 10분 안에 다시 붙으면 받는다)
 */
export class NoticeStream {
  readonly buffer: NoticeBuffer
  private readonly subscribers = new Set<NoticeSubscriber>()
  private baseline: StatusBaseline | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  /** 멈추고 다시 시작하면 늘린다 — 멈추기 전에 시작한 회차의 결과를 버린다 */
  private generation = 0
  private isPolling = false
  private isFailing = false
  private readonly log: (message: string) => void

  constructor(private readonly deps: NoticeStreamDeps) {
    this.buffer = new NoticeBuffer(deps.now ?? Date.now)
    this.log = deps.log ?? ((message) => console.log(message))
  }

  get subscriberCount(): number {
    return this.subscribers.size
  }

  get isRunning(): boolean {
    return this.pollTimer !== null
  }

  /** 다시 받을 것을 먼저 쓰고 구독에 넣는다. 반환 함수로 뺀다 (연결이 닫힐 때) */
  subscribe(subscriber: NoticeSubscriber, lastEventId: string | null | undefined): () => void {
    for (const event of this.buffer.after(lastEventId)) this.writeTo(subscriber, formatNoticeEvent(event))
    this.subscribers.add(subscriber)
    if (this.subscribers.size === 1) this.start()
    return () => {
      if (!this.subscribers.delete(subscriber)) return
      if (this.subscribers.size === 0) this.stop()
    }
  }

  private start(): void {
    this.generation++
    this.baseline = null
    this.pollTimer = setInterval(() => void this.poll(), NOTICE_POLL_MS)
    this.pingTimer = setInterval(() => this.broadcast(NOTICE_PING), NOTICE_PING_MS)
    void this.poll()
  }

  private stop(): void {
    this.generation++
    this.baseline = null
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pollTimer = null
    this.pingTimer = null
  }

  /** 한 회차. 앞 회차가 아직 돌면 건너뛴다. 던지지 않는다 */
  async poll(): Promise<void> {
    if (this.isPolling || !this.isRunning) return
    this.isPolling = true
    const generation = this.generation
    try {
      const sessions = await this.deps.readSessions()
      if (generation !== this.generation) return
      const { next, notices } = diffSessions(this.baseline, sessions)
      this.baseline = next
      if (this.isFailing) this.log('알림 스트림: 세션 목록 읽기 복구')
      this.isFailing = false
      if (notices.length === 0) return
      const office = this.deps.readOffice()
      const sessionOf = new Map(sessions.map((each) => [each.id, each]))
      for (const notice of notices) {
        const session = sessionOf.get(notice.sessionId)
        this.publish({ kind: notice.kind, sessionId: notice.sessionId, title: notice.title, body: notice.body, place: session ? placeOf(session, office) : null })
      }
    } catch (error) {
      if (!this.isFailing) this.log(`알림 스트림: 세션 목록 읽기 실패 (${NOTICE_POLL_MS / 1000}초 뒤 다시): ${error}`)
      this.isFailing = true
    } finally {
      this.isPolling = false
    }
  }

  /** 서버가 울린 알림(Reminders). 글은 알림 글 전체 (트레이는 토스트에서 한 줄로 자른다). 던지지 않는다 */
  async publishReminders(fired: readonly Reminder[]): Promise<void> {
    if (fired.length === 0 || !this.isAllowed('reminder')) return
    let sessions: NotifySession[] = []
    try {
      sessions = await this.deps.readSessions()
    } catch {
      // 이름 없이 "[Lead] Reminder" 로 알린다
    }
    const office = this.deps.readOffice()
    for (const reminder of fired) {
      this.publish({ kind: 'reminder', sessionId: reminderTarget(reminder, office), title: reminderTitle(reminder, sessions), body: reminder.text, place: reminderPlace(reminder, office) })
    }
  }

  private isAllowed(kind: NoticeEventKind): boolean {
    try {
      return isNoticeKindAllowed(kind, this.deps.readSettings())
    } catch {
      return true
    }
  }

  /** 설정으로 거른 뒤 버퍼에 넣고 모든 구독자에게 보낸다 (꺼진 종류는 버퍼에도 넣지 않는다 — 다시 켤 때 몰아서 안 오게) */
  private publish(fields: Omit<NoticeEvent, 'id' | 'at'>): void {
    if (!this.isAllowed(fields.kind)) return
    this.broadcast(formatNoticeEvent(this.buffer.add(fields)))
  }

  private broadcast(chunk: string): void {
    for (const subscriber of this.subscribers) this.writeTo(subscriber, chunk)
  }

  private writeTo(subscriber: NoticeSubscriber, chunk: string): void {
    try {
      subscriber.write(chunk)
    } catch {
      // 닫히는 중인 연결. close 이벤트가 구독에서 뺀다
    }
  }
}
