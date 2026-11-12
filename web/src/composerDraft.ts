import type { ComposerQuote } from './composerText'

/**
 * 대화 입력칸의 글·커서 (한 벌). Composer 가 자기 state 로 글을 들고 있되 여기에도 적어 둔다 —
 * Files·터미널 탭에서는 Chat·Composer 가 언마운트돼, 다시 대화 탭을 열 때 쓰던 글·커서를 되살리고
 * Files 탭의 Add to chat 이 언마운트된 입력칸의 커서 자리에 넣을 수 있게. App 은 다시 그려지지 않는다
 */
export const composerDraft: {
  text: string
  /** 마지막 커서·선택. null 이면 모른다 (끝에 넣는다) */
  selection: { start: number; end: number } | null
  /** 다음에 입력칸이 그려질 때 포커스한다 (Add to chat. 터치 기기도) */
  isFocusPending: boolean
  /** 입력 상자의 인용 칩 (탭을 오가도 남게. 세션이 다르면 Composer 가 버린다) */
  quote: ComposerQuote | null
} = { text: '', selection: null, isFocusPending: false, quote: null }

/**
 * 글의 start~end(선택이면 그 글을 바꾼다)에 snippet 을 넣는다. 앞 글자가 공백이 아니면 앞에 한 칸,
 * 뒤가 비었거나 공백이 아니면 뒤에 한 칸 — 이어서 치거나 다음 위치를 넣기 좋게. caret 은 넣은 것(뒤 칸 포함) 바로 뒤
 */
export function insertSnippet(text: string, start: number, end: number, snippet: string): { text: string; caret: number } {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const lead = before === '' || /\s$/.test(before) ? '' : ' '
  const trail = after !== '' && /^\s/.test(after) ? '' : ' '
  const inserted = lead + snippet + trail
  return { text: before + inserted + after, caret: before.length + inserted.length }
}

/** 입력칸(언마운트돼 있어도)의 커서 자리에 넣고, 다음에 그려질 때 포커스하게 한다 */
export function addToComposerDraft(snippet: string): void {
  const { text, selection } = composerDraft
  const start = Math.min(selection?.start ?? text.length, text.length)
  const end = Math.min(Math.max(selection?.end ?? text.length, start), text.length)
  const result = insertSnippet(text, start, end, snippet)
  composerDraft.text = result.text
  composerDraft.selection = { start: result.caret, end: result.caret }
  composerDraft.isFocusPending = true
}

/**
 * 되돌아온 글(응답 전 중지로 돌아온 글·취소한 대기 메시지)을 입력칸(언마운트돼 있어도) 맨 앞에 넣는다.
 * 쓰던 글이 있으면 `되돌린 글\n쓰던 글` (Claude Code 가 ↑ 로 대기열을 꺼낼 때와 같은 순서), 커서는 되돌린 글 끝. 다음에 그려질 때 포커스한다
 */
export function restoreToComposerDraft(restored: string): void {
  const { text } = composerDraft
  composerDraft.text = text === '' ? restored : `${restored}\n${text}`
  composerDraft.selection = { start: restored.length, end: restored.length }
  composerDraft.isFocusPending = true
}
