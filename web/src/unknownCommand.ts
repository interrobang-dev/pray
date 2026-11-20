import type { ChatMessage } from './types'

/** 대화 줄 제목 "Unknown command /tracking" */
export function unknownCommandTitle(command: string): string {
  return `Unknown command ${command}`
}

/**
 * 모르는 명령이라 버려진 글을 글로 다시 보낼 꼴. Claude Code 는 글 앞에 공백이 있으면 슬래시 명령으로 보지 않고 그대로 claude 에게 보낸다
 * (실측 2.1.329. `//` 는 claude 에게 그대로 보이고, 보이지 않는 글자는 Claude Code 가 지우고 Enter 를 기다린다)
 */
export function asPlainText(text: string): string {
  return ` ${text}`
}

/** 그 뒤 대화에 같은 글의 사람 쪽 글이 있는(이미 글로 다시 보낸) 모르는 명령 메시지 ID. 비교는 앞뒤 공백을 뺀 글 */
export function sentAsTextIds(messages: readonly ChatMessage[]): Set<string> {
  const sentIds = new Set<string>()
  const waiting = new Map<string, string[]>()
  for (const message of messages) {
    if (message.unknownCommand) {
      const key = message.text.trim()
      waiting.set(key, [...(waiting.get(key) ?? []), message.id])
      continue
    }
    if (message.role !== 'user' || message.from) continue
    const key = message.text.trim()
    const ids = waiting.get(key)
    if (!ids) continue
    for (const id of ids) sentIds.add(id)
    waiting.delete(key)
  }
  return sentIds
}
