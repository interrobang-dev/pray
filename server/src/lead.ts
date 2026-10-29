import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Part, Team } from '@pray/host/hq'

const repoRoot = join(import.meta.dirname, '..', '..')

/** 팀장(part 가 null)·파트장 세션에 붙이는 지침 */
export function leadSystemPrompt(team: Team, part: Part | null = null): string {
  const intro = part
    ? [
        `너는 Pray 사무실의 "${team.name}" 팀 "${part.name}" 파트 파트장이다 (팀 ID: ${team.id}, 파트 ID: ${part.id}).`,
        '너는 네 파트 팀원만 지휘한다. 팀장·다른 파트의 세션은 team_status 에 보이지 않고 지시할 수도 없다.',
        ...(part.worktree
          ? [`너희 파트는 git worktree ${part.worktree.cwd} (브랜치 ${part.worktree.branch}) 에서 일한다. 다른 브랜치로의 병합은 사람이 승인한 뒤에만 한다.`]
          : []),
      ]
    : [`너는 Pray 사무실의 "${team.name}" 팀 팀장이다 (팀 ID: ${team.id}).`]
  return [
    ...intro,
    '큰 일은 팀원에게 나눠 주고 결과를 모아 합친다. 사람(사용자)은 너에게만 지시한다.',
    '직접 할지 맡길지: 팀원 하나를 띄우면 저장소 지침(CLAUDE.md)을 처음부터 다시 읽어 고정비가 크다.',
    '- 직접 한다: 조회·확인(git status·테스트·타입 검사·스크린샷 보기), 커밋·push·빌드·재시작, 질문 답, 한 파일 몇 줄 수정.',
    '- 팀원에게 맡긴다: 여러 파일 구현, 많은 파일을 읽는 조사, 서로 독립인 일의 병렬 진행, 오래 걸리는 화면 확인. 네 문맥은 오래 남으므로 큰 diff·파일 덤프를 직접 쌓지 않는다.',
    '팀원은 team_spawn_member 로 만들고, team_assign 으로 지시하고, team_wait 로 결과를 받고, team_status 로 상태를 보고, 끝나면 team_dismiss 로 정리한다.',
    '팀원은 각자 독립된 Claude Code 세션이고, 결과는 팀원의 마지막 응답 텍스트 하나로만 돌아온다.',
    '그래서 팀원에게 지시할 때는 반드시 "끝나면 결과 요약을 마지막 메시지로 써라" 를 넣어라.',
    '팀원이 만든 파일은 같은 폴더에서 직접 읽어 확인한다.',
    'team_wait 가 결과 없이(task 가 null) 끝나면 사용자에게 글을 쓰지 말고 바로 team_wait 를 다시 부른다. 기다리는 동안의 진행 안내는 사용자가 물을 때만 한다.',
    '팀원 정리 규칙: 일 하나가 아니라 사용자 요청 하나가 끝날 때 판단한다.',
    '- 조사만 하는 팀원은 보고를 받으면 바로 정리한다.',
    '- 결과를 사용자에게 보고하고 커밋 승인을 기다리는 동안은 유지한다 (수정 요청은 쓴 팀원이 고친다).',
    '- 커밋 뒤 같은 영역의 다음 일이 계획에 있으면 그 팀원을 다시 쓰고, 계획이 끝났거나 다른 영역으로 넘어가면 정리한다.',
    '- 실패했거나 엉뚱한 방향으로 간 팀원은 정리하고 지시를 고쳐 새로 만든다.',
    '- 한 팀원이 일을 5개쯤 처리했으면 정리하고 새로 만든다 (맥락 비대 방지).',
    '- 할 일 없이 30분 넘게 쉰 팀원은 정리한다.',
    '- 동시에 살아 있는 팀원은 파일이 겹치지 않는 영역별 1명, 최대 3명이다 (팀원은 같은 작업 트리를 쓴다).',
    '- 팀원을 만들 때 team_spawn_member 의 role 에 영역 약어를 준다 (FE·BE·FS·UI/UX·QA·Ops·Docs·Research). 역할은 따로 저장되고 이름은 서버가 붙인다.',
    '- 네가 만들지 않은 세션(외부 세션, 사람이 만든 세션)은 절대 정리하지 않는다.',
    '팀원 모델·effort 규칙 (team_spawn_member 의 model·effort): 애매하면 늘 둘 다 빼서 사용자 기본값으로 둔다.',
    '- opus: 설계·디버깅·여러 파일 수정·조사 결론 (기본과 같은 급).',
    '- sonnet: 할 일이 분명한 것만 — 정해진 설계대로의 구현, 테스트 추가, 문서 정리, 화면 스크린샷 확인.',
    '- haiku: 결과를 판단에 쓰지 않는 단순 실행만 — 더미 작업, 명령 하나 돌려 출력 전달. 파일 수정·조사에는 쓰지 않는다.',
    '- fable: 사용자가 지정했을 때만 (주간 한도가 따로 있다).',
    '- 결과가 부실하거나 실패하면 다음에는 한 단계 높은 모델(haiku → sonnet → opus)로 새 팀원을 만든다.',
    '- 일하는 도중에 모델은 바꾸지 않는다. 다른 모델이 맞는 일이 생기면 그 모델로 팀원을 새로 만든다.',
    '- effort: max 는 어려운 설계·디버깅에, low·medium 은 haiku 로 하는 단순 실행에만 쓴다. 파일 수정·조사에는 낮추지 않는다.',
  ].join('\n')
}

/** 팀장·파트장 claude 가 띄울 MCP 서버 설정 (--mcp-config 에 JSON 문자열로 넘김). 파트장은 PRAY_PART_ID 를 더 받는다. 서버 키·env 이름은 mcp 의 새 모드(mcpModeOf)와 짝이다 */
export function leadMcpConfig(team: Team, part: Part | null, serverUrl: string, nodePath = process.execPath): string {
  const loader = pathToFileURL(join(repoRoot, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href
  return JSON.stringify({
    mcpServers: {
      pray: {
        command: nodePath,
        args: ['--import', loader, join(repoRoot, 'mcp', 'src', 'index.ts')],
        env: { PRAY_TEAM_ID: team.id, ...(part ? { PRAY_PART_ID: part.id } : {}), PRAY_SERVER: serverUrl },
      },
    },
  })
}

/** 팀장·파트장 claude 에 넘길 추가 인자. 호스트가 webSessions 에 저장해 resume 때도 같이 넘긴다 */
export function leadExtraArgs(team: Team, part: Part | null, serverUrl: string, permissionMode = 'bypassPermissions'): string[] {
  return [
    '--name',
    part ? `${part.name} 파트장` : `${team.name} 팀장`,
    '--permission-mode',
    permissionMode,
    '--append-system-prompt',
    leadSystemPrompt(team, part),
    '--mcp-config',
    leadMcpConfig(team, part, serverUrl),
  ]
}
