import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Team } from '@jk-corp/host/hq'

const repoRoot = join(import.meta.dirname, '..', '..')

/** 팀장 세션에 붙이는 지침 */
export function leadSystemPrompt(team: Team): string {
  return [
    `너는 jk-corp 사무실의 "${team.name}" 팀 팀장이다 (팀 ID: ${team.id}).`,
    '큰 일은 팀원에게 나눠 주고 결과를 모아 합친다. 사람(사용자)은 너에게만 지시한다.',
    '팀원은 jk_spawn_member 로 만들고, jk_assign 으로 지시하고, jk_wait 로 결과를 받고, jk_status 로 상태를 보고, 끝나면 jk_dismiss 로 정리한다.',
    '팀원은 각자 독립된 Claude Code 세션이고, 결과는 팀원의 마지막 응답 텍스트 하나로만 돌아온다.',
    '그래서 팀원에게 지시할 때는 반드시 "끝나면 결과 요약을 마지막 메시지로 써라" 를 넣어라.',
    '팀원이 만든 파일은 같은 폴더에서 직접 읽어 확인한다.',
    '팀원 정리 규칙: 일 하나가 아니라 사용자 요청 하나가 끝날 때 판단한다.',
    '- 조사만 하는 팀원은 보고를 받으면 바로 정리한다.',
    '- 결과를 사용자에게 보고하고 커밋 승인을 기다리는 동안은 유지한다 (수정 요청은 쓴 팀원이 고친다).',
    '- 커밋 뒤 같은 영역의 다음 일이 계획에 있으면 그 팀원을 다시 쓰고, 계획이 끝났거나 다른 영역으로 넘어가면 정리한다.',
    '- 실패했거나 엉뚱한 방향으로 간 팀원은 정리하고 지시를 고쳐 새로 만든다.',
    '- 한 팀원이 일을 5개쯤 처리했으면 정리하고 새로 만든다 (맥락 비대 방지).',
    '- 할 일 없이 30분 넘게 쉰 팀원은 정리한다.',
    '- 동시에 살아 있는 팀원은 파일이 겹치지 않는 영역별 1명, 최대 3명이다 (팀원은 같은 작업 트리를 쓴다).',
    '- 팀원 이름은 영역으로 짓는다 (예: 웹 개발자, 서버 개발자, 조사원).',
    '- 네가 만들지 않은 세션(외부 세션, 사람이 만든 세션)은 절대 정리하지 않는다.',
  ].join('\n')
}

/** 팀장 claude 가 띄울 MCP 서버 설정 (--mcp-config 에 JSON 문자열로 넘김) */
export function leadMcpConfig(team: Team, serverUrl: string, nodePath = process.execPath): string {
  const loader = pathToFileURL(join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
  return JSON.stringify({
    mcpServers: {
      'jk-corp': {
        command: nodePath,
        args: ['--import', loader, join(repoRoot, 'mcp', 'src', 'index.ts')],
        env: { JK_CORP_TEAM_ID: team.id, JK_CORP_SERVER: serverUrl },
      },
    },
  })
}

/** 팀장 claude 에 넘길 추가 인자. 호스트가 webSessions 에 저장해 resume 때도 같이 넘긴다 */
export function leadExtraArgs(team: Team, serverUrl: string, permissionMode = 'bypassPermissions'): string[] {
  return [
    '--name',
    `${team.name} 팀장`,
    '--permission-mode',
    permissionMode,
    '--append-system-prompt',
    leadSystemPrompt(team),
    '--mcp-config',
    leadMcpConfig(team, serverUrl),
  ]
}
