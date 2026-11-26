/** 상태 표시줄 PC 칩·PC 목록 메뉴·커맨드 팔레트 "Switch to" 명령의 순수 함수: Tailscale 로 이어진 PC 중 어디로 옮겨 갈 수 있나 (MachineSwitcher.tsx) */

/** GET /api/machines 의 PC 한 대. name = Tailscale 기기 이름("office"), url = 그 PC 의 Pray 주소(없으면 null) */
export interface Machine {
  name: string
  hostName: string
  url: string | null
  isSelf: boolean
  isOnline: boolean
  hasPray: boolean
}

export type TailscaleState = 'ready' | 'not-installed' | 'stopped' | 'error'

export interface MachinesResponse {
  tailscale: TailscaleState
  machines: Machine[]
}

/** 메뉴 한 줄: 지금 PC 면 ✓(누를 수 없음), 옮겨 갈 수 없으면 이유 글(흐리게) */
export interface MachineRow {
  machine: Machine
  isCurrent: boolean
  /** 옮겨 갈 수 없는 이유. 지금 PC·옮겨 갈 수 있는 PC 는 null */
  disabledReason: string | null
}

const TAILSCALE_STATES: readonly string[] = ['ready', 'not-installed', 'stopped', 'error']

function parseMachine(value: unknown): Machine | null {
  if (typeof value !== 'object' || value === null) return null
  const { name, hostName, url, isSelf, isOnline, hasPray } = value as Record<string, unknown>
  if (typeof name !== 'string' || name === '' || typeof hostName !== 'string') return null
  if (url !== null && typeof url !== 'string') return null
  if (typeof isSelf !== 'boolean' || typeof isOnline !== 'boolean' || typeof hasPray !== 'boolean') return null
  return { name, hostName, url: url === '' ? null : url, isSelf, isOnline, hasPray }
}

/**
 * 응답이 꼴에 맞을 때만 값으로 (아니면 칩을 숨긴다). 이 API 가 없는 옛 서버는 404 이거나 화면 대체 경로로 index.html 을 200 으로 줘서
 * JSON 이 아니면 부른 쪽이 null 로 본다. 꼴이 틀린 PC 한 대는 빼고 나머지는 쓴다
 */
export function parseMachines(value: unknown): MachinesResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const { tailscale, machines } = value as Record<string, unknown>
  if (typeof tailscale !== 'string' || !TAILSCALE_STATES.includes(tailscale) || !Array.isArray(machines)) return null
  return {
    tailscale: tailscale as TailscaleState,
    machines: machines.map(parseMachine).filter((machine): machine is Machine => machine !== null),
  }
}

/** 칩에 보일 지금 PC. Tailscale 이 ready 가 아니거나 응답에 지금 PC 가 없으면 null (칩을 숨긴다) */
export function selfMachine(response: MachinesResponse | null): Machine | null {
  if (!response || response.tailscale !== 'ready') return null
  return response.machines.find((machine) => machine.isSelf) ?? null
}

/** 옮겨 갈 수 없는 이유: 꺼져 있음 → Pray 가 안 돎 → 주소 없음 순으로 하나. 옮겨 갈 수 있으면 null */
export function unavailableReason(machine: Machine): string | null {
  if (!machine.isOnline) return 'Offline'
  if (!machine.hasPray) return 'Pray not running'
  if (machine.url === null) return 'No address'
  return null
}

function compareNames(a: Machine, b: Machine): number {
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
}

/**
 * 메뉴 줄: 지금 PC 와 옮겨 갈 수 있는 PC 를 섞어 이름순 (= 단축키 Shift+F1·F2… 순서) → 갈 수 없는 PC(온라인이 먼저, 이름순).
 * 갈 수 없는 PC 는 번호가 없어 아래로 모은다 (사이에 끼면 번호가 떨어져 보인다). 칩이 숨는 때(selfMachine 이 null)는 빈 목록
 */
export function machineRows(response: MachinesResponse | null): MachineRow[] {
  const self = selfMachine(response)
  if (!response || !self) return []
  const others = response.machines.filter((machine) => !machine.isSelf)
  const reachable = [self, ...others.filter((machine) => unavailableReason(machine) === null)].sort(compareNames)
  const unavailable = others
    .filter((machine) => unavailableReason(machine) !== null)
    .sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || compareNames(a, b))
  return [
    ...reachable.map((machine) => ({ machine, isCurrent: machine === self, disabledReason: null })),
    ...unavailable.map((machine) => ({ machine, isCurrent: false, disabledReason: unavailableReason(machine) })),
  ]
}

/** Shift+F1 ~ Shift+F12 */
const SHORTCUT_LIMIT = 12

/**
 * 단축키 번호를 붙일 PC: 지금 PC + 옮겨 갈 수 있는 PC 를 Tailscale 이름순으로 (index 0 = Shift+F1).
 * 지금 PC 도 넣어 어느 PC 에서 눌러도 같은 키가 같은 PC 를 가리킨다 (번호를 바꾸려면 Tailscale 기기 이름을 바꾼다). 칩이 숨는 때는 빈 목록
 */
export function shortcutMachines(response: MachinesResponse | null): Machine[] {
  return machineRows(response)
    .filter((row) => row.disabledReason === null)
    .map((row) => row.machine)
    .sort(compareNames)
    .slice(0, SHORTCUT_LIMIT)
}

/** 그 PC 의 단축키 글자 "Shift+F1". 번호가 없으면 null */
export function shortcutLabel(response: MachinesResponse | null, machine: Machine): string | null {
  const index = shortcutMachines(response).findIndex((candidate) => candidate.name === machine.name)
  return index === -1 ? null : `Shift+F${index + 1}`
}

/** Shift+F1 ~ Shift+F12 (Ctrl·Alt·Meta 없이) 이면 0 부터의 번호, 아니면 null */
export function shortcutIndexOf(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): number | null {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return null
  const match = /^F(\d{1,2})$/.exec(event.key)
  if (!match) return null
  const number = Number(match[1])
  return number >= 1 && number <= SHORTCUT_LIMIT ? number - 1 : null
}

/** 커맨드 팔레트 "Switch to <name>" 을 넣을 PC: 지금 PC 가 아니고 옮겨 갈 수 있는 것, 이름순. 칩이 숨는 때는 없다 */
export function switchTargets(response: MachinesResponse | null): Machine[] {
  return machineRows(response)
    .filter((row) => !row.isCurrent && row.disabledReason === null)
    .map((row) => row.machine)
}
