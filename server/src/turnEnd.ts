import type { TaskStatus } from './teamState.js'

/**
 * 차례가 끝난 근무 세션(훅 my-turn)의 표시 상태를 가른다 (순수). 훅 상태 자체는 그대로 두고 화면·jk_status 에 보일 값만 정한다
 * — 대기 취소·중지·모델 변경처럼 훅 상태를 보는 판정이 흔들리지 않게
 */

export interface TurnEndFacts {
  /** jsonl 에 끝나면 claude 를 깨울 백그라운드 작업(MCP 호출·에이전트. shell 은 뺀다)이 돈다 (shells.ts hasWakingTask) */
  hasRunningBackground: boolean
  /** 팀원 세션이면 그 팀원의 가장 최근 task (teamState). 팀원이 아니거나 task 가 없으면 null */
  latestTask: { status: TaskStatus; finishedAt: string | null } | null
  /** 마지막 UserPromptSubmit 시각 (HookState.lastPromptAt) */
  lastPromptAt: string | null
  /** 웹 중지로 my-turn 이 됐다 (HookState.isInterrupted) */
  isInterrupted: boolean
  /** 마지막 claude 말 (Session.lastAssistantText) */
  lastAssistantText: string | null
}

/** 물음표를 찾는 끝 줄 수 (빈 줄 제외) */
export const QUESTION_TAIL_LINES = 6

/**
 * 마지막 말이 물음으로 끝나는지: 끝 6줄(끝의 마크다운 기호 `*_\`` 와 공백을 떼고 빈 줄이 된 것 — 코드 울타리·강조만 있는 줄 — 은 세지 않는다)
 * 안에 '?' 나 '？' 가 있다. 끝맺음 뒤에 "확인해 주시겠어요?" 같은 질문 + 선택지 목록이 붙는 꼴을 잡으려고 마지막 한 줄이 아니라 6줄을 본다
 */
export function endsWithQuestion(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/[*_`\s]+$/, ''))
    .filter((line) => line.trim() !== '')
  return lines.slice(-QUESTION_TAIL_LINES).some((line) => line.includes('?') || line.includes('？'))
}

function timeOf(iso: string | null): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

/**
 * 팀원이 받은 가장 최근 지시를 끝냈고 그 뒤에 새 차례가 없다. task 는 그 차례의 Stop 훅에서 done 이 되므로(finishedAt = Stop 처리 시각)
 * 그 차례를 시작한 UserPromptSubmit 은 finishedAt 보다 앞이고, 사람이 그 뒤에 새 차례를 시작했으면 lastPromptAt 이 finishedAt 보다 뒤다
 */
function isTaskDone(facts: TurnEndFacts): boolean {
  const { latestTask } = facts
  if (latestTask?.status !== 'done') return false
  const finishedAt = timeOf(latestTask.finishedAt)
  if (finishedAt === null) return false
  const lastPromptAt = timeOf(facts.lastPromptAt)
  return lastPromptAt === null || finishedAt >= lastPromptAt
}

/**
 * 차례가 끝난 근무 세션의 표시 상태. 이 순서로 처음 맞는 것:
 * 1. waiting — 백그라운드 작업이 돈다 (끝나면 claude 가 알림을 받아 이어서 일한다)
 * 2. done — 팀원이 받은 가장 최근 지시를 끝냈고 그 뒤 새 차례가 없다
 * 3. my-turn — 웹 중지로 멈췄거나 마지막 말이 없다 (무엇을 할지 사람이 정해야 한다)
 * 4. my-turn — 마지막 말이 물음으로 끝난다 (endsWithQuestion)
 * 5. done
 */
export function turnEndStatus(facts: TurnEndFacts): 'waiting' | 'done' | 'my-turn' {
  if (facts.hasRunningBackground) return 'waiting'
  if (isTaskDone(facts)) return 'done'
  if (facts.isInterrupted || !facts.lastAssistantText?.trim()) return 'my-turn'
  if (endsWithQuestion(facts.lastAssistantText)) return 'my-turn'
  return 'done'
}
