/** Ctrl+K 글로벌 검색 창(GlobalSearch.tsx)의 순수 함수: 화면이 이미 가진 세션·팀·그룹·할 일·알림·명령에서 찾고 묶음을 만든다. 이름이 globalSearch.ts 가 아닌 것은 Windows 가 대소문자를 가리지 않아 ./GlobalSearch 와 겹쳐서다 */
import { recentSessions } from './home'
import { leadSessions } from './leadModels'
import { needsYouSessions } from './needsYou'
import { isUnacknowledgedFired, remindersOf } from './reminders'
import { nameOf, positionOf } from './sessionPosition'
import { DESK_NAME, DESK_SCOPE, deskTodosOf, splitTodos, teamScope, teamsInListOrder, todosOf, type TodoScope } from './teamTodos'
import { attendanceOf, type Group, type Office, type Reminder, type Session, type Team, type TeamTodo } from './types'

/** 묶음마다 최대 줄 수: 세션 8, 나머지 5 */
export const SESSION_LIMIT = 8
export const OTHER_LIMIT = 5

export type CommandId =
  | 'new-session'
  | 'new-group'
  | 'toggle-office'
  | 'appearance'
  | 'reminders'
  | 'lead-models'
  | 'view-sessions'
  | 'view-needs-you'
  | 'view-todos'

export type SearchItem =
  | { kind: 'session'; key: string; session: Session }
  | { kind: 'team'; key: string; team: Team; presentCount: number }
  | { kind: 'group'; key: string; group: Group; teamCount: number }
  | { kind: 'todo'; key: string; todo: TeamTodo; scope: TodoScope; placeName: string }
  | { kind: 'reminder'; key: string; reminder: Reminder; isFired: boolean }
  | { kind: 'command'; key: string; command: CommandId; label: string; disabledReason: string | null }

export interface SearchGroup {
  key: 'needs-you' | 'recent' | 'sessions' | 'teams' | 'groups' | 'todos' | 'reminders' | 'commands'
  title: string
  items: SearchItem[]
}

export interface SearchInput {
  sessions: Session[]
  office: Office
  now: number
  isHostReachable: boolean
  /** 폰 폭: 사무실이 없어 Hide/Show office 명령을 넣지 않는다 */
  isNarrow: boolean
  isOfficeHidden: boolean
}

/**
 * 검색 창을 여닫는 키: Ctrl+K (맥 Meta+K), Shift·Alt 없이. 한글 자판은 key 가 'ㅏ' 라 code 'KeyK' 로도 본다.
 * 터미널 탭·다른 모달에서 가로채지 않는 판정은 App 이 한다
 */
export function isGlobalSearchShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false
  return event.code === 'KeyK' || event.key.toLowerCase() === 'k'
}

/** 앞뒤 공백을 빼고 공백으로 나눈 낱말 (소문자) */
export function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

/**
 * 맞춘 순위 (작을수록 위). 낱말이 모두 이름·다른 칸 어딘가에 없으면 null.
 * 0 이름이 검색어와 같음 · 1 이름이 검색어로 시작 · 2 이름에 검색어(또는 낱말 모두)가 듦 · 3 다른 칸에만 듦
 */
export function matchRank(name: string, fields: readonly (string | null | undefined)[], tokens: readonly string[]): number | null {
  if (tokens.length === 0) return null
  const lowerName = name.toLowerCase()
  const haystack = [lowerName, ...fields.filter((field): field is string => Boolean(field)).map((field) => field.toLowerCase())].join('\n')
  if (!tokens.every((token) => haystack.includes(token))) return null
  const query = tokens.join(' ')
  if (lowerName === query) return 0
  if (lowerName.startsWith(query)) return 1
  if (lowerName.includes(query) || tokens.every((token) => lowerName.includes(token))) return 2
  return 3
}

/** 맞는 것만 순위대로, 같으면 원래 순서로 limit 개 */
export function rankMatches<T>(
  candidates: readonly T[],
  textOf: (candidate: T) => { name: string; fields: readonly (string | null | undefined)[] },
  tokens: readonly string[],
  limit: number,
): T[] {
  return candidates
    .map((candidate, index) => {
      const { name, fields } = textOf(candidate)
      return { candidate, index, rank: matchRank(name, fields, tokens) }
    })
    .filter((entry): entry is { candidate: T; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ candidate }) => candidate)
}

/** 세션의 검색 글: 이름 + 역할·팀 이름·파트 이름·폴더 */
export function sessionSearchText(session: Session, teams: readonly Team[]): { name: string; fields: (string | null)[] } {
  const team = session.teamId ? teams.find((candidate) => candidate.id === session.teamId) : undefined
  const part = session.partId ? team?.parts.find((candidate) => candidate.id === session.partId) : undefined
  return { name: nameOf(session), fields: [positionOf(session), team?.name ?? null, part?.name ?? null, session.cwd] }
}

/** 미완료 할 일: 내 책상 → 팀(목록 순서), 각 범위 안은 서버 순서 */
export function openTodoItems(office: Office): Extract<SearchItem, { kind: 'todo' }>[] {
  const desk = splitTodos(deskTodosOf(office)).open.map((todo) => ({ todo, scope: DESK_SCOPE, placeName: DESK_NAME }))
  const teams = teamsInListOrder(office).flatMap((team) =>
    splitTodos(todosOf(team)).open.map((todo) => ({ todo, scope: teamScope(team.id), placeName: team.name })),
  )
  return [...desk, ...teams].map((entry) => ({
    kind: 'todo' as const,
    key: `todo:${entry.scope.kind === 'team' ? entry.scope.teamId : 'desk'}:${entry.todo.id}`,
    ...entry,
  }))
}

/** 명령 줄. 사무실 명령은 지금 상태에 맞는 하나이고 폰 폭에는 없다. 위험한 명령(End·Restart·Delete)은 넣지 않는다 */
export function commandItems(input: SearchInput): Extract<SearchItem, { kind: 'command' }>[] {
  const commands: { command: CommandId; label: string; disabledReason?: string | null }[] = [
    { command: 'new-session', label: 'New session', disabledReason: input.isHostReachable ? null : 'Session host disconnected' },
    { command: 'new-group', label: 'New group' },
    ...(input.isNarrow ? [] : [{ command: 'toggle-office' as const, label: input.isOfficeHidden ? 'Show office' : 'Hide office' }]),
    { command: 'appearance', label: 'Appearance' },
    { command: 'reminders', label: 'Reminders' },
    { command: 'lead-models', label: 'Lead models', disabledReason: leadSessions(input.sessions).length > 0 ? null : 'No leads on duty' },
    { command: 'view-sessions', label: 'Show sessions' },
    { command: 'view-needs-you', label: 'Show Needs you' },
    { command: 'view-todos', label: 'Show All TODOs' },
  ]
  return commands.map(({ command, label, disabledReason }) => ({ kind: 'command', key: `command:${command}`, command, label, disabledReason: disabledReason ?? null }))
}

function sessionItem(session: Session): SearchItem {
  return { kind: 'session', key: `session:${session.id}`, session }
}

/**
 * 창의 묶음. 검색어가 비면 Needs you(근무 중 승인 대기·내 차례 — needsYou.ts 규칙에서 끝남만 뺌) → Recent(최근 대화 8개, 위와 겹치면 뺌) → Commands.
 * 검색어가 있으면 Sessions·Teams·Groups·TODOs·Reminders·Commands 순으로 맞는 것만 (빈 묶음은 뺀다)
 */
export function searchGroups(input: SearchInput, query: string): SearchGroup[] {
  const tokens = queryTokens(query)
  const commands = commandItems(input)
  if (tokens.length === 0) {
    const needsYou = needsYouSessions(input.sessions, input.now).filter((session) => session.status !== 'done')
    const needsYouIds = new Set(needsYou.map((session) => session.id))
    const recent = recentSessions(input.sessions.filter((session) => !needsYouIds.has(session.id)), SESSION_LIMIT)
    return dropEmpty([
      { key: 'needs-you', title: 'Needs you', items: needsYou.map(sessionItem) },
      { key: 'recent', title: 'Recent', items: recent.map(sessionItem) },
      { key: 'commands', title: 'Commands', items: commands },
    ])
  }
  const { office, sessions } = input
  const teams = teamsInListOrder(office)
  const teamItems = teams.map((team) => ({
    kind: 'team' as const,
    key: `team:${team.id}`,
    team,
    presentCount: sessions.filter((session) => session.teamId === team.id && attendanceOf(session) === 'present').length,
  }))
  const groupItems = office.groups.map((group) => ({
    kind: 'group' as const,
    key: `group:${group.id}`,
    group,
    teamCount: office.teams.filter((team) => team.groupId === group.id).length,
  }))
  // 확인한 알림은 Reminders 창에도 보이지 않아 넣지 않는다
  const reminderItems = remindersOf(office)
    .filter((reminder) => reminder.acknowledgedAt === null)
    .map((reminder) => ({ kind: 'reminder' as const, key: `reminder:${reminder.id}`, reminder, isFired: isUnacknowledgedFired(reminder) }))
  return dropEmpty([
    {
      key: 'sessions',
      title: 'Sessions',
      items: rankMatches(sessions, (session) => sessionSearchText(session, office.teams), tokens, SESSION_LIMIT).map(sessionItem),
    },
    { key: 'teams', title: 'Teams', items: rankMatches(teamItems, (item) => ({ name: item.team.name, fields: [item.team.cwd] }), tokens, OTHER_LIMIT) },
    { key: 'groups', title: 'Groups', items: rankMatches(groupItems, (item) => ({ name: item.group.name, fields: [] }), tokens, OTHER_LIMIT) },
    { key: 'todos', title: 'TODOs', items: rankMatches(openTodoItems(office), (item) => ({ name: item.todo.text, fields: [] }), tokens, OTHER_LIMIT) },
    { key: 'reminders', title: 'Reminders', items: rankMatches(reminderItems, (item) => ({ name: item.reminder.text, fields: [] }), tokens, OTHER_LIMIT) },
    { key: 'commands', title: 'Commands', items: rankMatches(commands, (item) => ({ name: item.label, fields: [] }), tokens, OTHER_LIMIT) },
  ])
}

function dropEmpty(groups: SearchGroup[]): SearchGroup[] {
  return groups.filter((group) => group.items.length > 0)
}

/** 고를 수 있는 줄 (비활성 명령은 건너뛴다) */
export function isSelectable(item: SearchItem): boolean {
  return item.kind !== 'command' || item.disabledReason === null
}

/** ↑↓ 로 옮긴 고른 줄 순번 (고를 수 있는 줄 사이에서, 끝에서 돈다). 고를 줄이 없으면 -1 */
export function moveSelection(items: readonly SearchItem[], current: number, delta: 1 | -1): number {
  const count = items.length
  if (!items.some(isSelectable)) return -1
  let index = current < 0 ? (delta > 0 ? -1 : count) : current
  for (let step = 0; step < count; step++) {
    index = (((index + delta) % count) + count) % count
    if (isSelectable(items[index])) return index
  }
  return -1
}

/** 처음 고른 줄: 첫 고를 수 있는 줄 (없으면 -1) */
export function firstSelectable(items: readonly SearchItem[]): number {
  return items.findIndex(isSelectable)
}
