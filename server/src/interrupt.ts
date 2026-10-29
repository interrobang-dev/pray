/**
 * 웹 중지(pty 에 Esc 한 번)의 결말 판정 (순수 함수). 실측 (Claude Code 2.1.307):
 * - 도구 실행·글 생성 중 Esc 한 번에 멈추고 jsonl 에 중지 줄 "[Request interrupted by user]" (도구 실행 중이면 "… for tool use]",
 *   도구 결과는 "User rejected tool use" 오류)이 남는다. Stop 등 훅은 하나도 오지 않는다
 * - 대기 메시지가 있으면 멈춘 직후 dequeue 하고 그 메시지로 바로 다음 차례를 시작한다 (그 차례의 Stop 은 온다)
 * - 응답 첫 글자 전에 Esc 하면 jsonl 에 아무것도 남지 않고 보낸 글이 Claude Code 입력칸으로 돌아간다
 * - 입력칸에 쓰던 글이 있어도 Esc 한 번에 멈춘다 (글은 남는다). 자동완성 목록이 떠 있으면 첫 Esc 는 목록만 닫는다
 * 실측 (Claude Code 2.1.312, mod 사본 + 기록 서버):
 * - 응답 전 Esc 로 글이 입력칸에 돌아오면 Esc 뒤 약 0.05~0.1초에 mod prompt.change 가 origin engine, text = 보낸 글 전체로 온다
 *   (800자 넘는 붙여넣기 글도 접히지 않은 원문). 그 답으로 { fill: '' } 를 주면 입력칸이 비고 빈 입력칸(origin plugin) 알림이 오며,
 *   다음에 보낸 글은 홀로 제출된다
 * - 터미널 입력칸에 쓰던 글이 있으면 보낸 글을 되돌리지 않고 중지 줄이 남는다 (stopped). 도구 실행 중 Esc 에는 입력칸 알림이 없다
 * - 보낸 직후(UserPromptSubmit 훅 뒤 0.1초 안) Esc 하면 jsonl 에 그 차례 사람 글 줄이 아직 없어 isAwaitingFirstResponse 가 false 다
 *   (시험 서버 실측). 그래서 돌아온 글은 응답 전이었는지로 거르지 않고 mod 알림으로 안다
 */

/** 중지 줄. Claude Code 가 사람 쪽(user) 글 줄로 남기고 interruptedMessageId 를 붙인다 */
const INTERRUPT_TEXT = /^\[Request interrupted by user( for tool use)?\]$/

export function isInterruptText(text: string): boolean {
  return INTERRUPT_TEXT.test(text.trim())
}

function parseLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
}

/** user 줄의 글 (문자열이거나 text 블록들). 도구 결과만 있는 줄은 null */
function userText(record: Record<string, unknown>): string | null {
  const content = (record.message as { content?: unknown } | undefined)?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null
  const texts = (content as { type?: unknown; text?: unknown }[])
    .filter((block) => block.type === 'text' && typeof block.text === 'string' && block.text)
    .map((block) => block.text as string)
  return texts.length > 0 ? texts.join('\n') : null
}

export type InterruptJudgement = 'stopped' | 'continued' | 'unknown'

/**
 * Esc 뒤(fromLine 부터) jsonl 의 결말. 중지 줄이 있으면 멈춘 것이고, 그 사이 dequeue 가 있으면 대기 메시지로 이어서 일한다.
 * 실측에서 dequeue 는 중지 줄보다 먼저 적혀 순서는 보지 않는다
 */
export function judgeInterrupt(jsonl: string, fromLine: number): InterruptJudgement {
  let isStopped = false
  let isContinued = false
  for (const line of jsonl.split('\n').slice(fromLine)) {
    const record = parseLine(line)
    if (!record || record.isSidechain) continue
    if (record.type === 'queue-operation' && record.operation === 'dequeue') isContinued = true
    if (record.type === 'user') {
      const text = userText(record)
      if (text !== null && isInterruptText(text)) isStopped = true
    }
  }
  if (!isStopped) return 'unknown'
  return isContinued ? 'continued' : 'stopped'
}

/**
 * 지금 차례가 아직 claude 응답을 jsonl 에 하나도 남기지 않았는지: 마지막 차례 시작(사람 쪽 글 줄·queued_command) 뒤에 assistant 줄이 없다.
 * 글이 흘러나오는 중에도 첫 블록이 끝나기 전이면 true 지만 그때 Esc 하면 중지 줄이 남아 judgeInterrupt 가 먼저 가린다
 */
export function isAwaitingFirstResponse(jsonl: string): boolean {
  let isAwaiting = false
  for (const line of jsonl.split('\n')) {
    const record = parseLine(line)
    if (!record || record.isSidechain || record.isMeta) continue
    if (record.type === 'assistant') isAwaiting = false
    const attachment = record.attachment as { type?: unknown } | undefined
    if (record.type === 'attachment' && attachment?.type === 'queued_command') isAwaiting = true
    if (record.type === 'user' && record.isCompactSummary !== true) {
      const text = userText(record)
      if (text !== null && !isInterruptText(text)) isAwaiting = true
    }
  }
  return isAwaiting
}

/**
 * 화면에 알리는 결과. stopped = 멈춤, continued = 멈춘 뒤 대기 메시지로 이어서 일함,
 * restored = 응답 전에 멈춰 보낸 글이 Claude Code 입력칸으로 돌아감 (다음에 보내는 글과 이어 붙는다),
 * unknown = 기록 없음 (자동완성 목록 등이 Esc 를 먹었을 수 있다)
 */
export type InterruptOutcome = 'stopped' | 'continued' | 'restored' | 'unknown'

/**
 * jsonl 결말과 Esc 때의 차례·입력칸을 합친다. 기록이 없는데 응답 전이었거나 돌아온 글을 비웠으면(isRestored) 입력칸으로 돌아간 것으로 본다
 */
export function decideInterrupt(judgement: InterruptJudgement, wasAwaitingFirstResponse: boolean, isRestored = false): InterruptOutcome {
  if (judgement !== 'unknown') return judgement
  return wasAwaitingFirstResponse || isRestored ? 'restored' : 'unknown'
}

/**
 * 중지 중의 입력칸 상태. restoredText = 입력칸에 돌아온 글 (비우라고 답했다), isCleared = 비운 것을 확인했다 (글을 화면 입력칸으로 넘겨도 된다)
 */
export interface InterruptBox {
  restoredText: string | null
  isCleared: boolean
}

/**
 * 중지 중에 mod 가 알린 입력칸 변경(글과 누가 바꿨는지)에 어떻게 답할지:
 * 처음 온 engine 변경(엔진이 보낸 글을 되돌림)은 그 글을 기억하고 비우라고(fill '') 답하고, 그 뒤 빈 입력칸(자기 fill)이 오면 비운 것으로 본다.
 * 다른 engine 변경(받아들인 자동완성 등)이어도 비운 글은 화면 입력칸으로 넘어가 잃지 않는다
 */
export function answerInterruptBox(box: InterruptBox, text: string, origin: string): { box: InterruptBox; reply: { fill?: string } } {
  if (box.isCleared) return { box, reply: {} }
  if (box.restoredText === null) {
    if (origin !== 'engine' || text === '') return { box, reply: {} }
    return { box: { ...box, restoredText: text }, reply: { fill: '' } }
  }
  if (origin === 'plugin' && text === '') return { box: { ...box, isCleared: true }, reply: {} }
  return { box, reply: {} }
}
