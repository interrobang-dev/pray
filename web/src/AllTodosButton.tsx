import { useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { PriorityChip, requestTodo } from './TeamTodosModal'
import { applyTodo, DESK_NAME, DESK_SCOPE, deskTodosOf, openTodoGroups, priorityOf, splitTodos, teamScope, todosUrl, totalRemaining, totalUrgentPriority, type TodoScope } from './teamTodos'
import type { Office, TeamTodo } from './types'

/**
 * 사이드바 탭 줄의 "All TODOs" 탭 + 남은 개수 배지(미완료에 Critical·High 가 있으면 그 색). 누르면 사이드바가 All TODOs 보기로 바뀐다(App 의 sidebarView)
 */
export function AllTodosTab({ office, isSelected, onSelect }: { office: Office; isSelected: boolean; onSelect: () => void }) {
  const total = totalRemaining(office)
  const urgentPriority = totalUrgentPriority(office)
  return (
    <button className="side-tab" role="tab" aria-selected={isSelected} onClick={onSelect}>
      All TODOs
      {total > 0 && (
        <span className="needs-you-count" data-priority={urgentPriority ?? undefined}>
          {total}
        </span>
      )}
    </button>
  )
}

interface ViewProps {
  office: Office
  /** TeamTodosModal 과 같다: 응답 항목을 App 의 office 에 먼저 넣는다 */
  onChangeTodos: (scope: TodoScope, update: (todos: TeamTodo[]) => TeamTodo[]) => void
  /** 그 범위(팀·내 책상)의 TeamTodosModal 을 연다 (글 고치기·순서 바꾸기·완료 목록은 거기서) */
  onOpenTodos: (scope: TodoScope) => void
}

/**
 * 사이드바 All TODOs 보기. 세션 목록 자리를 다 쓴다.
 * 맨 위는 늘 "My desk"(팀과 무관한 내 할 일. 입력칸으로 바로 추가), 그 아래 미완료가 있는 팀을 목록 순서로 묶는다.
 * 체크하면 완료(PATCH), 묶음 머리줄을 누르면 그 범위의 TODO 모달을 연다 (보기는 그대로). 우선순위는 칩만 보이고 바꾸기는 모달에서 한다
 */
export function AllTodosView({ office, onChangeTodos, onOpenTodos }: ViewProps) {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const deskOpen = splitTodos(deskTodosOf(office)).open
  const groups = openTodoGroups(office)

  function setPending(todoId: string, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (isPending) next.add(todoId)
      else next.delete(todoId)
      return next
    })
  }

  /** 완료로 바꾼다: 응답을 기다리는 동안 체크해 두고 다시 못 누르게, 받은 항목을 applyTodo 로 넣으면 줄이 빠진다 */
  async function complete(scope: TodoScope, todo: TeamTodo) {
    if (pendingIds.has(todo.id)) return
    setErrorMessage(null)
    setPending(todo.id, true)
    const result = await requestTodo(`${todosUrl(scope)}/${encodeURIComponent(todo.id)}`, 'PATCH', { isDone: true })
    setPending(todo.id, false)
    if (result.failure !== null) {
      setErrorMessage(result.failure)
      return
    }
    const updated = result.todo
    if (updated) onChangeTodos(scope, (todos) => applyTodo(todos, updated))
  }

  /** 내 책상에 추가 (TeamTodosModal 의 입력칸과 같다: 빈 글은 안 보내고, 길이는 서버가 본다, 기다리는 사이 더 친 글은 남긴다) */
  async function addToDesk() {
    const text = draft.trim()
    if (!text || isAdding) return
    setErrorMessage(null)
    setIsAdding(true)
    const result = await requestTodo(todosUrl(DESK_SCOPE), 'POST', { text })
    setIsAdding(false)
    if (result.failure !== null) {
      setErrorMessage(result.failure)
      return
    }
    const added = result.todo
    if (added) onChangeTodos(DESK_SCOPE, (todos) => applyTodo(todos, added))
    setDraft((current) => (current === draft ? '' : current))
  }

  function onAddKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void addToDesk()
  }

  /** 묶음 머리줄(이름 + 남은 수, 누르면 그 모달)과 미완료 줄들 */
  function renderSection(key: string, scope: TodoScope, name: string, open: TeamTodo[], extra?: ReactNode) {
    return (
      <section key={key} className="all-todos-team">
        <button className="all-todos-team-head" onClick={() => onOpenTodos(scope)} title={`Open TODO · ${name}`}>
          <span className="all-todos-team-name">{name}</span>
          <span className="all-todos-team-count">{open.length}</span>
        </button>
        {extra}
        {open.length > 0 && (
          <ul className="all-todos-list">
            {open.map((todo) => {
              const isPending = pendingIds.has(todo.id)
              return (
                <li key={todo.id} className="all-todos-item">
                  <input
                    type="checkbox"
                    checked={isPending}
                    disabled={isPending}
                    onChange={() => void complete(scope, todo)}
                    aria-label={`Mark "${todo.text}" done`}
                  />
                  <PriorityChip priority={priorityOf(todo)} />
                  <span className="all-todos-text" title={todo.text}>
                    {todo.text}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    )
  }

  return (
    <section className="side-view" aria-label="All TODOs">
      {errorMessage && <div className="all-todos-error">{errorMessage}</div>}
      {renderSection(
        'desk',
        DESK_SCOPE,
        DESK_NAME,
        deskOpen,
        // 글 길이(trim 뒤 1~500자)는 서버가 보고 넘으면 400 빨간 줄 (TeamTodosModal 과 같은 이유로 maxLength 없음)
        <input
          className="all-todos-add"
          value={draft}
          placeholder="Add a task"
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onAddKeyDown}
          aria-label={`Add a task to ${DESK_NAME}`}
        />,
      )}
      {groups.map(({ team, open }) => renderSection(team.id, teamScope(team.id), team.name, open))}
    </section>
  )
}
