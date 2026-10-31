import { randomUUID } from 'node:crypto'
import type { HookPayload } from './hookState.js'
import type { TurnOutcome } from './transcript.js'

export type TaskStatus = 'running' | 'done' | 'failed'

export interface Task {
  id: string
  teamId: string
  /** 지휘 단위. null 이면 팀 직속 (팀장이 지시) */
  partId: string | null
  memberSessionId: string
  instruction: string
  status: TaskStatus
  /** 팀원이 UserPromptSubmit 훅으로 지시를 받았다고 확인했는지 */
  isAcknowledged: boolean
  /** Stop 훅의 last_assistant_message */
  result: string | null
  error: string | null
  createdAt: string
  finishedAt: string | null
  /** wait 가 이 task 를 한 번 돌려줬는지. taskId 없는 wait·여러 task wait 가 같은 결과를 두 번 주지 않게 */
  isDelivered: boolean
  /** 운영 기록: 지시할 때 팀원의 문맥 크기 (세션 목록의 contextTokens. 새 팀원·모르면 null) */
  startContextTokens: number | null
  /** 운영 기록: 지시할 때 팀원이 쉬기 시작한 시각 (team_status 의 idleSince. 일하는 중·새 팀원이면 null) */
  startIdleSince: string | null
  /** 운영 기록: 끝난 뒤 읽은 팀원의 문맥 크기 (끝난 직후 jsonl 요약. 못 읽었으면 null) */
  endContextTokens: number | null
}

/** 지시할 때의 팀원 상태 (운영 기록) */
export interface TaskStart {
  contextTokens: number | null
  idleSince: string | null
}

const UNKNOWN_START: TaskStart = { contextTokens: null, idleSince: null }

/** 서버 재시작 전에 running 이던 task 를 정리할 때 보는 팀원 상태. 세션 목록에 없으면 null */
export interface RestoredMember {
  isAlive: boolean
  /** jsonl 마지막 대화 줄 시각 (transcript.ts turnEndedAt) */
  turnEndedAt: string | null
  /** jsonl 마지막 차례. jsonl 이 없으면 null */
  turn: TurnOutcome | null
}

export type RestoredOutcome =
  | { status: 'running'; isAcknowledged: boolean }
  | { status: 'done'; result: string }
  | { status: 'failed'; error: string }

export const RESTORED_GONE_ERROR = '서버가 재시작하는 동안 팀원 세션이 끝남'
export const RESTORED_CUT_ERROR = '서버가 재시작하는 동안 팀원의 차례가 끊김'

/**
 * 서버 재시작 전에 running 이던 task 의 결말 (순수). 그 사이 훅(Stop·UserPromptSubmit)은 서버가 못 받았으므로 jsonl 로 메운다.
 * 팀원이 근무 중이 아니면 failed (프로세스가 없으니 Stop 이 영영 안 온다).
 * 근무 중이고 jsonl 의 마지막 대화 줄이 지시 뒤(turnEndedAt ≥ createdAt)면 그 차례는 이 지시의 것이다:
 * ended → done(그 차례의 마지막 글), interrupted·cut → failed, in-progress → running 이고 접수된 것으로 본다.
 * 지시 뒤 대화 줄이 없으면 running 그대로 (평소처럼 다음 Stop·접수 시간 초과가 끝낸다)
 */
export function restoredOutcome(task: Pick<Task, 'createdAt' | 'isAcknowledged'>, member: RestoredMember | null): RestoredOutcome {
  if (!member?.isAlive) return { status: 'failed', error: RESTORED_GONE_ERROR }
  const endedAt = member.turnEndedAt === null ? Number.NaN : new Date(member.turnEndedAt).getTime()
  const isAfter = endedAt >= new Date(task.createdAt).getTime()
  if (!isAfter || !member.turn) return { status: 'running', isAcknowledged: task.isAcknowledged }
  if (member.turn.kind === 'ended') return { status: 'done', result: member.turn.text ?? '' }
  if (member.turn.kind === 'interrupted' || member.turn.kind === 'cut') return { status: 'failed', error: RESTORED_CUT_ERROR }
  return { status: 'running', isAcknowledged: true }
}

export interface TaskStoreHooks {
  /** task 가 만들어지거나 바뀌면 (파일 저장용). 던지지 않아야 한다 */
  onChange?: () => void
  /** task 가 끝나면 (끝난 뒤 문맥 크기 기록용). 던지지 않아야 한다 */
  onFinish?: (task: Task) => void
}

/**
 * 지시를 보내고 이 시간 안에 UserPromptSubmit 이 안 오면 실패 (터미널이 입력을 못 받는 상태).
 * 서버가 Enter 를 출력 안정 뒤에 보내므로 그 최대 대기(8초) + 접수 여유 5초
 */
export const ACK_TIMEOUT_MS = 13_000

/** 사람이 중지한 task 의 error. 지시자가 team_wait(옛 리드는 jk_wait) 결과로 본다 */
export const INTERRUPTED_ERROR = '사람이 웹 화면에서 팀원의 작업을 중지함'

type Waiter = {
  /** 기다리는 task. null 이면 지휘 단위의 아무 task */
  taskIds: ReadonlySet<string> | null
  teamId: string
  partId: string | null
  resolve: (task: Task | null) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * 팀장이 팀원에게 준 task 의 상태 기계. 파일 저장은 밖(teamTaskFile.ts)이 onChange 로 하고 서버 시작 때 restore 로 되살린다.
 * 전이: assign → running → (Stop) done | (ack 없음·exit·중지) failed. 되살린 running 은 reconcileRestored 가 jsonl 로 정리한다
 */
export class TaskStore {
  private readonly tasks = new Map<string, Task>()
  private readonly waiters = new Set<Waiter>()
  /** 되살렸는데 아직 jsonl 로 정리하지 않은 running task. 정리 전에는 접수 시간 초과로 끝내지 않는다 (그 사이 접수됐을 수 있다) */
  private readonly unreconciled = new Set<string>()

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly hooks: TaskStoreHooks = {},
  ) {}

  /** 저장된 task 를 넣는다 (서버 시작 때 한 번, 넣은 순서 = 오래된 것 먼저). running 은 reconcileRestored 를 기다린다 */
  restore(tasks: readonly Task[]): void {
    for (const task of tasks) {
      this.tasks.set(task.id, { ...task })
      if (task.status === 'running') this.unreconciled.add(task.id)
    }
  }

  /** 저장할 task 전부 (넣은 순서) */
  list(): Task[] {
    return [...this.tasks.values()]
  }

  hasUnreconciled(): boolean {
    return this.unreconciled.size > 0
  }

  /** 되살린 running task 를 restoredOutcome 규칙으로 정리한다. lookup 은 팀원 세션 ID → 상태(목록에 없으면 null) */
  reconcileRestored(lookup: (memberSessionId: string) => RestoredMember | null): void {
    let isChanged = false
    for (const id of [...this.unreconciled]) {
      this.unreconciled.delete(id)
      const task = this.tasks.get(id)
      if (!task || task.status !== 'running') continue
      const outcome = restoredOutcome(task, lookup(task.memberSessionId))
      if (outcome.status === 'done') this.finish(task, 'done', outcome.result, null)
      else if (outcome.status === 'failed') this.finish(task, 'failed', null, outcome.error)
      else if (outcome.isAcknowledged !== task.isAcknowledged) {
        task.isAcknowledged = outcome.isAcknowledged
        isChanged = true
      }
    }
    if (isChanged) this.changed()
  }

  /** 끝난 지 retentionMs 가 지난 task 를 지운다 (running 은 두고). 지운 개수. onChange 를 부르지 않는다 (저장하는 쪽이 부른다) */
  prune(retentionMs: number): number {
    const limit = this.now().getTime() - retentionMs
    let count = 0
    for (const [id, task] of this.tasks) {
      if (task.finishedAt === null || new Date(task.finishedAt).getTime() >= limit) continue
      this.tasks.delete(id)
      count++
    }
    return count
  }

  /** 끝난 뒤 읽은 문맥 크기 (운영 기록) */
  setEndContextTokens(taskId: string, contextTokens: number | null): void {
    const task = this.tasks.get(taskId)
    if (!task || task.endContextTokens === contextTokens) return
    task.endContextTokens = contextTokens
    this.changed()
  }

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }

  /** 지휘 단위(팀 직속 또는 파트)의 task. 팀으로만 거르면 한 지시자가 다른 단위의 결과를 가로챈다 */
  listByUnit(teamId: string, partId: string | null = null): Task[] {
    return [...this.tasks.values()].filter((t) => t.teamId === teamId && t.partId === partId)
  }

  /** 그 팀원이 받은 가장 최근 task (지휘 단위와 무관). 없으면 undefined. 표시 상태 done 판정에 쓴다 (turnEnd.ts) */
  latestOf(memberSessionId: string): Task | undefined {
    let latest: Task | undefined
    // Map 은 넣은 순서라 마지막 것이 가장 최근이다
    for (const task of this.tasks.values()) if (task.memberSessionId === memberSessionId) latest = task
    return latest
  }

  /** 같은 팀원에게 running task 가 있으면 거부한다. 지시자가 순서를 지키게 강제 */
  assign(
    teamId: string,
    memberSessionId: string,
    instruction: string,
    partId: string | null = null,
    start: TaskStart = UNKNOWN_START,
  ): Task {
    const isBusy = [...this.tasks.values()].some((t) => t.memberSessionId === memberSessionId && t.status === 'running')
    if (isBusy) throw new TaskConflictError(memberSessionId)
    const task: Task = {
      id: randomUUID().slice(0, 8),
      teamId,
      partId,
      memberSessionId,
      instruction,
      status: 'running',
      isAcknowledged: false,
      result: null,
      error: null,
      createdAt: this.now().toISOString(),
      finishedAt: null,
      isDelivered: false,
      startContextTokens: start.contextTokens,
      startIdleSince: start.idleSince,
      endContextTokens: null,
    }
    this.tasks.set(task.id, task)
    this.changed()
    return task
  }

  applyHook(payload: HookPayload): void {
    const task = this.runningOf(payload.session_id)
    if (!task) return
    if (payload.hook_event_name === 'UserPromptSubmit' && !task.isAcknowledged) {
      task.isAcknowledged = true
      this.changed()
    }
    if (payload.hook_event_name === 'Stop') this.finish(task, 'done', payload.last_assistant_message ?? '', null)
  }

  /** 팀원 세션이 종료되면 그 팀원의 running task 는 실패 */
  markExited(sessionId: string): void {
    const task = this.runningOf(sessionId)
    if (task) this.finish(task, 'failed', null, '팀원 세션이 종료됨')
  }

  /** 사람이 웹에서 팀원을 중지하면 그 팀원의 running task 는 실패. 중지에는 Stop 훅이 오지 않아 두면 끝나지 않는다 */
  markInterrupted(sessionId: string): void {
    const task = this.runningOf(sessionId)
    if (task) this.finish(task, 'failed', null, INTERRUPTED_ERROR)
  }

  /** ack 없이 ACK_TIMEOUT_MS 가 지난 task 를 실패로. 주기적으로 호출한다 */
  expireUnacknowledged(): void {
    const limit = this.now().getTime() - ACK_TIMEOUT_MS
    for (const task of this.tasks.values()) {
      if (task.status !== 'running' || task.isAcknowledged || this.unreconciled.has(task.id)) continue
      if (new Date(task.createdAt).getTime() <= limit) this.finish(task, 'failed', null, '팀원이 지시를 받지 못함 (터미널 입력 불가 상태)')
    }
  }

  /**
   * task 가 끝날 때까지 기다린다. taskIds 가 null 이면 지휘 단위의 아무 task, 목록이면 그중 먼저 끝나는 것 하나.
   * 끝났는데 아직 안 가져간(isDelivered false) 것이 있으면 즉시 그것을 주고 가져간 것으로 표시한다.
   * 다 끝났고 다 가져갔으면: task 하나를 콕 집어 물었으면 그것을 다시 주고, 아니면 null.
   * 모르는 task·다른 단위의 task 는 없는 것으로 보고 남는 게 없으면 null 즉시, 타임아웃·signal abort 면 null
   */
  wait(
    teamId: string,
    taskIds: string | readonly string[] | null,
    timeoutMs: number,
    partId: string | null = null,
    signal?: AbortSignal,
  ): Promise<Task | null> {
    const ids = taskIds === null ? null : new Set(typeof taskIds === 'string' ? [taskIds] : taskIds)
    const candidates = this.candidatesOf(teamId, partId, ids)
    const finished = candidates.find((t) => t.status !== 'running' && !t.isDelivered)
    if (finished) {
      finished.isDelivered = true
      this.changed()
      return Promise.resolve(finished)
    }
    if (!candidates.some((t) => t.status === 'running')) {
      return Promise.resolve(ids?.size === 1 && candidates.length === 1 ? candidates[0] : null)
    }
    if (signal?.aborted) return Promise.resolve(null)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.waiters.delete(waiter)) resolve(null)
      }, timeoutMs)
      timer.unref?.()
      const waiter: Waiter = { taskIds: ids, teamId, partId, resolve, timer }
      this.waiters.add(waiter)
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.waiters.delete(waiter)) return
          clearTimeout(timer)
          resolve(null)
        },
        { once: true },
      )
    })
  }

  /** 아직 결과를 안 가져간 task ID (진행 중 + 끝났지만 안 가져간 것). taskIds 는 wait 와 같다. 지시자가 다음 wait 에 쓴다 */
  pendingIds(teamId: string, taskIds: string | readonly string[] | null, partId: string | null = null): string[] {
    const ids = taskIds === null ? null : new Set(typeof taskIds === 'string' ? [taskIds] : taskIds)
    return this.candidatesOf(teamId, partId, ids)
      .filter((t) => t.status === 'running' || !t.isDelivered)
      .map((t) => t.id)
  }

  /** 지휘 단위의 task 중 ids 에 든 것 (ids 가 null 이면 전부). 넣은 순서(오래된 것 먼저) */
  private candidatesOf(teamId: string, partId: string | null, ids: ReadonlySet<string> | null): Task[] {
    const unitTasks = this.listByUnit(teamId, partId)
    return ids === null ? unitTasks : unitTasks.filter((t) => ids.has(t.id))
  }

  private runningOf(sessionId: string): Task | undefined {
    return [...this.tasks.values()].find((t) => t.memberSessionId === sessionId && t.status === 'running')
  }

  private finish(task: Task, status: 'done' | 'failed', result: string | null, error: string | null): void {
    task.status = status
    task.result = result
    task.error = error
    task.finishedAt = this.now().toISOString()
    this.unreconciled.delete(task.id)
    for (const waiter of this.waiters) {
      if (waiter.teamId !== task.teamId || waiter.partId !== task.partId) continue
      if (waiter.taskIds !== null && !waiter.taskIds.has(task.id)) continue
      this.waiters.delete(waiter)
      clearTimeout(waiter.timer)
      task.isDelivered = true
      waiter.resolve(task)
    }
    this.changed()
    this.hooks.onFinish?.(task)
  }

  private changed(): void {
    this.hooks.onChange?.()
  }
}

export class TaskConflictError extends Error {
  constructor(memberSessionId: string) {
    super(`Member ${memberSessionId.slice(0, 8)} already has a running task`)
  }
}
