import type { Team, TeamTodo } from './types'

/**
 * 팀 TODO 목록의 순수 함수. 서버 배열 순서는 늘 [할 일(사용자가 정한 순서)…, 완료(완료한 순서, 오래된 것 먼저)…] 이고,
 * 화면은 응답으로 받은 항목을 이 규칙대로 미리 넣어 두었다가 사무실 SSE 가 오면 서버 것으로 바뀐다 (같은 결과라 다시 넣어도 그대로다)
 */

/** 그 팀의 TODO. 서버를 재시작하기 전 옛 응답은 필드가 없어 [] */
export function todosOf(team: Team): TeamTodo[] {
  return team.todos ?? []
}

/** 남은(미완료) 개수 */
export function remainingCount(team: Team): number {
  return todosOf(team).filter((todo) => !todo.isDone).length
}

/** 화면 순서: 할 일은 서버 순서 그대로, 완료는 최근 완료한 것부터 (서버 순서를 뒤집는다) */
export function splitTodos(todos: TeamTodo[]): { open: TeamTodo[]; done: TeamTodo[] } {
  return { open: todos.filter((todo) => !todo.isDone), done: todos.filter((todo) => todo.isDone).reverse() }
}

/**
 * 서버가 돌려준 항목 하나를 목록에 반영한다: 완료 여부가 그대로면 제자리에서 바꾸고(글 고치기), 새 항목이거나 완료 여부가 바뀌었으면
 * 그 구역 맨 끝으로 (할 일은 할 일 맨 끝, 완료는 전체 맨 끝 — 서버가 옮기는 규칙과 같다)
 */
export function applyTodo(todos: TeamTodo[], todo: TeamTodo): TeamTodo[] {
  const index = todos.findIndex((item) => item.id === todo.id)
  if (index !== -1 && todos[index].isDone === todo.isDone) return todos.map((item, i) => (i === index ? todo : item))
  const rest = todos.filter((item) => item.id !== todo.id)
  if (todo.isDone) return [...rest, todo]
  const openCount = rest.filter((item) => !item.isDone).length
  return [...rest.slice(0, openCount), todo, ...rest.slice(openCount)]
}

export function removeTodo(todos: TeamTodo[], todoId: string): TeamTodo[] {
  return todos.filter((todo) => todo.id !== todoId)
}

/** 할 일만 ids 순서로 다시 놓는다 (완료는 그대로 뒤). ids 가 지금 할 일 집합과 다르면 그대로 둔다 */
export function reorderOpen(todos: TeamTodo[], ids: string[]): TeamTodo[] {
  const { open } = splitTodos(todos)
  const byId = new Map(open.map((todo) => [todo.id, todo]))
  if (ids.length !== byId.size || new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return todos
  return [...ids.map((id) => byId.get(id)!), ...todos.filter((todo) => todo.isDone)]
}

/** ids 에서 id 를 빼 dropIndex(원래 목록에서 이 순번 앞) 자리에 넣은 새 순서 (App.tsx 목록 끌어 놓기의 moveTo 와 같은 규칙) */
export function moveTo(ids: string[], id: string, dropIndex: number): string[] {
  const rest = ids.filter((other) => other !== id)
  rest.splice(dropIndex > ids.indexOf(id) ? dropIndex - 1 : dropIndex, 0, id)
  return rest
}
