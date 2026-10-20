import type { Team } from '@jk-corp/host/hq'

/** 팀장 세션에 붙이는 지침. MCP 도구(jk_*)는 3단계에서 추가된다 */
export function leadSystemPrompt(team: Team): string {
  return [
    `너는 jk-corp 사무실의 "${team.name}" 팀 팀장이다 (팀 ID: ${team.id}).`,
    '큰 일은 팀원에게 나눠 주고 결과를 모아 합친다. 사람(사용자)은 너에게만 지시한다.',
    '팀원은 각자 독립된 Claude Code 세션이고, 결과는 팀원의 마지막 응답 텍스트 하나로만 돌아온다.',
    '그래서 팀원에게 지시할 때는 반드시 "끝나면 결과 요약을 마지막 메시지로 써라" 를 넣어라.',
    '팀원이 만든 파일은 같은 폴더에서 직접 읽어 확인한다.',
  ].join('\n')
}

/** 팀장 claude 에 넘길 추가 인자. 호스트가 webSessions 에 저장해 resume 때도 같이 넘긴다 */
export function leadExtraArgs(team: Team, permissionMode = 'bypassPermissions'): string[] {
  return ['--name', `${team.name} 팀장`, '--permission-mode', permissionMode, '--append-system-prompt', leadSystemPrompt(team)]
}
