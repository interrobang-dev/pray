/** 입력 상자가 줄바꿈 수만큼 자라는 최대 줄 수. 넘으면 입력칸 안에서 스크롤한다 */
const MAX_COMPOSER_ROWS = 8

/** 입력칸 높이(줄 수): 줄바꿈 수만큼, 1~maxRows(기본 8)줄. 긴 줄이 접힌 것은 세지 않는다 */
export function composerRows(draft: string, maxRows = MAX_COMPOSER_ROWS): number {
  return Math.min(Math.max(draft.split('\n').length, 1), maxRows)
}

/** 곁가지 질문 카드 입력칸의 최대 줄 수 (카드는 높이가 제한돼 대화 입력칸보다 적게 자란다) */
export const MAX_BTW_ROWS = 4

/**
 * 곁가지 질문 카드에서 질문을 보낼 수 없는 이유 (없으면 null). 서버 POST /api/sessions/:id/btw 의 409 조건과 맞춘다:
 * 승인 대기·질문 중, 아직 답하는 중인 질문(세션당 하나)
 */
export function btwBlockReason(state: { isAsking: boolean; isApprovalNeeded: boolean; isPending: boolean }): string | null {
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
