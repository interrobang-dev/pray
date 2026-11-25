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

const EMPTY_STATUS = { isMagicDnsEnabled: false, self: null, peers: [] }

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
  }
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

/** 시계 주입 30초 캐시 + 같이 온 요청은 하나를 기다린다 */
class Cached<T> {
  private value: { at: number; data: T } | null = null
  private pending: Promise<T> | null = null

  constructor(
    private readonly load: () => Promise<T>,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(): Promise<T> {
    if (this.value && this.now() - this.value.at < this.ttlMs) return Promise.resolve(this.value.data)
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
        const targets = status.state === 'ready' ? status.peers.filter((node) => node.isOnline && node.ipv4) : []
        const found = await Promise.all(targets.map(async (node) => ((await probe(node.ipv4!, port)) ? node.ipv4! : null)))
        return buildMachines(status, new Set(found.filter((ip): ip is string => ip !== null)), port)
      },
      TAILSCALE_CACHE_MS,
      now,
    )
  }

  status(): Promise<TailscaleStatus> {
    return this.statusCache.get()
  }

  machines(): Promise<MachinesPayload> {
    return this.machinesCache.get()
  }
}
