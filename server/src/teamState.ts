import { randomUUID } from 'node:crypto'
import type { HookPayload } from './hookState.js'

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
  /** taskId 없는 wait 가 이 task 를 한 번 돌려줬는지 (같은 결과를 두 번 주지 않게) */
  isDelivered: boolean
}

/**
 * 지시를 보내고 이 시간 안에 UserPromptSubmit 이 안 오면 실패 (터미널이 입력을 못 받는 상태).
 * 서버가 Enter 를 출력 안정 뒤에 보내므로 그 최대 대기(8초) + 접수 여유 5초
 */
export const ACK_TIMEOUT_MS = 13_000

type Waiter = { taskId: string | null; teamId: string; partId: string | null; resolve: (task: Task | null) => void }

/**
 * 팀장이 팀원에게 준 task 의 상태 기계. 서버 메모리에만 있다 (훅 상태와 같은 수명).
 * 전이: assign → running → (Stop) done | (ack 없음·exit) failed
 */
export class TaskStore {
  private readonly tasks = new Map<string, Task>()
  private readonly waiters = new Set<Waiter>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  get(taskId: string): Task | undefined {
    return this.tasks.get(taskId)
  }

  /** 지휘 단위(팀 직속 또는 파트)의 task. 팀으로만 거르면 한 지시자가 다른 단위의 결과를 가로챈다 */
  listByUnit(teamId: string, partId: string | null = null): Task[] {
    return [...this.tasks.values()].filter((t) => t.teamId === teamId && t.partId === partId)
  }

  /** 같은 팀원에게 running task 가 있으면 거부한다. 지시자가 순서를 지키게 강제 */
  assign(teamId: string, memberSessionId: string, instruction: string, partId: string | null = null): Task {
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
    }
    this.tasks.set(task.id, task)
    return task
  }

  applyHook(payload: HookPayload): void {
    const task = this.runningOf(payload.session_id)
    if (!task) return
    if (payload.hook_event_name === 'UserPromptSubmit') task.isAcknowledged = true
    if (payload.hook_event_name === 'Stop') this.finish(task, 'done', payload.last_assistant_message ?? '', null)
  }

  /** 팀원 세션이 종료되면 그 팀원의 running task 는 실패 */
  markExited(sessionId: string): void {
    const task = this.runningOf(sessionId)
    if (task) this.finish(task, 'failed', null, '팀원 세션이 종료됨')
  }

  /** ack 없이 ACK_TIMEOUT_MS 가 지난 task 를 실패로. 주기적으로 호출한다 */
  expireUnacknowledged(): void {
    const limit = this.now().getTime() - ACK_TIMEOUT_MS
    for (const task of this.tasks.values()) {
      if (task.status !== 'running' || task.isAcknowledged) continue
      if (new Date(task.createdAt).getTime() <= limit) this.finish(task, 'failed', null, '팀원이 지시를 받지 못함 (터미널 입력 불가 상태)')
    }
  }

  /**
   * task 가 끝날 때까지 기다린다. taskId 가 없으면 지휘 단위의 아무 task 든 끝나는 것 하나.
   * 이미 끝난 task 는 즉시, 모르는 task·다른 단위의 task 는 null 즉시, 타임아웃이면 null
   */
  wait(teamId: string, taskId: string | null, timeoutMs: number, partId: string | null = null): Promise<Task | null> {
    if (taskId) {
      const task = this.tasks.get(taskId)
      if (!task || task.teamId !== teamId || task.partId !== partId) return Promise.resolve(null)
      if (task.status !== 'running') return Promise.resolve(task)
    } else {
      const unitTasks = this.listByUnit(teamId, partId)
      const finished = unitTasks.find((t) => t.status !== 'running' && !t.isDelivered)
      if (finished) {
        finished.isDelivered = true
        return Promise.resolve(finished)
      }
      if (!unitTasks.some((t) => t.status === 'running')) return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      const waiter: Waiter = { taskId, teamId, partId, resolve }
      this.waiters.add(waiter)
      setTimeout(() => {
        if (this.waiters.delete(waiter)) resolve(null)
      }, timeoutMs).unref?.()
    })
  }

  private runningOf(sessionId: string): Task | undefined {
    return [...this.tasks.values()].find((t) => t.memberSessionId === sessionId && t.status === 'running')
  }

  private finish(task: Task, status: 'done' | 'failed', result: string | null, error: string | null): void {
    task.status = status
    task.result = result
    task.error = error
    task.finishedAt = this.now().toISOString()
    for (const waiter of this.waiters) {
      if (waiter.teamId !== task.teamId || waiter.partId !== task.partId) continue
      if (waiter.taskId !== null && waiter.taskId !== task.id) continue
      this.waiters.delete(waiter)
      if (waiter.taskId === null) task.isDelivered = true
      waiter.resolve(task)
    }
  }
}

export class TaskConflictError extends Error {
  constructor(memberSessionId: string) {
    super(`팀원 ${memberSessionId.slice(0, 8)} 에게 진행 중인 task 가 있음`)
  }
}
