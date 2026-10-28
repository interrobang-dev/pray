import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Modal } from './Modal'
import { applyTodo, clearDone, moveTo, removeTodo, reorderOpen, splitTodos, todosOf } from './teamTodos'
import type { Team, TeamTodo } from './types'

/** 끌기로 보는 최소 이동 (px) — App.tsx 목록 끌어 놓기와 같은 값 */
const DRAG_THRESHOLD_PX = 5
/** 끄는 동안 목록 위·아래 끝에서 이 거리 안이면 목록을 스크롤한다 (App.tsx 와 같은 값) */
const AUTO_SCROLL_EDGE_PX = 40
const AUTO_SCROLL_MAX_PX = 14
/** 터치 기기는 열 때 입력칸에 포커스하지 않는다 (가상 키보드가 목록을 가린다. Chat.tsx 의 TOUCH_QUERY 와 같은 기준) */
const TOUCH_QUERY = '(hover: none)'

interface Props {
  team: Team
  onClose: () => void
  /** 화면의 todos 를 먼저 바꾼다 (App 의 office 상태). 사무실 SSE 가 오면 서버 것으로 바뀐다 */
  onChangeTodos: (teamId: string, update: (todos: TeamTodo[]) => TeamTodo[]) => void
}

/** 응답 본문과 실패 문구 (서버 message, 없으면 HTTP 코드, 닿지 못하면 "Network error") */
async function requestTodo(url: string, method: string, body?: unknown): Promise<{ todo?: TeamTodo; failure: string | null }> {
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as { todo?: TeamTodo; message?: string }
    return response.ok ? { todo: data.todo, failure: null } : { failure: data.message ?? `HTTP ${response.status}` }
  } catch {
    return { failure: 'Network error' }
  }
}

/**
 * 팀 TODO 모달: 맨 위 입력칸(Enter 로 추가), 할 일(체크 · 글 · × · ⠿, 글을 누르면 그 자리에서 고치기, ⠿ 로 끌어 순서 바꾸기),
 * 그 아래 완료 "Done (N)"(줄 긋고 흐리게, 최근 완료부터, 체크를 풀면 할 일로). 목록은 props 의 team.todos 그대로라 열린 동안 SSE 를 따라간다
 */
export function TeamTodosModal({ team, onClose, onChangeTodos }: Props) {
  const { open, done } = splitTodos(todosOf(team))
  const [draft, setDraft] = useState('')
  const [isAdding, setIsAdding] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{ id: string; dropIndex: number | null } | null>(null)
  const [isTouch] = useState(() => window.matchMedia(TOUCH_QUERY).matches)
  const listRef = useRef<HTMLUListElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const baseUrl = `/api/team/${encodeURIComponent(team.id)}/todos`

  /** 요청을 보내고 실패하면 빨간 줄. 성공하면 응답 본문 */
  async function send(url: string, method: string, body?: unknown) {
    setErrorMessage(null)
    const result = await requestTodo(url, method, body)
    if (result.failure !== null) setErrorMessage(result.failure)
    return result.failure === null ? result : null
  }

  async function add() {
    const text = draft.trim()
    if (!text || isAdding) return
    setIsAdding(true)
    const result = await send(baseUrl, 'POST', { text })
    setIsAdding(false)
    if (!result) return
    const added = result.todo
    if (added) onChangeTodos(team.id, (todos) => applyTodo(todos, added))
    // 기다리는 사이 더 친 글은 남긴다
    setDraft((current) => (current === draft ? '' : current))
  }

  function onAddKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    void add()
  }

  async function update(todo: TeamTodo, patch: { text?: string; isDone?: boolean }) {
    const result = await send(`${baseUrl}/${encodeURIComponent(todo.id)}`, 'PATCH', patch)
    const updated = result?.todo
    if (updated) onChangeTodos(team.id, (todos) => applyTodo(todos, updated))
  }

  async function remove(todo: TeamTodo) {
    const result = await send(`${baseUrl}/${encodeURIComponent(todo.id)}`, 'DELETE')
    if (result) onChangeTodos(team.id, (todos) => removeTodo(todos, todo.id))
  }

  /** 완료 항목을 모두 지운다: 확인 창 뒤 DELETE, 응답을 기다려 화면에서 뺀다 */
  async function clearAllDone() {
    if (isClearing || done.length === 0) return
    if (!window.confirm(`Delete ${done.length} done ${done.length === 1 ? 'task' : 'tasks'}?`)) return
    setIsClearing(true)
    const result = await send(`${baseUrl}/done`, 'DELETE')
    setIsClearing(false)
    if (result) onChangeTodos(team.id, clearDone)
  }

  /** 고친 글 저장: 빈 글이면 저장하지 않고 되돌리고, 그대로면 보내지 않는다 */
  function saveEdit(todo: TeamTodo, text: string) {
    setEditingId(null)
    const trimmed = text.trim()
    if (trimmed && trimmed !== todo.text) void update(todo, { text: trimmed })
  }

  /** 화면 순서를 먼저 바꾸고 저장한다. 실패하면 원래 순서로 되돌리고 빨간 줄로 알린다 */
  async function saveOrder(previousIds: string[], ids: string[]) {
    onChangeTodos(team.id, (todos) => reorderOpen(todos, ids))
    setErrorMessage(null)
    const result = await requestTodo(`${baseUrl}/order`, 'PUT', { ids })
    if (result.failure === null) return
    onChangeTodos(team.id, (todos) => reorderOpen(todos, previousIds))
    setErrorMessage(`Couldn't change the order: ${result.failure}`)
  }

  /**
   * 손잡이(⠿)를 누르면 시작한다 — App.tsx 목록 끌어 놓기(startReorder)와 같은 방식: pointer 이벤트, DRAG_THRESHOLD_PX 를 넘게 움직여야 끌기,
   * 놓일 자리는 할 일 줄들의 세로 가운데와 비교해 정하고, 목록 위·아래 끝 근처에서는 누른 자리에서 그쪽으로 움직였을 때만 스크롤한다
   */
  function startDrag(event: ReactPointerEvent<HTMLElement>, id: string) {
    const list = listRef.current
    if (!list || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    const pointerId = event.pointerId
    event.currentTarget.setPointerCapture(pointerId)
    const start = { x: event.clientX, y: event.clientY }
    let pointerY = start.y
    let isDragging = false
    let ids: string[] = []
    let dropIndex: number | null = null
    let frame = 0

    function updateDrop() {
      const elements = [...list!.querySelectorAll<HTMLElement>(':scope > li[data-todo-id]')]
      ids = elements.map((element) => element.dataset.todoId ?? '')
      const from = ids.indexOf(id)
      const before = elements.findIndex((element) => {
        const rect = element.getBoundingClientRect()
        return pointerY < rect.top + rect.height / 2
      })
      const index = before === -1 ? elements.length : before
      const next = from === -1 || index === from || index === from + 1 ? null : index
      dropIndex = next
      setDrag((prev) => (prev && prev.id === id && prev.dropIndex === next ? prev : { id, dropIndex: next }))
    }

    function autoScroll() {
      const scroller = scrollRef.current
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        const topDepth = pointerY < start.y ? rect.top + AUTO_SCROLL_EDGE_PX - pointerY : 0
        const bottomDepth = pointerY > start.y ? pointerY - (rect.bottom - AUTO_SCROLL_EDGE_PX) : 0
        const depth = topDepth > 0 ? -topDepth : bottomDepth > 0 ? bottomDepth : 0
        if (depth !== 0) {
          const scrollTop = scroller.scrollTop
          scroller.scrollTop += Math.sign(depth) * Math.ceil((Math.min(Math.abs(depth), AUTO_SCROLL_EDGE_PX) / AUTO_SCROLL_EDGE_PX) * AUTO_SCROLL_MAX_PX)
          if (scroller.scrollTop !== scrollTop) updateDrop()
        }
      }
      frame = requestAnimationFrame(autoScroll)
    }

    function onMove(moveEvent: PointerEvent) {
      if (moveEvent.pointerId !== pointerId) return
      pointerY = moveEvent.clientY
      if (!isDragging) {
        if (Math.hypot(moveEvent.clientX - start.x, moveEvent.clientY - start.y) < DRAG_THRESHOLD_PX) return
        isDragging = true
        frame = requestAnimationFrame(autoScroll)
      }
      updateDrop()
    }

    function onEnd(endEvent: PointerEvent) {
      if (endEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      cancelAnimationFrame(frame)
      setDrag(null)
      if (endEvent.type === 'pointerup' && isDragging && dropIndex !== null) void saveOrder(ids, moveTo(ids, id, dropIndex))
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  /** 끄는 중(흐리게)·놓일 자리 선(앞 또는 맨 끝 뒤) */
  function dragClass(id: string, index: number): string {
    if (!drag) return ''
    if (drag.id === id) return 'dragging'
    if (drag.dropIndex === index) return 'drop-before'
    return drag.dropIndex === open.length && index === open.length - 1 ? 'drop-after' : ''
  }

  return (
    <Modal title={`TODO · ${team.name}`} onClose={onClose} className="todo-modal" hasCloseButton>
      {/* 글 길이(trim 뒤 1~500자)는 서버가 보고 넘으면 400 빨간 줄. maxLength 를 두면 붙여 넣은 긴 글 끝이 알림 없이 잘려 저장된다 */}
      <input
        className="todo-add"
        value={draft}
        placeholder="Add a task"
        autoFocus={!isTouch}
        enterKeyHint="done"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onAddKeyDown}
      />
      {errorMessage && <div className="todo-error">{errorMessage}</div>}
      <div ref={scrollRef} className={drag ? 'todo-scroll dragging-list' : 'todo-scroll'}>
        {open.length === 0 ? (
          <div className="todo-empty">No tasks</div>
        ) : (
          <ul ref={listRef} className="todo-list">
            {open.map((todo, index) => (
              <li key={todo.id} className={['todo-item', dragClass(todo.id, index)].join(' ')} data-todo-id={todo.id}>
                <input type="checkbox" checked={false} onChange={() => void update(todo, { isDone: true })} aria-label={`Mark "${todo.text}" done`} />
                {editingId === todo.id ? (
                  <TodoEditor text={todo.text} onSave={(text) => saveEdit(todo, text)} onCancel={() => setEditingId(null)} />
                ) : (
                  <button type="button" className="todo-text" onClick={() => setEditingId(todo.id)} title="Click to edit">
                    {todo.text}
                  </button>
                )}
                <button type="button" className="todo-delete" onClick={() => void remove(todo)} title="Delete" aria-label={`Delete "${todo.text}"`}>
                  ×
                </button>
                <button
                  type="button"
                  className="todo-handle"
                  onPointerDown={(event) => startDrag(event, todo.id)}
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                >
                  ⠿
                </button>
              </li>
            ))}
          </ul>
        )}
        {done.length > 0 && (
          <>
            <div className="todo-done-head">
              <span>Done ({done.length})</span>
              <button type="button" className="todo-clear" onClick={() => void clearAllDone()} disabled={isClearing} title="Delete all done tasks">
                {isClearing ? '…' : 'Clear'}
              </button>
            </div>
            <ul className="todo-list done">
              {done.map((todo) => (
                <li key={todo.id} className="todo-item">
                  <input type="checkbox" checked onChange={() => void update(todo, { isDone: false })} aria-label={`Mark "${todo.text}" not done`} />
                  <span className="todo-text">{todo.text}</span>
                  <button type="button" className="todo-delete" onClick={() => void remove(todo)} title="Delete" aria-label={`Delete "${todo.text}"`}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Modal>
  )
}

/** 할 일 글 고치기: Enter 저장, Esc 취소(모달은 닫지 않는다), 포커스가 빠지면 저장. 한글 조합 중 Enter·Esc 는 조합에 맡긴다 */
function TodoEditor({ text, onSave, onCancel }: { text: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(text)
  // Enter·Esc 뒤 입력칸이 사라지며 오는 blur 로 한 번 더 끝내지 않게
  const isFinished = useRef(false)

  function finish(isSaved: boolean) {
    if (isFinished.current) return
    isFinished.current = true
    if (isSaved) onSave(value)
    else onCancel()
  }

  return (
    <input
      className="todo-edit"
      value={value}
      autoFocus
      enterKeyHint="done"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(true)
        } else if (event.key === 'Escape') {
          // Modal 이 window 에서 Esc 로 닫는다. React 가 루트에서 멈춰 window 까지 가지 않는다
          event.stopPropagation()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}
