import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isIP } from 'node:net'
import { join } from 'node:path'

/**
 * Tailscale 로 이어진 PC 목록 (`GET /api/machines`)과 이 PC 자신의 Tailscale 이름 (Host 검사에 더한다).
 * tailscale CLI 는 `status --json` 만 부른다 — 상태를 바꾸는 명령은 부르지 않는다
 */

export type TailscaleState = 'ready' | 'not-installed' | 'stopped' | 'error'

/** tailnet 기기 하나. name = MagicDNS 이름 첫 칸(Tailscale 기기 이름), hostName = 그 기기의 OS 이름(Windows PC 이름) */
export interface TailnetNode {
  name: string
  hostName: string
  /** MagicDNS 전체 이름, 끝 점을 뗀 것. 없으면 null */
  dnsName: string | null
  ipv4: string | null
  os: string
  isOnline: boolean
}

export interface TailscaleStatus {
  state: TailscaleState
  isMagicDnsEnabled: boolean
  self: TailnetNode | null
  peers: TailnetNode[]
  /** 이 PC 와 같은 Tailscale 계정(UserID)인 다른 기기의 Tailscale IP 전부 (IPv4·IPv6, 소문자). 여기서 온 요청은 로그인 없이 받는다 (isOwnPeerAddress) */
  ownerPeerIps: string[]
}

/** `GET /api/machines` 의 기기 하나 (화면이 그대로 쓰는 꼴) */
export interface Machine {
  name: string
  hostName: string
  url: string | null
  isSelf: boolean
  isOnline: boolean
  hasPray: boolean
}

export interface MachinesPayload {
  tailscale: TailscaleState
  machines: Machine[]
}

export const TAILSCALE_TIMEOUT_MS = 5_000
export const TAILSCALE_CACHE_MS = 30_000
/** 다른 PC 의 Pray 를 찾을 때 한 PC 를 기다리는 시간 */
export const PRAY_PROBE_TIMEOUT_MS = 1_500

const EMPTY_STATUS = { isMagicDnsEnabled: false, self: null, peers: [], ownerPeerIps: [] }

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nodeOf(value: unknown): TailnetNode | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const dnsName = text(raw.DNSName).replace(/\.$/, '') || null
  const hostName = text(raw.HostName)
  const ips = Array.isArray(raw.TailscaleIPs) ? raw.TailscaleIPs : []
  const ipv4 = ips.find((ip): ip is string => typeof ip === 'string' && isIP(ip) === 4) ?? null
  const name = dnsName ? dnsName.split('.')[0] : hostName
  if (!name) return null
  return { name, hostName, dnsName, ipv4, os: text(raw.OS), isOnline: raw.Online === true }
}

/** `tailscale status --json` 결과 해석 (순수). BackendState 가 Running 일 때만 ready, 그 밖(Stopped·NeedsLogin·Starting 등)은 stopped */
export function parseTailscaleStatus(json: unknown): TailscaleStatus {
  if (!json || typeof json !== 'object') return { state: 'error', ...EMPTY_STATUS }
  const raw = json as Record<string, unknown>
  if (raw.BackendState !== 'Running') return { state: 'stopped', ...EMPTY_STATUS }
  const tailnet = raw.CurrentTailnet as Record<string, unknown> | null | undefined
  const peers = raw.Peer && typeof raw.Peer === 'object' ? Object.values(raw.Peer as Record<string, unknown>) : []
  return {
    state: 'ready',
    isMagicDnsEnabled: tailnet?.MagicDNSEnabled === true,
    self: nodeOf(raw.Self),
    peers: peers.map(nodeOf).filter((node): node is TailnetNode => node !== null),
    ownerPeerIps: ownerPeerIpsOf(raw.Self, peers),
  }
}

function userIdOf(value: unknown): number | null {
  const userId = value && typeof value === 'object' ? (value as Record<string, unknown>).UserID : null
  return typeof userId === 'number' && userId > 0 ? userId : null
}

/** 이 PC 와 UserID 가 같은 peer 의 TailscaleIPs. 남이 공유한 기기·태그 기기는 UserID 가 달라 빠진다. 이 PC 의 UserID 가 없으면 [] */
function ownerPeerIpsOf(self: unknown, peers: unknown[]): string[] {
  const selfUserId = userIdOf(self)
  if (selfUserId === null) return []
  return peers.flatMap((peer) => {
    if (userIdOf(peer) !== selfUserId) return []
    const ips = (peer as Record<string, unknown>).TailscaleIPs
    return Array.isArray(ips) ? ips.filter((ip): ip is string => typeof ip === 'string' && isIP(ip) !== 0).map((ip) => ip.toLowerCase()) : []
  })
}

/**
 * 소켓 주소가 이 PC 와 같은 Tailscale 계정의 다른 기기인지 (순수). ready 일 때만. `::ffff:100.x` 꼴도 IPv4 로 본다.
 * Tailscale 이 기기 인증·암호화를 하고 TCP 라 주소를 꾸밀 수 없어, 여기 맞으면 메일 로그인을 건너뛴다 (이 PC 전용 기능은 여전히 loopback 만)
 */
export function isOwnPeerAddress(status: TailscaleStatus, remoteAddress: string | undefined): boolean {
  if (status.state !== 'ready' || !remoteAddress) return false
  const address = remoteAddress.toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '')
  return status.ownerPeerIps.includes(address)
}

/** 이 PC 자신의 Tailscale 이름 (Host 검사에 더한다, 소문자). MagicDNS 전체 이름과 그 첫 칸. ready 가 아니거나 이름이 없으면 [] */
export function selfHostNames(status: TailscaleStatus): string[] {
  const dnsName = status.state === 'ready' ? status.self?.dnsName : null
  if (!dnsName) return []
  const full = dnsName.toLowerCase()
  return [full, full.split('.')[0]]
}

/** 그 기기의 Pray 주소. MagicDNS 가 켜졌으면 이름으로, 아니면 IPv4 로. 둘 다 없으면 null */
export function machineUrl(node: TailnetNode, isMagicDnsEnabled: boolean, port: number): string | null {
  if (isMagicDnsEnabled && node.dnsName) return `http://${node.dnsName}:${port}`
  if (node.ipv4) return `http://${node.ipv4}:${port}`
  return null
}

/** 화면에 줄 PC 목록 (순수). 이 PC 가 맨 앞(Pray 있음·온라인), 나머지는 name 순. ready 가 아니면 빈 목록 */
export function buildMachines(status: TailscaleStatus, prayIps: ReadonlySet<string>, port: number): MachinesPayload {
  if (status.state !== 'ready') return { tailscale: status.state, machines: [] }
  const peers = [...status.peers]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => ({
      name: node.name,
      hostName: node.hostName,
      url: machineUrl(node, status.isMagicDnsEnabled, port),
      isSelf: false,
      isOnline: node.isOnline,
      hasPray: node.isOnline && node.ipv4 !== null && prayIps.has(node.ipv4),
    }))
  const self = status.self
    ? [{ name: status.self.name, hostName: status.self.hostName, url: machineUrl(status.self, status.isMagicDnsEnabled, port), isSelf: true, isOnline: true, hasPray: true }]
    : []
  return { tailscale: 'ready', machines: [...self, ...peers] }
}

/** tailscale CLI 위치: `%ProgramFiles%\Tailscale\tailscale.exe` 가 있으면 그것, 없으면 PATH 의 tailscale */
export function findTailscale(env: NodeJS.ProcessEnv = process.env, exists: (path: string) => boolean = existsSync): string {
  const programFiles = env.ProgramFiles
  if (programFiles) {
    const path = join(programFiles, 'Tailscale', 'tailscale.exe')
    if (exists(path)) return path
  }
  return 'tailscale'
}

/** 서비스가 꺼져 있을 때 CLI 가 내는 글 ("failed to connect to local Tailscale service; is Tailscale running?") */
const NOT_RUNNING = /is tailscale running|failed to connect to local tailscale/i

/** `tailscale status --json` 을 셸 없이 부른다. 던지지 않는다 — 실패는 not-installed·stopped·error 상태로 */
export function readTailscaleStatus(run: typeof execFile = execFile, command: string = findTailscale()): Promise<TailscaleStatus> {
  return new Promise((resolve) => {
    run(command, ['status', '--json'], { timeout: TAILSCALE_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const out = String(stdout ?? '')
      try {
        // 꺼진 상태에서는 종료 코드가 0 이 아니어도 JSON 을 낼 수 있어 먼저 해석해 본다
        if (out.trim().startsWith('{')) return resolve(parseTailscaleStatus(JSON.parse(out)))
      } catch {
        // 아래에서 오류로
      }
      if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return resolve({ state: 'not-installed', ...EMPTY_STATUS })
      if (NOT_RUNNING.test(String(stderr ?? ''))) return resolve({ state: 'stopped', ...EMPTY_STATUS })
      console.error(`tailscale status 실패: ${error?.message ?? '해석할 수 없는 출력'}${stderr ? ` — ${String(stderr).trim()}` : ''}`)
      resolve({ state: 'error', ...EMPTY_STATUS })
    })
  })
}

/** Pray 가 돌 수 없는 OS (tailscale status 의 OS 값, 소문자로 비교). 폰은 4710 에 응답하지 않아 확인이 제한 시간까지 기다렸다 */
const NO_PRAY_OS = new Set(['android', 'ios'])

/** Pray 가 떠 있는지 물어볼 기기: 온라인·IPv4 있음·폰이 아님 */
export function isProbeTarget(node: TailnetNode): boolean {
  return node.isOnline && node.ipv4 !== null && !NO_PRAY_OS.has(node.os.toLowerCase())
}

/** 그 IP 의 4710 에 Pray 가 있는지: `/api/auth/me` 응답 JSON 의 `app` 이 'pray'. 시간 초과·연결 실패·다른 응답은 false */
export async function probePray(ipv4: string, port: number, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetchImpl(`http://${ipv4}:${port}/api/auth/me`, { signal: AbortSignal.timeout(PRAY_PROBE_TIMEOUT_MS) })
    if (!response.ok) return false
    const body = (await response.json()) as { app?: unknown } | null
    return body?.app === 'pray'
  } catch {
    return false
  }
}

/**
 * 시계 주입 30초 캐시 + 같이 온 요청은 하나를 기다린다.
 * isStaleServed 면 시간이 지난 값도 바로 주고 새 값은 뒤에서 읽는다 (값이 아직 없을 때만 기다린다)
 */
class Cached<T> {
  private value: { at: number; data: T } | null = null
  private pending: Promise<T> | null = null

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    private readonly now: () => number,
    private readonly isStaleServed = false,
  ) {}

  get(): Promise<T> {
    if (this.value && this.now() - this.value.at < this.ttlMs) return Promise.resolve(this.value.data)
    const loading = this.refresh()
    if (this.value && this.isStaleServed) {
      // load 는 던지지 않지만, 혹시 던져도 처리되지 않은 거부로 서버가 죽지 않게
      loading.catch(() => {})
      return Promise.resolve(this.value.data)
    }
    return loading
  }

  private refresh(): Promise<T> {
    if (!this.pending) {
      this.pending = this.load()
        .then((data) => {
          this.value = { at: this.now(), data }
          return data
        })
        .finally(() => {
          this.pending = null
        })
    }
    return this.pending
  }
}

export interface TailscaleDeps {
  readStatus?: () => Promise<TailscaleStatus>
  probe?: (ipv4: string, port: number) => Promise<boolean>
  now?: () => number
}

/** tailscale 상태·PC 목록 (각각 30초 캐시). 던지지 않는다 */
export class Tailscale {
  private readonly statusCache: Cached<TailscaleStatus>
  private readonly machinesCache: Cached<MachinesPayload>

  constructor(port: number, deps: TailscaleDeps = {}) {
    const readStatus = deps.readStatus ?? (() => readTailscaleStatus())
    const probe = deps.probe ?? ((ipv4: string, probePort: number) => probePray(ipv4, probePort))
    const now = deps.now ?? Date.now
    this.statusCache = new Cached(readStatus, TAILSCALE_CACHE_MS, now)
    this.machinesCache = new Cached(
      async () => {
        const status = await this.status()
        const targets = status.state === 'ready' ? status.peers.filter(isProbeTarget) : []
        const found = await Promise.all(targets.map(async (node) => ((await probe(node.ipv4!, port)) ? node.ipv4! : null)))
        return buildMachines(status, new Set(found.filter((ip): ip is string => ip !== null)), port)
      },
      TAILSCALE_CACHE_MS,
      now,
      // 상대 PC 확인은 응답 없는 기기에서 1.5초를 기다려서, 지난 목록을 바로 주고 뒤에서 새로 만든다 (처음 한 번만 기다린다)
      true,
    )
  }

  status(): Promise<TailscaleStatus> {
    return this.statusCache.get()
  }

  machines(): Promise<MachinesPayload> {
    return this.machinesCache.get()
  }
}
