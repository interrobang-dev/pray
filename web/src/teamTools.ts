/**
 * 팀장 대화의 팀 MCP 도구 알아보기 (순수). 서버 키는 지금 pray, 이름을 바꾸기 전에 만든 리드는 jk-corp 이고
 * 도구 이름도 team_* · jk_* 로 다르다. 옛 jsonl 이 남아 있어 둘 다 영구로 읽는다 — 서버와 이름은 따로 본다
 * (새 리드는 pray + team_*, 옛 리드는 jk-corp + jk_* 라 섞인 꼴은 생기지 않지만 받아도 해가 없다)
 */
const TEAM_SERVERS = ['pray', 'jk-corp']
const TEAM_TOOL_NAMES = {
  spawn: ['team_spawn_member', 'jk_spawn_member'],
  assign: ['team_assign', 'jk_assign'],
  wait: ['team_wait', 'jk_wait'],
} as const

/** 화면이 지시·보고 한 줄로 바꾸는 도구. status·dismiss 는 도구 블록 그대로라 알아볼 필요가 없다 */
export type TeamTool = keyof typeof TEAM_TOOL_NAMES

function teamToolOfParts(server: string, tool: string): TeamTool | null {
  if (!TEAM_SERVERS.includes(server)) return null
  for (const kind of Object.keys(TEAM_TOOL_NAMES) as TeamTool[]) {
    if ((TEAM_TOOL_NAMES[kind] as readonly string[]).includes(tool)) return kind
  }
  return null
}

/** 도구 호출 이름 `mcp__<서버>__<도구>` → 팀 도구 종류. 팀 도구가 아니면 null */
export function teamToolOf(name: string): TeamTool | null {
  const match = name.match(/^mcp__(.+?)__(.+)$/)
  return match ? teamToolOfParts(match[1], match[2]) : null
}

/** 백그라운드로 넘어간 MCP 호출의 끝 알림 요약이 팀 대기 도구 것인지. 요약 안에 `(<서버>/<도구>)` 꼴로 들어 있다 */
export function isTeamWaitSummary(summary: string): boolean {
  for (const match of summary.matchAll(/\(([^()/]+)\/([^()/]+)\)/g)) {
    if (teamToolOfParts(match[1], match[2]) === 'wait') return true
  }
  return false
}
