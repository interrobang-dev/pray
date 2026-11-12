/** 입력 상자가 줄바꿈 수만큼 자라는 최대 줄 수. 넘으면 입력칸 안에서 스크롤한다 */
const MAX_COMPOSER_ROWS = 8

/** 입력칸 높이(줄 수): 줄바꿈 수만큼, 1~maxRows(기본 8)줄. 긴 줄이 접힌 것은 세지 않는다 */
export function composerRows(draft: string, maxRows = MAX_COMPOSER_ROWS): number {
  return Math.min(Math.max(draft.split('\n').length, 1), maxRows)
}

/** 곁가지 질문 카드 입력칸의 최대 줄 수 (카드는 높이가 제한돼 대화 입력칸보다 적게 자란다) */
export const MAX_BTW_ROWS = 4

/** 인계 중(Hand over 로 띄운 새 지시자가 인계 글에 답하기 전) 입력칸 placeholder·곁가지 질문 막는 이유. 서버 409 문구와 같다 */
export const HANDOVER_BLOCK_TEXT = "Handing over — wait for the new lead's reply"

/** 입력칸 placeholder: 제안이 보이면 빈 글(흐린 제안과 겹치지 않게), 질문 중, 인계 중, 평소 */
export function composerPlaceholder(state: { hasSuggestion: boolean; isAsking: boolean; isHandingOver: boolean }): string {
  if (state.hasSuggestion) return ''
  if (state.isAsking) return 'Answer the question above first'
  if (state.isHandingOver) return HANDOVER_BLOCK_TEXT
  return 'Type an instruction (Shift+Enter for a new line)'
}

/** 입력 상자 위 인계 중 띠 글 (fromName = 직전 지시자 이름, 역할 없이) */
export function handoverBandText(fromName: string): string {
  return `Handing over · Reading ${fromName}'s history…`
}

/**
 * 곁가지 질문 카드에서 질문을 보낼 수 없는 이유 (없으면 null). 서버 POST /api/sessions/:id/btw 의 409 조건과 맞춘다:
 * 인계 중, 승인 대기·질문 중, 아직 답하는 중인 질문(세션당 하나)
 */
export function btwBlockReason(state: { isAsking: boolean; isApprovalNeeded: boolean; isPending: boolean; isHandingOver: boolean }): string | null {
  if (state.isHandingOver) return HANDOVER_BLOCK_TEXT
  if (state.isAsking || state.isApprovalNeeded) return "Can't ask while claude needs approval or is asking a question"
  if (state.isPending) return 'Wait for the answer before asking again'
  return null
}

/** 곁가지 질문 카드 열기 단축키: Ctrl+Shift+B (맥 Meta+Shift+B). 한글 자판은 key 가 'ㅠ' 라 code 로도 본다 */
export function isBtwShortcut(event: { code: string; key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  const isBKey = event.code === 'KeyB' || event.key.toLowerCase() === 'b'
  return isBKey && event.shiftKey && (event.ctrlKey || event.metaKey) && !event.altKey
}

/**
 * 보낼 글: 입력한 글 + 빈 줄 + "첨부 파일:" + 경로 한 줄씩. 글 없이 첨부만이면 목록만.
 * claude 는 자기 세션 scratchpad 파일을 확인 창 없이 읽으므로 경로만 주면 Read 한다.
 * 경로는 백틱으로 감싼다: 글이 800자를 넘으면 Claude Code 가 붙여넣기로 보고 그림 경로를 `[Image #N]` 으로 바꾸는데 백틱이면 안 바뀐다
 */
export function withAttachmentPaths(text: string, paths: string[]): string {
  if (paths.length === 0) return text
  const list = ['첨부 파일:', ...paths.map((path) => `\`${path}\``)].join('\n')
  return text ? `${text}\n\n${list}` : list
}

/**
 * 입력칸 글이 곁가지 질문 명령인지 (Claude Code `/btw` 처럼 대소문자 무시). 아니면 null, `/btw` 만이면 질문 없음(카드 다시 열기),
 * `/btw 질문` 이면 그 질문 (앞뒤 공백을 뗀다). `/btwx` 는 명령이 아니다
 */
export function parseBtwCommand(text: string): { question: string | null } | null {
  const match = /^\/btw(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  const question = match[1]?.trim() ?? ''
  return { question: question || null }
}

/**
 * 입력 제안(흐린 글)을 보일지. Claude Code 가 빈 입력칸에 제안을 그리는 때와 같게:
 * 제안이 있고, 근무 중인 웹 세션이고, 작업·승인 대기·질문·인계 중이 아니고, 입력칸이 비었고, 확인 전인 임시 말풍선이 없을 때.
 * 막 보낸 말이 확인 전이면 mod 가 보낸 null 이 반영되기 전일 수 있어 숨긴다 (전송 실패한 것은 입력이 안 갔으니 그대로)
 */
export function isSuggestionVisible(state: {
  suggestion: string | null | undefined
  isWritable: boolean
  isWorking: boolean
  isApprovalNeeded: boolean
  isAsking: boolean
  isHandingOver: boolean
  isDraftEmpty: boolean
  hasUnconfirmedPending: boolean
}): boolean {
  return (
    Boolean(state.suggestion) &&
    state.isWritable &&
    !state.isWorking &&
    !state.isApprovalNeeded &&
    !state.isAsking &&
    !state.isHandingOver &&
    state.isDraftEmpty &&
    !state.hasUnconfirmedPending
  )
}

/** 입력 상자의 인용 칩 (말풍선 하나). sessionId 가 지금 세션과 다르면 버린다 */
export interface ComposerQuote {
  sessionId: string
  /** 말풍선의 data-jump-key (메시지 ID) — 칩을 누르면 그 말풍선으로 간다 */
  key: string
  isClaude: boolean
  /** 말풍선 시각 "10:12" (오늘이 아니면 "10/21 10:12"). 모르면 '' */
  clock: string
  text: string
}

/** 인용으로 붙이는 원문 최대 글자 수. claude 는 그 말을 이미 문맥에 갖고 있어 앞부분이면 어느 말인지 안다 */
export const QUOTE_MAX_CHARS = 1000

/**
 * 보낼 글 앞에 인용을 붙인다: `> 인용 (claude 답 · 10:12):` + 원문 줄마다 `> ` (앞 1,000자, 넘으면 끝에 …) + 빈 줄 + 글.
 * 머리 글은 claude 가 읽는 대화 내용이라 한국어다 (첨부 경로의 "첨부 파일:" 과 같다)
 */
export function withQuote(text: string, quote: Pick<ComposerQuote, 'isClaude' | 'clock' | 'text'> | null): string {
  if (!quote) return text
  const body = quote.text.trim()
  const clipped = body.length > QUOTE_MAX_CHARS ? `${body.slice(0, QUOTE_MAX_CHARS).trimEnd()}…` : body
  const header = `> 인용 (${quote.isClaude ? 'claude 답' : '내 말'}${quote.clock ? ` · ${quote.clock}` : ''}):`
  const lines = clipped.split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line}`))
  return [header, ...lines, '', text].join('\n')
}

/** 칩에 보일 글: 비지 않은 첫 줄 (칩은 한 줄 말줄임이라 120자면 넉넉하다) */
export function quotePreview(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim() !== '')?.trim() ?? ''
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}
