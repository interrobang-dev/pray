import { useRef, useState, type ReactNode } from 'react'
import { useDismiss } from './Shells'
import { requestTodo } from './TeamTodosModal'
import { applyTodo, openTodoGroups, totalRemaining } from './teamTodos'
import type { Office, TeamTodo } from './types'

interface Props {
  office: Office
  /** 팀 머리줄 TODO 버튼과 같은 체크리스트 아이콘 (App.tsx TodoIcon) */
  icon: ReactNode
  /** TeamTodosModal 과 같다: 응답 항목을 App 의 office 에 먼저 넣는다 */
  onChangeTodos: (teamId: string, update: (todos: TeamTodo[]) => TeamTodo[]) => void
  /** 그 팀의 TeamTodosModal 을 연다 (추가·고치기·순서 바꾸기는 거기서) */
  onOpenTeam: (teamId: string) => void
}

/**
 * 목록 툴바의 "All TODOs" 버튼 + 남은 개수 배지와, 누르면 툴바 바로 아래에 붙는 창 (모든 팀의 미완료 할 일을 목록 순서의 팀마다 묶어서).
 * 다시 누르기·바깥 클릭·Esc 로 닫힌다. 체크하면 완료(PATCH), 팀 이름을 누르면 이 창을 닫고 그 팀의 TODO 모달을 연다.
 * 0 이면 배지 없이 흐리지만 눌린다 ("No tasks")
 */
export function AllTodosButton({ office, icon, onChangeTodos, onOpenTeam }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  useDismiss(isOpen, rootRef, toggleRef, setIsOpen)
  const total = totalRemaining(office.teams)
  const groups = isOpen ? openTodoGroups(office) : []

  function setPending(todoId: string, isPending: boolean) {
    setPendingIds((prev) => {
      const next = new Set(prev)
      if (isPending) next.add(todoId)
      else next.delete(todoId)
      return next
    })
  }

  /** 완료로 바꾼다: 응답을 기다리는 동안 체크해 두고 다시 못 누르게, 받은 항목을 applyTodo 로 넣으면 줄이 빠진다 */
  async function complete(teamId: string, todo: TeamTodo) {
    if (pendingIds.has(todo.id)) return
    setErrorMessage(null)
    setPending(todo.id, true)
    const result = await requestTodo(`/api/team/${encodeURIComponent(teamId)}/todos/${encodeURIComponent(todo.id)}`, 'PATCH', { isDone: true })
    setPending(todo.id, false)
    if (result.failure !== null) {
      setErrorMessage(result.failure)
      return
    }
    const updated = result.todo
    if (updated) onChangeTodos(teamId, (todos) => applyTodo(todos, updated))
  }

  return (
    <div className="all-todos" ref={rootRef}>
      <button
        ref={toggleRef}
        className={total > 0 ? 'all-todos-toggle has-todos' : 'all-todos-toggle'}
        onClick={() => {
          setErrorMessage(null)
          setIsOpen((prev) => !prev)
        }}
        aria-expanded={isOpen}
        aria-controls="all-todos-popover"
        title="All TODOs"
        aria-label="All TODOs"
      >
        {icon}
        {total > 0 && <span className="needs-you-count">{total}</span>}
      </button>
      {isOpen && (
        <div id="all-todos-popover" className="all-todos-popover" role="dialog" aria-label="All TODOs">
          <div className="needs-you-head">All TODOs</div>
          {errorMessage && <div className="all-todos-error">{errorMessage}</div>}
          {groups.length === 0 ? (
            <div className="all-todos-empty">No tasks</div>
          ) : (
            groups.map(({ team, open }) => (
              <section key={team.id} className="all-todos-team">
                <button
                  className="all-todos-team-head"
                  onClick={() => {
                    setIsOpen(false)
                    onOpenTeam(team.id)
                  }}
                  title={`Open TODO · ${team.name}`}
                >
                  <span className="all-todos-team-name">{team.name}</span>
                  <span className="all-todos-team-count">{open.length}</span>
                </button>
                <ul className="all-todos-list">
                  {open.map((todo) => {
                    const isPending = pendingIds.has(todo.id)
                    return (
                      <li key={todo.id} className="all-todos-item">
                        <input
                          type="checkbox"
                          checked={isPending}
                          disabled={isPending}
                          onChange={() => void complete(team.id, todo)}
                          aria-label={`Mark "${todo.text}" done`}
                        />
                        <span className="all-todos-text" title={todo.text}>
                          {todo.text}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  )
}
