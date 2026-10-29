/**
 * 곁가지 질문(btw, Claude Code `/btw` 와 같은 일)의 서버 쪽 순수 함수·저장소.
 *
 * 흐름: 화면 `POST /api/sessions/:id/btw { question }` → 요청을 만들고 pty 에 `/pray-btw <요청 ID>` → 웹 세션의 mod 가
 * `GET /api/hook/btw/:requestId` 로 질문·이전 문답을 받아 `$.model.fork`(지금 대화 문맥, 도구 없음)로 답을 만들고
 * `POST /api/hook/btw/:requestId` 로 결과를 보낸다. 문답은 대화 기록(jsonl)에 남지 않고 서버 메모리에만 있다.
 *
 * 실측 (Claude Code 2.1.311, Haiku, node-pty): 쉬는 중·Bash 실행 중 모두 1~3초에 답이 오고 차례는 멈추지 않았다.
 * `/pray-btw` 를 친 흔적은 jsonl 에 한 줄도 안 남고 다음 차례 claude 도 보지 못했다. 첫 차례가 끝나기 전에는 `nothing-to-fork`.
 * fork 는 main 의 마지막 요청을 다시 쓰므로 프롬프트 캐시를 읽는다 (cache_read 5만 토큰대). 작업 중이면 그 요청 뒤의 도구 호출은 보지 못한다
 */

/** 세션마다 남기는 문답 수 (Claude Code /btw 가 뒤 질문에 같이 보이는 이전 문답 수와 같다) */
export const BTW_HISTORY_LIMIT = 20
export const BTW_QUESTION_MAX_LENGTH = 4000
/** 이 시간 안에 mod 가 답을 안 보내면 실패로 끝낸다 */
export const BTW_TIMEOUT_MS = 60_000
export const BTW_TIMEOUT_MESSAGE = 'No answer — the session may not have the Pray mod loaded (restart the host once)'

export type BtwStatus = 'pending' | 'answered' | 'failed'

/** 문답 하나 (화면 응답 꼴). answer 는 answered 일 때만, error 는 failed 일 때만 */
export interface BtwItem {
  id: string
  question: string
  status: BtwStatus
  answer: string | null
  error: string | null
  askedAt: string
  answeredAt: string | null
}

/** mod 가 GET 으로 받는 것: 질문과 그 앞의 답한 문답 (오래된 것 먼저) */
export interface BtwRequest {
  question: string
  history: { question: string; answer: string }[]
}

/** 질문 글 검사. 앞뒤 공백을 뗀 글, 꼴이 틀리면 null */
export function parseBtwQuestion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const question = value.trim()
  return question.length >= 1 && question.length <= BTW_QUESTION_MAX_LENGTH ? question : null
}

/** mod 가 보낸 fork 결과(ModelForkResult) → 답 글 또는 화면에 보일 실패 문구. 꼴이 틀리면 null */
export function parseBtwResult(value: unknown): { isAnswered: true; text: string } | { isAnswered: false; message: string } | null {
  if (typeof value !== 'object' || value === null) return null
  const result = value as { isAnswered?: unknown; text?: unknown; reason?: unknown; status?: unknown; error?: unknown }
  if (result.isAnswered === true) return typeof result.text === 'string' ? { isAnswered: true, text: result.text } : null
  if (result.isAnswered !== false || typeof result.reason !== 'string') return null
  return { isAnswered: false, message: failureMessage(result.reason, result.status, result.error) }
}

function failureMessage(reason: string, status: unknown, error: unknown): string {
  if (reason === 'nothing-to-fork') return 'Nothing to answer from yet: wait for claude to finish its first reply'
  if (reason === 'empty-reply') return 'Claude replied with no text'
  if (reason === 'aborted') return 'The answer was cut off'
  if (reason === 'api-error') {
    const code = typeof status === 'number' ? ` ${status}` : ''
    const kind = typeof error === 'string' ? ` (${error})` : ''
    return `API error${code}${kind}`
  }
  return `No answer (${reason})`
}

/** 세션별 문답 목록 (서버 메모리). 시각은 주입한다 */
export class BtwStore {
  private readonly bySession = new Map<string, BtwItem[]>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  list(sessionId: string): BtwItem[] {
    return this.bySession.get(sessionId) ?? []
  }

  hasPending(sessionId: string): boolean {
    return this.list(sessionId).some((item) => item.status === 'pending')
  }

  /** 새 질문을 pending 으로 더한다. BTW_HISTORY_LIMIT 를 넘으면 오래된 것부터 뺀다 */
  ask(sessionId: string, id: string, question: string): BtwItem {
    const item: BtwItem = { id, question, status: 'pending', answer: null, error: null, askedAt: this.now().toISOString(), answeredAt: null }
    this.bySession.set(sessionId, [...this.list(sessionId), item].slice(-BTW_HISTORY_LIMIT))
    return item
  }

  /** mod 에게 줄 질문과 이전 문답. 그 세션의 pending 요청이 아니면 null */
  request(sessionId: string, id: string): BtwRequest | null {
    const items = this.list(sessionId)
    const index = items.findIndex((item) => item.id === id)
    if (index < 0 || items[index]!.status !== 'pending') return null
    const history = items
      .slice(0, index)
      .flatMap((item) => (item.status === 'answered' && item.answer !== null ? [{ question: item.question, answer: item.answer }] : []))
    return { question: items[index]!.question, history }
  }

  /** pending 요청을 답이나 실패로 끝낸다. 그런 요청이 없으면(지움·시간 초과·이미 끝남) false */
  settle(sessionId: string, id: string, result: { isAnswered: true; text: string } | { isAnswered: false; message: string }): boolean {
    const items = this.list(sessionId)
    const item = items.find((candidate) => candidate.id === id)
    if (!item || item.status !== 'pending') return false
    const settled: BtwItem = result.isAnswered
      ? { ...item, status: 'answered', answer: result.text, answeredAt: this.now().toISOString() }
      : { ...item, status: 'failed', error: result.message, answeredAt: this.now().toISOString() }
    this.bySession.set(
      sessionId,
      items.map((candidate) => (candidate === item ? settled : candidate)),
    )
    return true
  }

  /** pty 쓰기에 실패한 요청을 뺀다 */
  remove(sessionId: string, id: string): void {
    const items = this.list(sessionId).filter((item) => item.id !== id)
    if (items.length) this.bySession.set(sessionId, items)
    else this.bySession.delete(sessionId)
  }

  /** 그 세션 것을 지운다. 지운 것이 있으면 true */
  clear(sessionId: string): boolean {
    return this.bySession.delete(sessionId)
  }

  /** 전부 지우고 지운 세션 ID 를 준다 (호스트 연결 끊김) */
  clearAll(): string[] {
    const ids = [...this.bySession.keys()]
    this.bySession.clear()
    return ids
  }
}
