import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { TeamApi } from './teamApi.js'

/** 도구 이름. 새 리드는 team_*, 이름을 바꾸기 전에 만든 리드(옛 env JK_CORP_* 로 띄운다)는 jk_* — 저장된 지침·대화 기록이 그 이름을 쓴다 */
export interface ToolNames {
  spawn: string
  assign: string
  wait: string
  status: string
  dismiss: string
}

const TEAM_TOOL_NAMES: ToolNames = { spawn: 'team_spawn_member', assign: 'team_assign', wait: 'team_wait', status: 'team_status', dismiss: 'team_dismiss' }
const LEGACY_TOOL_NAMES: ToolNames = { spawn: 'jk_spawn_member', assign: 'jk_assign', wait: 'jk_wait', status: 'jk_status', dismiss: 'jk_dismiss' }

export interface McpMode {
  /** MCP serverInfo 이름. 도구 전체 이름(mcp__<키>__<도구>)의 키는 --mcp-config 쪽이 정하고 새 리드는 pray, 옛 리드는 jk-corp 다 */
  serverName: string
  tools: ToolNames
  teamId: string
  partId: string | null
  baseUrl: string
}

/**
 * env 로 모드를 고른다. PRAY_TEAM_ID 가 있으면 새 모드(PRAY_PART_ID·PRAY_SERVER), 없고 JK_CORP_TEAM_ID 가 있으면 옛 모드(JK_CORP_PART_ID·JK_CORP_SERVER).
 * 섞어 읽지 않는다 — 옛 리드의 --mcp-config 에는 옛 env 만 있다. 둘 다 없으면 null
 */
export function mcpModeOf(env: Record<string, string | undefined>): McpMode | null {
  const prefix = env.PRAY_TEAM_ID ? 'PRAY' : env.JK_CORP_TEAM_ID ? 'JK_CORP' : null
  if (!prefix) return null
  return {
    serverName: prefix === 'PRAY' ? 'pray' : 'jk-corp',
    tools: prefix === 'PRAY' ? TEAM_TOOL_NAMES : LEGACY_TOOL_NAMES,
    teamId: env[`${prefix}_TEAM_ID`]!,
    partId: env[`${prefix}_PART_ID`] || null,
    baseUrl: env[`${prefix}_SERVER`] ?? 'http://127.0.0.1:4710',
  }
}

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }
}

/**
 * 대기 도구가 기다리는 동안 진행 알림을 보내는 간격. Claude Code 는 stdio MCP 호출이 응답·진행 알림 없이 30분
 * (CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT 기본값) 지나면 끊으므로 그보다 충분히 짧게
 */
const WAIT_PROGRESS_MS = 60_000

/** 도구 5개를 모드의 이름으로 등록한 MCP 서버. 설명 안의 도구 이름도 모드를 따른다 */
export function createTeamServer(mode: McpMode, api: TeamApi): McpServer {
  const names = mode.tools
  const server = new McpServer({ name: mode.serverName, version: '0.1.0' })

  server.registerTool(
    names.spawn,
    {
      description:
        '팀원 세션을 새로 만든다 (팀 폴더, 파트가 worktree 면 그 폴더). 사무실에 책상이 생기고 사람이 볼 수 있다. instruction 을 주면 첫 지시로 보내고 task 를 돌려준다. 팀원 결과는 마지막 응답 텍스트 하나로만 돌아오니 지시에 "끝나면 결과 요약을 마지막 메시지로 써라" 를 넣어라. model·effort 는 일에 맞게 고르되 애매하면 둘 다 빼라 (사용자 기본값 그대로).',
      inputSchema: {
        role: z
          .string()
          .optional()
          .describe(
            '팀원 역할 약어 (1~12자). 역할은 따로 저장되고(결과 member.position) 이름은 서버가 붙여 결과 member.name 으로 돌려준다. 권장: FE(화면), BE(서버·호스트), FS(풀스택), UI/UX, QA(검증·테스트), Ops(배포·인프라), Docs(문서), Research(조사)',
          ),
        name: z.string().optional().describe('예전 방식의 팀원 이름. role 이 있으면 쓰지 않는다. role 과 name 중 하나는 필요'),
        model: z
          .enum(['haiku', 'sonnet', 'opus', 'fable'])
          .optional()
          .describe(
            '팀원 모델 (선택). 빼면 사용자 기본 모델 — 애매하면 늘 뺀다. opus: 설계·디버깅·여러 파일 수정·조사 결론 (기본과 같은 급). sonnet: 할 일이 분명한 것만 (정해진 설계대로의 구현, 테스트 추가, 문서 정리, 화면 스크린샷 확인). haiku: 결과를 판단에 쓰지 않는 단순 실행만 (더미 작업, 명령 하나 돌려 출력 전달). 파일 수정·조사에는 쓰지 않는다. fable: 사용자가 지정했을 때만 (주간 한도가 따로 있다). 결과가 부실하거나 실패하면 다음에는 한 단계 높은 모델(haiku → sonnet → opus)로 새 팀원을 만든다. 일하는 도중에 모델은 바꾸지 않는다 — 다른 모델이 맞는 일이 생기면 그 모델로 팀원을 새로 만든다.',
          ),
        effort: z
          .enum(['low', 'medium', 'high', 'xhigh', 'max'])
          .optional()
          .describe(
            '팀원 effort (선택). 빼면 사용자 기본 effort — 애매하면 늘 뺀다. max: 어려운 설계·디버깅. low·medium: haiku 로 하는 단순 실행에만. 파일 수정·조사에는 낮추지 않는다.',
          ),
        instruction: z.string().optional().describe('첫 지시 (선택)'),
      },
    },
    async ({ role, name, model, effort, instruction }) => {
      try {
        return text(await api.spawnMember({ role, name, model, effort }, instruction))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    names.assign,
    {
      description: `팀원에게 지시를 보내고 task 를 만든다. 그 팀원에게 진행 중인 task 가 있으면 거부된다 (먼저 ${names.wait} 로 받아라).`,
      inputSchema: {
        sessionId: z.string().describe(`팀원 세션 ID (${names.status} 또는 ${names.spawn} 결과)`),
        instruction: z.string().describe('지시문. 마지막에 결과 요약을 쓰라는 말을 넣어라'),
      },
    },
    async ({ sessionId, instruction }) => {
      try {
        return text(await api.assign(sessionId, instruction))
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    names.wait,
    {
      description:
        'task 가 끝날 때까지(done·failed) 기다린다. 결과는 task.result (팀원의 마지막 응답), pendingTaskIds 는 아직 결과를 안 받은 task. 여러 팀원에게 일을 나눠 줬으면 하나씩 기다리지 말고 taskIds 로 한 번에 불러 먼저 끝난 것부터 받고, 남은 pendingTaskIds 로 다시 부른다. taskId·taskIds 를 다 빼면 지휘 단위의 아무 task 하나. 시간 안에 안 끝나면 task 가 null 로 돌아오니 다시 호출하면 된다.',
      inputSchema: {
        taskId: z.string().optional().describe('기다릴 task ID 하나'),
        taskIds: z.array(z.string()).optional().describe('여러 task 를 한꺼번에 기다릴 때 ID 목록. 그중 먼저 끝난 하나를 돌려준다'),
        timeoutSec: z.number().int().min(1).max(3600).optional().describe('최대 대기 초. 기본 1800, 최대 3600'),
      },
    },
    async ({ taskId, taskIds, timeoutSec }, extra) => {
      const ids = [...new Set([...(taskId ? [taskId] : []), ...(taskIds ?? [])])]
      const progressToken = extra._meta?.progressToken
      let progress = 0
      const progressTimer =
        progressToken === undefined
          ? null
          : setInterval(() => {
              progress += 1
              extra
                .sendNotification({ method: 'notifications/progress', params: { progressToken, progress, message: '팀원 task 기다리는 중' } })
                .catch(() => {})
            }, WAIT_PROGRESS_MS)
      try {
        return text(await api.wait(ids, timeoutSec ?? 1800, extra.signal))
      } catch (error) {
        return failure(error)
      } finally {
        if (progressTimer) clearInterval(progressTimer)
      }
    },
  )

  server.registerTool(
    names.status,
    {
      description:
        '팀의 세션 목록(role = 지휘자·팀원 구분, position = 역할 약어, 웹/외부·상태·모델·effort·마지막 말)과 task 목록을 본다. 모델·effort 는 마지막 응답 기준이라 아직 대화가 없으면 null 이다. contextTokens = 팀원의 지금 문맥 크기(토큰, 마지막 응답 기준. 모르면 null), idleSince = 차례를 끝내고 쉬기 시작한 시각(ISO. 일하는 중이면 null) — 팀원을 다시 쓸지 정리할지 볼 때 쓴다. 지시할 수 있는 대상은 role 이 member 인 세션뿐이다.',
      inputSchema: {},
    },
    async () => {
      try {
        return text(await api.status())
      } catch (error) {
        return failure(error)
      }
    },
  )

  server.registerTool(
    names.dismiss,
    {
      description: '팀원 세션을 종료하고 팀에서 뺀다. 같은 영역 일이 남았으면 정리하지 말고 다시 쓴다. 정리할 때: contextTokens 가 15만을 넘음, 60분 넘게 쉼(idleSince), 계획에 그 영역 일이 더 없음, 실패·엉뚱한 방향. 문맥 때문에 정리하면 먼저 그 팀원에게 알게 된 것·고친 파일·남은 일 요약을 받아 새 팀원 첫 지시에 붙인다. 네가 만들지 않은 세션은 정리하지 않는다.',
      inputSchema: { sessionId: z.string().describe('팀원 세션 ID') },
    },
    async ({ sessionId }) => {
      try {
        await api.dismiss(sessionId)
        return text(`팀원 ${sessionId.slice(0, 8)} 종료`)
      } catch (error) {
        return failure(error)
      }
    },
  )

  return server
}
