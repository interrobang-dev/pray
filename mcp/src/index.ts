import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { TeamApi } from './teamApi.js'

/**
 * 팀장·파트장 claude 세션에 붙는 stdio MCP 서버. 서버의 /api/team/* 를 호출하는 얇은 어댑터.
 * 지시자는 --mcp-config 로 이 프로세스를 띄우고, env 로 팀 ID·서버 주소(파트장은 파트 ID 도)를 받는다.
 * 도구가 보는 "팀" 은 자기 지휘 단위(팀장 = 팀 직속, 파트장 = 그 파트)다.
 */
const teamId = process.env.JK_CORP_TEAM_ID
const partId = process.env.JK_CORP_PART_ID || null
const baseUrl = process.env.JK_CORP_SERVER ?? 'http://127.0.0.1:4710'
if (!teamId) {
  console.error('JK_CORP_TEAM_ID 환경변수 필요')
  process.exit(1)
}
const api = new TeamApi(baseUrl, teamId, partId)

const server = new McpServer({ name: 'jk-corp', version: '0.1.0' })

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] }
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] }
}

server.registerTool(
  'jk_spawn_member',
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
  'jk_assign',
  {
    description: '팀원에게 지시를 보내고 task 를 만든다. 그 팀원에게 진행 중인 task 가 있으면 거부된다 (먼저 jk_wait 로 받아라).',
    inputSchema: {
      sessionId: z.string().describe('팀원 세션 ID (jk_status 또는 jk_spawn_member 결과)'),
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
  'jk_wait',
  {
    description:
      'task 가 끝날 때까지 기다린다. taskId 를 생략하면 팀의 아무 task 든 먼저 끝나는 것 하나. 시간 안에 안 끝나면 task 가 null 로 돌아오니 다시 호출하면 된다. 결과는 result 필드 (팀원의 마지막 응답).',
    inputSchema: {
      taskId: z.string().optional().describe('기다릴 task ID. 생략하면 아무 task'),
      // fetch(undici)가 응답 헤더를 300초(headersTimeout)까지만 기다려서 그 아래로 막는다
      timeoutSec: z.number().int().min(1).max(280).optional().describe('최대 대기 초. 기본 120, 최대 280'),
    },
  },
  async ({ taskId, timeoutSec }) => {
    try {
      return text(await api.wait(taskId ?? null, timeoutSec ?? 120))
    } catch (error) {
      return failure(error)
    }
  },
)

server.registerTool(
  'jk_status',
  {
    description:
      '팀의 세션 목록(role = 지휘자·팀원 구분, position = 역할 약어, 웹/외부·상태·모델·effort·마지막 말)과 task 목록을 본다. 모델·effort 는 마지막 응답 기준이라 아직 대화가 없으면 null 이다. 지시할 수 있는 대상은 role 이 member 인 세션뿐이다.',
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
  'jk_dismiss',
  {
    description: '팀원 세션을 종료하고 팀에서 뺀다. 일이 끝난 팀원은 정리해라.',
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

await server.connect(new StdioServerTransport())
