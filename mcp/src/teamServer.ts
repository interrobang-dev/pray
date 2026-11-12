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
  remind: string
}

const TEAM_TOOL_NAMES: ToolNames = {
  spawn: 'team_spawn_member',
  assign: 'team_assign',
  wait: 'team_wait',
  status: 'team_status',
  dismiss: 'team_dismiss',
  remind: 'team_remind',
}
const LEGACY_TOOL_NAMES: ToolNames = {
  spawn: 'jk_spawn_member',
  assign: 'jk_assign',
  wait: 'jk_wait',
  status: 'jk_status',
  dismiss: 'jk_dismiss',
  remind: 'jk_remind',
}

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

/** 도구 6개를 모드의 이름으로 등록한 MCP 서버. 설명 안의 도구 이름도 모드를 따른다 */
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
        'task 가 끝날 때까지(done·failed) 기다린다. 결과는 task.result (팀원의 마지막 응답), pendingTaskIds 는 아직 결과를 안 받은 task. 여러 팀원에게 일을 나눠 줬으면 하나씩 기다리지 말고 taskIds 로 한 번에 불러 먼저 끝난 것부터 받고, 남은 pendingTaskIds 로 다시 부른다. taskId·taskIds 를 다 빼면 지휘 단위의 아무 task 하나. 시간 안에 안 끝나면 task 가 null 로 돌아오니 다시 호출하면 된다. 이미 받은 task 도 taskId 하나로 부르면 전문을 다시 준다 (끝난 지 7일 지난 것은 지워져 null).',
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
        `팀의 세션 목록(role = 지휘자·팀원 구분, position = 역할 약어, 웹/외부·상태·모델·effort·마지막 말)과 task 목록을 본다. 모델·effort 는 마지막 응답 기준이라 아직 대화가 없으면 null 이다. contextTokens = 팀원의 지금 문맥 크기(토큰, 마지막 응답 기준. 모르면 null), idleSince = 차례를 끝내고 쉬기 시작한 시각(ISO. 일하는 중이면 null) — 팀원을 다시 쓸지 정리할지 볼 때 쓴다. 지시할 수 있는 대상은 members 에 있는 role 이 member 인 세션뿐이다. members 에는 근무 중인 세션만 싣고, 휴식·퇴근한 세션은 inactiveMembers 에 짧게(sessionId·name·position·attendance(break = 호스트 재시작 중이라 곧 돌아옴, off = 퇴근)·endedAt·reason(released = 정리함, dismissed = 사람이 종료, exit·error = 스스로 끝남)) 휴식·최근 퇴근부터 10명만 싣고 전체 수는 inactiveMemberCount 다 — 여기 있는 세션에는 지시할 수 없다 (task 의 memberSessionId 가 누구인지 볼 때 쓴다). 응답을 줄이려고 tasks 는 진행 중·결과를 아직 안 받은 것 전부와 끝나고 받은 것 중 최근 5개만 싣고, task 의 instruction·result 와 팀원의 마지막 말은 앞 200자만(넘으면 "…") 싣는다. 결과 전문은 ${names.wait} 를 그 taskId 로 부르면 다시 받는다.`,
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

  server.registerTool(
    names.remind,
    {
      description:
        '사람(사용자)에게 정한 시각에 한 번 울리는 알림을 Pray 화면(Reminders)에 등록한다. 사용자가 "30분 뒤 배포 확인하라고 알려줘"·"15시에 회의 알려줘" 처럼 자기에게 알려 달라고 하면 ScheduleWakeup·CronCreate 같은 내장 예약 도구가 아니라 이 도구를 쓴다 — 그것들은 너를 깨울 뿐 사람에게 알리지 않고 세션이 끝나면 사라진다. "30분 뒤"처럼 지금부터의 시간이면 inMinutes, "15시"처럼 시각이면 at 을 준다 (둘 중 정확히 하나). 시각을 계산하려고 지금 시각이 필요하면 셸에서 date 로 본다. 알림은 사람에게만 가고 너를 깨우지 않는다 — 그 시각에 네가 할 일이 있으면 이 도구로는 안 된다. 취소·목록 보기는 사람이 화면에서 한다. 결과의 firesAt(이 PC 시각)으로 사용자에게 언제 울리는지 확인해 줘라.',
      inputSchema: {
        text: z.string().describe('알림 글 (1~500자, 줄바꿈은 공백이 된다). 사람이 읽고 바로 알 수 있게 쓴다'),
        at: z
          .string()
          .optional()
          .describe('울릴 시각. 2026-11-12T15:30 꼴 — 오프셋을 안 붙이면 이 PC 시각, Z·+09:00 을 붙이면 그 기준. 날짜만은 안 된다. 1분 넘게 지난 시각·1년 넘게 먼 시각은 거절된다'),
        inMinutes: z.number().positive().optional().describe('지금부터 몇 분 뒤에 울릴지 (예: 30)'),
      },
    },
    async ({ text: reminderText, at, inMinutes }) => {
      const now = new Date()
      const resolved = reminderAtOf(at, inMinutes, now)
      if ('error' in resolved) return failure(resolved.error)
      try {
        const result = (await api.remind(reminderText, resolved.at)) as { reminder?: { at?: string } }
        const firesAt = result.reminder?.at ? localTimeText(new Date(result.reminder.at)) : null
        return text({ ...result, firesAt, now: localTimeText(now) })
      } catch (error) {
        return failure(error)
      }
    },
  )

  return server
}

/** team_remind 의 at·inMinutes 중 정확히 하나를 서버에 보낼 at 으로. inMinutes 는 이 PC 시계로 UTC ISO 로 바꾼다 (서버와 같은 PC). at 검증은 서버가 한다 */
export function reminderAtOf(at: string | undefined, inMinutes: number | undefined, now: Date): { at: string } | { error: string } {
  const hasAt = at !== undefined && at.trim() !== ''
  const hasMinutes = inMinutes !== undefined
  if (hasAt === hasMinutes) return { error: 'at 과 inMinutes 중 정확히 하나를 줘라 ("30분 뒤" 는 inMinutes, "15시" 는 at)' }
  if (hasAt) return { at: at!.trim() }
  if (!Number.isFinite(inMinutes) || inMinutes! <= 0) return { error: 'inMinutes 는 0 보다 큰 수여야 한다' }
  return { at: new Date(now.getTime() + inMinutes! * 60_000).toISOString() }
}

/** 이 PC 시각 글자 "2026-11-12 15:30 (UTC+09:00)". 리드가 사용자에게 울릴 시각을 확인해 줄 때 쓴다 */
export function localTimeText(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const offset = `${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} (UTC${sign}${offset})`
}
