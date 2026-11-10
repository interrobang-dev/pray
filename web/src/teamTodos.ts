import type { Office, Team, TeamTodo } from './types'

/**
 * TODO 목록의 순수 함수 (팀 할 일·내 책상 공용). 서버 배열 순서는 늘 [할 일(사용자가 정한 순서)…, 완료(완료한 순서, 오래된 것 먼저)…] 이고,
 * 화면은 응답으로 받은 항목을 이 규칙대로 미리 넣어 두었다가 사무실 SSE 가 오면 서버 것으로 바뀐다 (같은 결과라 다시 넣어도 그대로다)
 */

/** 할 일 범위: 팀 할 일(Team.todos) 또는 팀과 무관한 내 책상(Office.todos). 서버 hq.ts 의 TodoScope 와 같은 꼴 */
export type TodoScope = { kind: 'team'; teamId: string } | { kind: 'desk' }

export const DESK_SCOPE: TodoScope = { kind: 'desk' }

/** 내 책상 묶음·모달 제목에 쓰는 이름 */
export const DESK_NAME = 'My desk'

export function teamScope(teamId: string): TodoScope {
  return { kind: 'team', teamId }
}

/** 그 범위의 할 일 API 기본 경로 (뒤에 /order·/done·/<todoId>) */
export function todosUrl(scope: TodoScope): string {
  return scope.kind === 'desk' ? '/api/todos' : `/api/team/${encodeURIComponent(scope.teamId)}/todos`
}

/** 그 팀의 TODO. 서버를 재시작하기 전 옛 응답은 필드가 없어 [] */
export function todosOf(team: Team): TeamTodo[] {
  return team.todos ?? []
}

/** 내 책상 TODO. 옛 서버 응답은 필드가 없어 [] */
export function deskTodosOf(office: Office): TeamTodo[] {
  return office.todos ?? []
}

/** 그 범위의 TODO. 팀이 없으면 null (모달을 닫는다) */
export function scopeTodos(office: Office, scope: TodoScope): TeamTodo[] | null {
  if (scope.kind === 'desk') return deskTodosOf(office)
  const team = office.teams.find((item) => item.id === scope.teamId)
  return team ? todosOf(team) : null
}

/** 그 범위의 TODO 만 update 로 바꾼 새 office (응답 항목을 SSE 보다 먼저 넣을 때) */
export function updateScopeTodos(office: Office, scope: TodoScope, update: (todos: TeamTodo[]) => TeamTodo[]): Office {
  if (scope.kind === 'desk') return { ...office, todos: update(deskTodosOf(office)) }
  return { ...office, teams: office.teams.map((team) => (team.id === scope.teamId ? { ...team, todos: update(todosOf(team)) } : team)) }
}

/** 남은(미완료) 개수 */
export function openCount(todos: TeamTodo[]): number {
  return todos.filter((todo) => !todo.isDone).length
}

/** 그 팀의 남은(미완료) 개수 */
export function remainingCount(team: Team): number {
  return openCount(todosOf(team))
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

/** 완료한 항목을 모두 뺀다 (할 일 순서는 그대로) */
export function clearDone(todos: TeamTodo[]): TeamTodo[] {
  return todos.filter((todo) => !todo.isDone)
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

/** 목록 순서의 팀: 그룹(hq 배열 순) → 그 그룹의 팀(hq 배열 순), 그 뒤 그룹이 지워진 팀 (App.tsx 목록과 같은 순서) */
export function teamsInListOrder(office: Office): Team[] {
  const grouped = office.groups.flatMap((group) => office.teams.filter((team) => team.groupId === group.id))
  const orphans = office.teams.filter((team) => !office.groups.some((group) => group.id === team.groupId))
  return [...grouped, ...orphans]
}

/** All TODOs 창의 묶음: 목록 순서대로 팀마다 미완료 할 일(서버 순서). 미완료가 없는 팀은 뺀다 */
export function openTodoGroups(office: Office): { team: Team; open: TeamTodo[] }[] {
  return teamsInListOrder(office)
    .map((team) => ({ team, open: splitTodos(todosOf(team)).open }))
    .filter((group) => group.open.length > 0)
}

/** 툴바 All TODOs 배지: 내 책상 + 모든 팀의 남은(미완료) 개수 합 */
export function totalRemaining(office: Office): number {
  return office.teams.reduce((sum, team) => sum + remainingCount(team), openCount(deskTodosOf(office)))
}
