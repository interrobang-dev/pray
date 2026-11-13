import {
  dueMessages,
  markBackToPending,
  markFailed,
  markSending,
  markSent,
  sendDeadline,
  type ScheduledFailure,
  type ScheduledFailureCode,
  type ScheduledMessage,
} from '@pray/host/scheduledMessage'
import type { HookStatus } from './types.js'

/**
 * 예약 보내기의 판정과 보내기 (저장 꼴·정리는 @pray/host/scheduledMessage, 회차·잠금·API 는 index.ts).
 * 판정은 훅 상태 기준이다 (표시 상태 waiting·done 은 훅으로는 my-turn 이라 보낸다)
 */

/** 그 세션 /input 이 이만큼 안에 왔으면 사람이 치는 중으로 보고 미룬다 */
export const RECENT_INPUT_MS = 2_000
/** Enter 뒤 이만큼 안에 UserPromptSubmit 훅(lastPromptAt)이 오면 보낸 것으로 본다 */
export const SEND_CONFIRM_MS = 15_000
const CONFIRM_POLL_MS = 200

/** 미루는 이유 (blocked 실패의 detail 로도 남는다) */
export type DeferReason =
  | 'host-unreachable'
  | 'break'
  | 'needs-approval'
  | 'question'
  | 'handover'
  | 'unqueue'
  | 'interrupt'
  | 'btw'
  | 'approval'
  | 'recent-input'

/** 세션에서 진행 중인 서버 일 (그동안 pty 에 다른 키를 쓰면 섞인다) */
export type SessionActivity = 'handover' | 'unqueue' | 'interrupt' | 'btw' | 'approval'

export interface SendContext {
  now: Date
  isHostReachable: boolean
  /** present = 호스트 목록에 있음, break = hq webSessions 에만, off = 퇴근 기록, missing = 어디에도 없음 */
  attendance: 'present' | 'break' | 'off' | 'missing'
  hookStatus: HookStatus | null
  hasHeldQuestion: boolean
  activity: SessionActivity | null
  /** 그 세션 /input 이 마지막으로 온 시각 (ms). 없으면 null */
  lastInputAt: number | null
  /** 이 메시지가 앞 회차에 미뤄졌던 마지막 이유 (서버 메모리). 없으면 null */
  lastDeferReason: DeferReason | null
}

export type SendDecision = { kind: 'send' } | { kind: 'defer'; reason: DeferReason } | { kind: 'fail'; failure: ScheduledFailure }

/**
 * 시각이 된 예약 메시지를 지금 보낼지 판정한다 (순수).
 * 퇴근 → off-duty, 기록 없음 → not-found (다시 출근시키지 않는다). at + 60분을 넘었으면 앞 회차에 미뤘으면 blocked(마지막 이유), 아니면 missed(서버가 꺼져 있었다).
 * 그 밖에 막히면 미룬다: 호스트 연결 없음·휴식·승인 대기·붙잡은 질문·진행 중인 서버 일·최근 2초 안 입력.
 * idle·my-turn·unknown·ended(근무 중이면 다시 뜬 프로세스)는 보내고, working 도 보낸다 (Claude Code 대기열로 들어간다)
 */
export function sendDecision(message: Pick<ScheduledMessage, 'at'>, context: SendContext): SendDecision {
  if (context.attendance === 'off') return fail('off-duty')
  if (context.attendance === 'missing') return fail('not-found')
  const reason = deferReason(context)
  if (context.now.getTime() > sendDeadline(message)) {
    if (context.lastDeferReason) return fail('blocked', reason ?? context.lastDeferReason)
    return fail('missed')
  }
  return reason ? { kind: 'defer', reason } : { kind: 'send' }
}

function deferReason(context: SendContext): DeferReason | null {
  if (!context.isHostReachable) return 'host-unreachable'
  if (context.attendance !== 'present') return 'break'
  if (context.hasHeldQuestion) return 'question'
  if (context.hookStatus === 'needs-approval') return 'needs-approval'
  if (context.activity) return context.activity
  if (context.lastInputAt !== null && context.now.getTime() - context.lastInputAt < RECENT_INPUT_MS) return 'recent-input'
  return null
}

function fail(code: ScheduledFailureCode, detail?: string): SendDecision {
  return { kind: 'fail', failure: detail === undefined ? { code } : { code, detail } }
}

/** Enter 직전 다시 볼 것 (서버 메모리만 — 타이머 안에서 불려 던지면 안 된다) */
export interface EnterContext {
  isHostReachable: boolean
  isOnHost: boolean
  hookStatus: HookStatus | null
  hasHeldQuestion: boolean
}

/**
 * 글을 쓴 뒤 Enter 를 보내면 안 되는 이유 (순수). 없으면 null.
 * 그 사이 승인 창·질문이 뜨면 Enter 가 그 창의 첫 선택(승인)이 된다. 세션이 끝났거나 호스트가 끊겼으면 보낼 곳이 없다
 */
export function enterBlocker(context: EnterContext): string | null {
  if (!context.isHostReachable) return 'host-unreachable'
  if (!context.isOnHost) return 'session-ended'
  if (context.hasHeldQuestion) return 'question'
  if (context.hookStatus === 'needs-approval') return 'needs-approval'
  return null
}

/** 글 쓰기·Enter 결과. not-written = 글을 못 씀(아무것도 안 들어갔다), blocked = 글은 썼는데 Enter 를 안 보냄 */
export type SubmitOutcome = { kind: 'entered' } | { kind: 'not-written' } | { kind: 'blocked'; reason: string }

export interface ScheduledSenderDeps {
  now(): Date
  sleep(ms: number): Promise<void>
  /** 회차 앞 정리 (hq tidyScheduledMessages). 던질 수 있다 */
  tidy(now: Date, isStartup: boolean): { messages: ScheduledMessage[]; prunedCount: number; interrupted: ScheduledMessage[] }
  /** hq updateScheduledMessage. 던질 수 있다 */
  update(messageId: string, change: (message: ScheduledMessage) => ScheduledMessage | null): ScheduledMessage | null
  /** 판정 칸 (now·lastDeferReason 은 여기서 채운다). hq 를 읽어 던질 수 있다 */
  contextOf(sessionId: string): Omit<SendContext, 'now' | 'lastDeferReason'>
  /** 글을 쓰고 조용해지면 shouldBlockEnter 를 다시 보고 Enter (index.ts submitText) */
  submit(sessionId: string, text: string, shouldBlockEnter: () => string | null): Promise<SubmitOutcome>
  enterContextOf(sessionId: string): EnterContext
  /** 그 세션 마지막 UserPromptSubmit 시각 (hookState lastPromptAt). 없으면 null */
  lastPromptAt(sessionId: string): string | null
  /** 화면에 바뀐 것을 알린다 (broadcastOffice). 던지지 않는다 */
  onChange(): void
  log(line: string): void
  logError(line: string): void
}

/**
 * 30초 회차에서 시각이 된 예약 메시지를 보낸다. 보내는 차례:
 * hq 에 sending·sendingAt 을 먼저 쓰고(서버가 그 사이 꺼지면 다음 시작 때 interrupted — 두 번 보내지 않는다) → 글 → 조용해지면 다시 보고 Enter →
 * 15초 안에 lastPromptAt 이 글을 쓴 시각 뒤가 되면 sent, 아니면 unconfirmed. 글을 쓰고 Enter 까지(typing)는 index.ts 가 다른 입력을 막는다
 */
export class ScheduledSender {
  private readonly deferReasons = new Map<string, DeferReason>()
  /** 보내는 중인 세션 (글 쓰기부터 확정까지) */
  private readonly inFlight = new Set<string>()
  /** 글을 쓰고 Enter 를 보내기 전인 세션 (이 사이 다른 입력을 막는다) */
  private readonly typing = new Set<string>()
  private isTickFailing = false

  constructor(private readonly deps: ScheduledSenderDeps) {}

  isTyping(sessionId: string): boolean {
    return this.typing.has(sessionId)
  }

  /** 한 회차. 던지지 않는다 (요청 처리 밖). 시작한 보내기들을 돌려준다 (테스트가 기다린다) */
  tick(isStartup = false): Promise<void>[] {
    const now = this.deps.now()
    const started: Promise<void>[] = []
    try {
      const { messages, prunedCount, interrupted } = this.deps.tidy(now, isStartup)
      if (this.isTickFailing) this.deps.log('예약 보내기 복구')
      this.isTickFailing = false
      if (prunedCount > 0) this.deps.log(`보관 기간이 지난 예약 메시지 ${prunedCount}개를 지움`)
      for (const message of interrupted) this.deps.log(`예약 메시지 ${message.id} 실패: 보내는 중에 서버가 꺼짐 (다시 보내지 않음)`)
      let isChanged = prunedCount > 0 || interrupted.length > 0
      for (const message of dueMessages(messages, now)) {
        if (this.inFlight.has(message.sessionId)) continue
        const decision = sendDecision(message, {
          ...this.deps.contextOf(message.sessionId),
          now,
          lastDeferReason: this.deferReasons.get(message.id) ?? null,
        })
        if (decision.kind === 'defer') {
          this.deferReasons.set(message.id, decision.reason)
          continue
        }
        this.deferReasons.delete(message.id)
        if (decision.kind === 'fail') {
          if (this.deps.update(message.id, (m) => (m.status === 'pending' ? markFailed(m, decision.failure, now) : null))) {
            this.deps.log(`예약 메시지 ${message.id} 실패: ${failureText(decision.failure)} (예정 ${message.at})`)
            isChanged = true
          }
          continue
        }
        started.push(this.send(message))
      }
      if (isChanged) this.deps.onChange()
    } catch (error) {
      if (!this.isTickFailing) this.deps.logError(`예약 보내기 회차 실패 (다음 회차에 다시): ${error}`)
      this.isTickFailing = true
    }
    return started
  }

  private async send(message: ScheduledMessage): Promise<void> {
    const { sessionId } = message
    this.inFlight.add(sessionId)
    this.typing.add(sessionId)
    try {
      // 그 사이 지웠거나 바뀌었으면 보내지 않는다
      const sending = this.deps.update(message.id, (m) => (m.status === 'pending' ? markSending(m, this.deps.now()) : null))
      if (!sending) return
      this.deps.onChange()
      const writtenAt = Date.parse(sending.sendingAt!)
      const outcome = await this.deps.submit(sessionId, sending.text, () => enterBlocker(this.deps.enterContextOf(sessionId)))
      this.typing.delete(sessionId)
      if (outcome.kind === 'not-written') {
        this.deps.update(message.id, (m) => (m.status === 'sending' ? markBackToPending(m) : null))
        this.deps.log(`예약 메시지 ${message.id} 글을 못 씀 (호스트 연결 없음) — 다음 회차에 다시`)
        return
      }
      if (outcome.kind === 'blocked') {
        this.finish(message.id, (m) => markFailed(m, { code: 'blocked-mid-send', detail: outcome.reason }, this.deps.now()))
        this.deps.log(`예약 메시지 ${message.id} 실패: Enter 직전에 막힘 (${outcome.reason}) — 글은 입력칸에 남음`)
        return
      }
      const enteredAt = this.deps.now()
      if (await this.waitForPrompt(sessionId, writtenAt)) {
        const sent = this.finish(message.id, (m) => markSent(m, enteredAt))
        this.deps.log(`예약 메시지 ${message.id} 보냄 → ${sessionId.slice(0, 8)}${sent?.isLate ? ' (늦음)' : ''} (예정 ${message.at})`)
      } else {
        this.finish(message.id, (m) => markFailed(m, { code: 'unconfirmed' }, this.deps.now()))
        this.deps.log(`예약 메시지 ${message.id} 실패: Enter 뒤 ${SEND_CONFIRM_MS / 1000}초 안에 UserPromptSubmit 이 없음`)
      }
    } catch (error) {
      // hq 를 못 쓰면 sending 으로 남고 다음 시작 때 interrupted 가 된다
      this.deps.logError(`예약 메시지 ${message.id} 보내기 중 오류: ${error}`)
    } finally {
      this.typing.delete(sessionId)
      this.inFlight.delete(sessionId)
      this.deps.onChange()
    }
  }

  /** sending 인 것만 바꾼다 (그 사이 다른 데서 바뀌지 않았을 때) */
  private finish(messageId: string, change: (message: ScheduledMessage) => ScheduledMessage): ScheduledMessage | null {
    return this.deps.update(messageId, (m) => (m.status === 'sending' ? change(m) : null))
  }

  private async waitForPrompt(sessionId: string, writtenAt: number): Promise<boolean> {
    const startedAt = this.deps.now().getTime()
    while (true) {
      const promptAt = this.deps.lastPromptAt(sessionId)
      if (promptAt !== null && Date.parse(promptAt) >= writtenAt) return true
      if (this.deps.now().getTime() - startedAt >= SEND_CONFIRM_MS) return false
      await this.deps.sleep(CONFIRM_POLL_MS)
    }
  }
}

function failureText(failure: ScheduledFailure): string {
  return failure.detail ? `${failure.code} (${failure.detail})` : failure.code
}
