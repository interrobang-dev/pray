import type { ChatMessage } from './types'

/**
 * 대화 탭 [Sign in] 을 붙일 메시지 ID: 대화의 마지막 claude 응답이 로그인이 끊겨 남은 오류(`isLoginNeeded`)일 때만 그 ID.
 * 그 뒤에 claude 가 다시 답했으면 이미 로그인된 것이라 옛 오류 말풍선에는 버튼을 두지 않는다
 */
export function lastLoginNeededId(messages: readonly ChatMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    return message.isLoginNeeded ? message.id : null
  }
  return null
}
