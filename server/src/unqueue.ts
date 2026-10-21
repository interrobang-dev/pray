/**
 * 대기 중인 마지막 메시지 취소 (순수 함수). Claude Code 에는 대기열에서 하나만 빼는 방법이 없다:
 * 빈 입력칸에서 ↑ 를 누르면 사람이 친 대기 메시지를 전부(들어온 순으로 `\n` 으로 이어) 입력칸에 꺼낸다 (jsonl 에는 꺼낸 것마다 popAll).
 * 그래서 서버가 pty 에 ↑ 를 보내고, 웹 세션의 mod 가 입력칸 변경을 알려 오면 그 답으로 남길 글을 하나씩 fill 시키고
 * fill 이 확인되면 서버가 Enter 를 보내 다시 대기열에 넣는다. 마지막 글만 다시 넣지 않는다
 */

/**
 * 진행 단계. popping = ↑ 를 보내고 꺼낸 글을 기다림, filling = 남길 글 index 를 fill 하라고 답하고 그 글을 기다림,
 * submitting = Enter 를 보내고 입력칸이 비기를 기다림, clearing = 남길 글이 없어 입력칸을 비우라고 답함,
 * done = 끝, stuck = 기대와 다른 글이 와서 멈춤 (더 지시하지 않는다)
 */
export type UnqueueStep =
  | { kind: 'popping' }
  | { kind: 'filling'; index: number }
  | { kind: 'submitting'; index: number }
  | { kind: 'clearing' }
  | { kind: 'done' }
  | { kind: 'stuck' }

export interface UnqueueProgress {
  /** 대기 글 q1..qn (jsonl content 그대로, 들어온 순). 마지막이 취소할 글이고 나머지는 다시 넣는다 */
  queued: string[]
  step: UnqueueStep
}

export interface BoxAnswer {
  step: UnqueueStep
  /** mod 에 돌려줄 답. fill 이 있으면 mod 가 입력칸을 그 글로 바꾼다 */
  reply: { fill?: string }
  /** 서버가 pty 에 Enter 를 보내야 하나 (fill 한 글이 입력칸에 그대로 들어간 것을 확인함) */
  isEnterNeeded: boolean
}

/**
 * mod 가 알린 입력칸 변경(글과 누가 바꿨는지)에 어떻게 답할지. 입력칸 글은 기대한 것과 정확히 같아야 다음으로 간다
 */
export function answerBox({ queued, step }: UnqueueProgress, text: string, origin: string): BoxAnswer {
  const kept = queued.slice(0, -1)
  const stay: BoxAnswer = { step, reply: {}, isEnterNeeded: false }
  const stuck: BoxAnswer = { step: { kind: 'stuck' }, reply: {}, isEnterNeeded: false }
  const fillFrom = (index: number): BoxAnswer =>
    index < kept.length
      ? { step: { kind: 'filling', index }, reply: { fill: kept[index] }, isEnterNeeded: false }
      : { step: { kind: 'done' }, reply: {}, isEnterNeeded: false }

  switch (step.kind) {
    case 'popping':
      // ↑ 전에 일어난 다른 변경(막 보낸 말로 입력칸이 비워짐 등)의 알림이 늦게 올 수 있어 꺼냄(engine)만 본다
      if (origin !== 'engine') return stay
      if (text !== queued.join('\n')) return stuck
      return kept.length === 0 ? { step: { kind: 'clearing' }, reply: { fill: '' }, isEnterNeeded: false } : fillFrom(0)
    case 'filling':
      return text === kept[step.index] ? { step: { kind: 'submitting', index: step.index }, reply: {}, isEnterNeeded: true } : stuck
    case 'submitting':
      return text === '' ? fillFrom(step.index + 1) : stuck
    case 'clearing':
      return text === '' ? { step: { kind: 'done' }, reply: {}, isEnterNeeded: false } : stuck
    default:
      return stay
  }
}

/** ↑ 이후 jsonl 로 본 목표 글의 결말. cancelled = 꺼내기만 함, accepted = claude 가 받음, unknown = 아직 기록 없음 */
export type QueueJudgement = 'cancelled' | 'accepted' | 'unknown'

/**
 * jsonl 의 fromLine 번째 줄부터 목표 글(jsonl content 그대로)의 결말을 본다 (깨진 줄은 건너뛴다).
 * popAll·popOne 만 있으면 꺼낸 것, 같은 글의 queued_command 첨부도 있으면 흡수 중에 꺼낸 것이라 이미 받은 것.
 * 꺼내지 않았는데 차례 중간에 받아들였거나(remove absorbed_mid_turn·queued_command) 차례가 끝나 빠졌으면(dequeue. 글이 없다) 받은 것
 */
export function judgeQueue(jsonl: string, fromLine: number, target: string): QueueJudgement {
  let isPopped = false
  let isDelivered = false
  let isTaken = false
  for (const line of jsonl.split('\n').slice(fromLine)) {
    if (!line.trim()) continue
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (record.type === 'queue-operation') {
      const isTarget = record.content === target
      if ((record.operation === 'popAll' || record.operation === 'popOne') && isTarget) isPopped = true
      if (record.operation === 'remove' && record.reason === 'absorbed_mid_turn' && isTarget) isTaken = true
      if (record.operation === 'dequeue') isTaken = true
      continue
    }
    const attachment = record.attachment as { type?: unknown; prompt?: unknown } | undefined
    if (record.type === 'attachment' && attachment?.type === 'queued_command' && attachment.prompt === target) isDelivered = true
  }
  if (isPopped) return isDelivered ? 'accepted' : 'cancelled'
  return isDelivered || isTaken ? 'accepted' : 'unknown'
}

/** 화면에 알리는 결과. stuck = 입력칸이 기대와 달라 멈춤 (터미널 탭에서 확인), failed = 시간 초과·기록 없음 */
export type UnqueueOutcome = 'cancelled' | 'accepted' | 'stuck' | 'failed'

/**
 * 진행 단계와 jsonl 결말을 합친다. 진행 도중 시간이 다 되면 입력칸 상태를 모르므로 실패.
 * 꺼냄 알림이 한 번도 안 왔으면(popping) jsonl 이 받았다고 할 때만 받은 것이다 (꺼냈는데 알림이 없으면 mod 가 안 붙은 것이다)
 */
export function decideOutcome(step: UnqueueStep, judgement: QueueJudgement): UnqueueOutcome {
  if (step.kind === 'stuck') return 'stuck'
  if (step.kind !== 'done' && step.kind !== 'popping') return 'failed'
  if (judgement === 'accepted') return 'accepted'
  if (step.kind === 'done' && judgement === 'cancelled') return 'cancelled'
  return 'failed'
}
