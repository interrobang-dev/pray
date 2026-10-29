import { describe, expect, it } from 'vitest'
import { isTeamWaitSummary, teamToolOf } from './teamTools'

describe('teamToolOf', () => {
  it('옛 리드(jk-corp + jk_*)와 새 리드(pray + team_*)의 도구 호출 이름을 같은 종류로 본다', () => {
    expect(teamToolOf('mcp__jk-corp__jk_spawn_member')).toBe('spawn')
    expect(teamToolOf('mcp__jk-corp__jk_assign')).toBe('assign')
    expect(teamToolOf('mcp__jk-corp__jk_wait')).toBe('wait')
    expect(teamToolOf('mcp__pray__team_spawn_member')).toBe('spawn')
    expect(teamToolOf('mcp__pray__team_assign')).toBe('assign')
    expect(teamToolOf('mcp__pray__team_wait')).toBe('wait')
  })

  it('서버와 이름을 따로 보므로 섞인 꼴도 알아본다', () => {
    expect(teamToolOf('mcp__jk-corp__team_wait')).toBe('wait')
    expect(teamToolOf('mcp__pray__jk_assign')).toBe('assign')
  })

  it('상태 보기·정리, 다른 MCP 서버, 일반 도구는 null', () => {
    for (const name of ['mcp__pray__team_status', 'mcp__jk-corp__jk_dismiss', 'mcp__other__team_wait', 'mcp__claude_ai_Claude_Docs__batch', 'Bash', 'team_wait']) {
      expect(teamToolOf(name)).toBeNull()
    }
  })
})

describe('isTeamWaitSummary', () => {
  it('백그라운드로 넘어간 대기 호출의 끝 알림 요약 (옛 jsonl 꼴 그대로와 새 이름)', () => {
    expect(isTeamWaitSummary('MCP task "jk_wait" (jk-corp/jk_wait) completed.')).toBe(true)
    expect(isTeamWaitSummary('MCP task … (jk-corp/jk_wait) completed.')).toBe(true)
    expect(isTeamWaitSummary('MCP task "team_wait" (pray/team_wait) completed.')).toBe(true)
  })

  it('다른 도구·다른 서버의 알림은 아니다', () => {
    expect(isTeamWaitSummary('MCP task "team_status" (pray/team_status) completed.')).toBe(false)
    expect(isTeamWaitSummary('MCP task "wait" (other/team_wait) completed.')).toBe(false)
    expect(isTeamWaitSummary('Background command "npm test" completed (exit code 0)')).toBe(false)
  })
})
