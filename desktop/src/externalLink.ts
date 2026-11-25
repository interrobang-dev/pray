/** 서버 `GET /api/machines` 의 기기 하나 중 트레이가 쓰는 칸 */
export interface PrayMachine {
  name: string
  hostName: string
  url: string | null
  isSelf: boolean
  hasPray: boolean
}

function httpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/** Tailscale 로 이어진 다른 PC 의 Pray origin (hasPray, 이 PC 는 뺀다) */
function otherPrayOrigins(machines: readonly PrayMachine[]): string[] {
  return machines.flatMap((machine) => {
    const url = machine.isSelf || !machine.hasPray || !machine.url ? null : httpUrl(machine.url)
    return url ? [url.origin] : []
  })
}

/** 주소가 이 PC 자신의 Tailscale 주소인지: 이 PC 줄의 url origin, 또는 같은 포트의 그 이름(Tailscale 기기 이름·Windows 이름) */
function isSelfTailscale(target: URL, machines: readonly PrayMachine[]): boolean {
  const self = machines.find((machine) => machine.isSelf)
  const selfUrl = self?.url ? httpUrl(self.url) : null
  if (!self || !selfUrl) return false
  if (target.origin === selfUrl.origin) return true
  if (target.port !== selfUrl.port || target.protocol !== selfUrl.protocol) return false
  const names = [self.name, self.hostName].filter(Boolean).map((name) => name.toLowerCase())
  return names.includes(target.hostname)
}

/**
 * 트레이 창에서 새 창으로 열려는 주소를 기본 브라우저로 넘길지. Pray 서버 자신·Tailscale PC 의 Pray(machines) 가 아닌 http(s) 만 넘긴다 —
 * 서버 주소(그림 "Open original" 같은 `/api/...`)는 지금처럼 Electron 새 창으로 열고, 그 밖의 프로토콜은 넘기지 않는다
 */
export function isExternalUrl(url: string, serverUrl: string, machines: readonly PrayMachine[] = []): boolean {
  const target = httpUrl(url)
  if (!target) return false
  if (target.origin === new URL(serverUrl).origin) return false
  if (otherPrayOrigins(machines).includes(target.origin)) return false
  return !isSelfTailscale(target, machines)
}

/**
 * 트레이 창이 같은 창 안에서 옮겨 가려는 주소(`will-navigate`)를 어떻게 할지 (순수).
 * - allow: Pray 서버 자신·Tailscale 로 이어진 다른 PC 의 Pray → 그대로 연다
 * - self: 이 PC 자신의 Tailscale 주소 → 막고 서버 주소(127.0.0.1)로 다시 연다 (loopback 이라 로그인 없이 이 PC 전용 기능을 쓴다)
 * - external: 그 밖의 http(s) → 막고 기본 브라우저로
 * - block: http(s) 가 아님·해석 안 됨 → 막기만
 */
export type NavigationDecision = 'allow' | 'self' | 'external' | 'block'

export function navigationDecision(url: string, serverUrl: string, machines: readonly PrayMachine[]): NavigationDecision {
  const target = httpUrl(url)
  if (!target) return 'block'
  if (target.origin === new URL(serverUrl).origin) return 'allow'
  if (isSelfTailscale(target, machines)) return 'self'
  if (otherPrayOrigins(machines).includes(target.origin)) return 'allow'
  return 'external'
}

/** 서버 `/api/machines` 응답에서 트레이가 쓰는 기기 목록 (꼴이 틀린 줄은 버린다). 응답 꼴이 틀리면 null */
export function parseMachines(json: unknown): PrayMachine[] | null {
  const list = (json as { machines?: unknown } | null)?.machines
  if (!Array.isArray(list)) return null
  return list.flatMap((item: unknown) => {
    const raw = item as Record<string, unknown> | null
    if (!raw || typeof raw.name !== 'string') return []
    return [
      {
        name: raw.name,
        hostName: typeof raw.hostName === 'string' ? raw.hostName : '',
        url: typeof raw.url === 'string' ? raw.url : null,
        isSelf: raw.isSelf === true,
        hasPray: raw.hasPray === true,
      },
    ]
  })
}
