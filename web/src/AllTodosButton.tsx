import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useDismiss } from './Shells'
import { requestTodo } from './TeamTodosModal'
import { applyTodo, DESK_NAME, DESK_SCOPE, deskTodosOf, openTodoGroups, splitTodos, teamScope, todosUrl, totalRemaining, type TodoScope } from './teamTodos'
import type { Office, TeamTodo } from './types'

interface Props {
  office: Office
  /** 팀 머리줄 TODO 버튼과 같은 체크리스트 아이콘 (App.tsx TodoIcon) */
  icon: ReactNode
  /** TeamTodosModal 과 같다: 응답 항목을 App 의 office 에 먼저 넣는다 */
  onChangeTodos: (scope: TodoScope, update: (todos: TeamTodo[]) => TeamTodo[]) => void
  /** 그 범위(팀·내 책상)의 TeamTodosModal 을 연다 (글 고치기·순서 바꾸기·완료 목록은 거기서) */
  onOpenTodos: (scope: TodoScope) => void
}

/**
 * 목록 툴바의 "All TODOs" 버튼 + 남은 개수 배지와, 누르면 툴바 바로 아래에 붙는 창.
 * 맨 위는 늘 "My desk"(팀과 무관한 내 할 일. 입력칸으로 바로 추가), 그 아래 미완료가 있는 팀을 목록 순서로 묶는다.
 * 다시 누르기·바깥 클릭·Esc 로 닫힌다. 체크하면 완료(PATCH), 묶음 머리줄을 누르면 이 창을 닫고 그 범위의 TODO 모달을 연다.
 * 0 이면 배지 없이 흐리지만 눌린다
 */
export function AllTodosButton({ office, icon, onChangeTodos, onOpenTodos }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  useDismiss(isOpen, rootRef, toggleRef, setIsOpen)
  const total = totalRemaining(office)
  const deskOpen = isOpen ? splitTodos(deskTodosOf(office)).open : []
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

  function openTodos(scope: TodoScope) {
    setIsOpen(false)
    onOpenTodos(scope)
  }

  /** 묶음 머리줄(이름 + 남은 수, 누르면 그 모달)과 미완료 줄들 */
  function renderSection(key: string, scope: TodoScope, name: string, open: TeamTodo[], extra?: ReactNode) {
    return (
      <section key={key} className="all-todos-team">
        <button className="all-todos-team-head" onClick={() => openTodos(scope)} title={`Open TODO · ${name}`}>
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
        </div>
      )}
    </div>
  )
}
