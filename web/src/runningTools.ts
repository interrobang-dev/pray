import type { ChatMessage } from './types'

/** 화면에 보일 도구 이름. MCP 도구 `mcp__<서버>__<도구>` 는 백그라운드 알림 요약과 같은 `<서버>/<도구>` 로 줄인다 (작업 묶음 줄·작업 중 표시기) */
export function shortToolName(name: string): string {
  const match = name.match(/^mcp__(.+?)__(.+)$/)
  return match ? `${match[1]}/${match[2]}` : name
}

/**
 * 이번 차례에 실행 중인 도구 이름 (작업 중 표시기용). 차례 = 가장 최근 사람 쪽 메시지(대기 중 메시지 제외) 이후,
 * 실행 중 = 그 차례 claude 메시지의 도구 호출 중 결과가 아직 없는 것. 처음 나온 순서로, 같은 이름은 한 번만
 */
export function runningToolNames(messages: ChatMessage[]): string[] {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    // 대기 중 메시지는 아직 claude 가 받지 않아 차례를 시작하지 않았다
    if (messages[i].role === 'user' && !messages[i].isQueued) {
      start = i + 1
      break
    }
  }
  const names = new Set<string>()
  for (const message of messages.slice(start)) {
    if (message.role !== 'assistant') continue
    for (const toolUse of message.toolUses) {
      if (toolUse.result === null) names.add(shortToolName(toolUse.name))
    }
  }
  return [...names]
}
