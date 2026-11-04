/**
 * 서버·호스트가 끊겼다 다시 붙을 때까지의 위쪽 띠 (App.tsx). 순수 함수만.
 * 끊김 = 화면과 서버의 SSE 가 끊김(서버 재시작) 또는 서버가 호스트에 못 붙음(호스트 재시작). 호스트가 붙은 뒤에는
 * 끊기기 전 근무 중이던 웹 세션이 휴식에서 근무로 돌아올 때까지(호스트가 하나씩 --resume 한다) 되살리는 중이다.
 * 화면 ↻ 로 시작한 것만 "Restarting …" 이고, 트레이 메뉴·갑자기 끊긴 것은 "Reconnecting …" 이다
 */
import type { Session } from './types'
import { attendanceOf } from './types'

export type RestartTarget = 'server' | 'host'

/** 이보다 짧게 끊겼다 붙으면 띠를 안 띄운다 (짧은 끊김마다 깜박이지 않게) */
export const SHOW_DELAY_MS = 800
/** 다 돌아온 뒤 "Reconnected" 를 보이는 시간 */
export const DONE_SHOW_MS = 2_000
/** 호스트가 붙은 뒤 이만큼 지나도 덜 돌아오면 그만 기다린다 (폴더가 없어진 세션처럼 영영 안 돌아오는 것이 있다) */
export const RESUME_TIMEOUT_MS = 90_000
/** 시간 초과로 끝났을 때 결과를 보이는 시간 */
export const PARTIAL_SHOW_MS = 6_000
/** ↻ 를 누른 뒤 이 안에 끊겨야 그 재시작으로 본다 */
export const REQUEST_WINDOW_MS = 15_000

export interface ConnectionInput {
  isConnected: boolean
  isHostReachable: boolean
  sessions: readonly Pick<Session, 'id' | 'kind' | 'attendance' | 'isAlive'>[]
}

export interface Outage {
  since: number
  /** 화면 ↻ 로 시작했으면 그 대상 */
  requested: RestartTarget | null
  /** 끊기기 전 근무 중이던 웹 세션 (돌아오기를 기다린다) */
  resumeIds: readonly string[]
  /** 띠를 한 번이라도 보였는지 (안 보였으면 끝나도 "Reconnected" 를 안 띄운다) */
  isShown: boolean
  /** 서버·호스트가 다 붙은 시각 (되살리기 시간 초과를 잰다). 아직이면 null */
  linkedAt: number | null
  /** 끝난 시각. 아직이면 null */
  endedAt: number | null
  isTimedOut: boolean
}

export type BannerPhase = 'server' | 'host' | 'resume' | 'done' | 'partial'

export interface Banner {
  phase: BannerPhase
  text: string
}

const isLinked = (input: ConnectionInput) => input.isConnected && input.isHostReachable

/** 지금 근무 중인 웹 세션 ID (끊기기 전 기억해 둘 것) */
export function presentWebIds(sessions: ConnectionInput['sessions']): string[] {
  return sessions.filter((session) => session.kind === 'web' && attendanceOf(session) === 'present').map((session) => session.id)
}

/** 기다리는 세션 중 돌아온 수와 전체. 목록에서 빠진 세션(기록이 지워짐)은 기다리지 않는다 */
function resumeProgress(outage: Outage, input: ConnectionInput): { back: number; total: number } {
  const byId = new Map(input.sessions.map((session) => [session.id, session]))
  const waited = outage.resumeIds.filter((id) => byId.has(id))
  const back = waited.filter((id) => attendanceOf(byId.get(id)!) === 'present').length
  return { back, total: waited.length }
}

function isSameOutage(a: Outage, b: Outage): boolean {
  return (
    a.since === b.since &&
    a.requested === b.requested &&
    a.resumeIds === b.resumeIds &&
    a.isShown === b.isShown &&
    a.linkedAt === b.linkedAt &&
    a.endedAt === b.endedAt &&
    a.isTimedOut === b.isTimedOut
  )
}

/**
 * 다음 끊김 상태. 바뀐 것이 없으면 같은 객체를 돌려준다 (React state 로 쓴다).
 * healthyIds = 마지막으로 다 붙어 있을 때 근무 중이던 웹 세션, request = 최근 ↻ (REQUEST_WINDOW_MS 안이면 그 재시작으로 본다)
 */
export function nextOutage(
  outage: Outage | null,
  input: ConnectionInput,
  now: number,
  healthyIds: readonly string[],
  request: { target: RestartTarget; at: number } | null,
): Outage | null {
  const linked = isLinked(input)
  const start = (): Outage => ({
    since: now,
    requested: request && now - request.at <= REQUEST_WINDOW_MS ? request.target : null,
    resumeIds: healthyIds,
    isShown: false,
    linkedAt: null,
    endedAt: null,
    isTimedOut: false,
  })
  if (!outage) return linked ? null : start()
  if (outage.endedAt !== null) {
    if (!linked) return start()
    const showFor = outage.isTimedOut ? PARTIAL_SHOW_MS : DONE_SHOW_MS
    return now - outage.endedAt >= showFor ? null : outage
  }
  const isShown = outage.isShown || now - outage.since >= SHOW_DELAY_MS
  let next: Outage
  if (!linked) {
    next = { ...outage, isShown, linkedAt: null }
  } else {
    const linkedAt = outage.linkedAt ?? now
    const { back, total } = resumeProgress(outage, input)
    if (back >= total) {
      if (!isShown) return null
      next = { ...outage, isShown, linkedAt, endedAt: now }
    } else if (now - linkedAt >= RESUME_TIMEOUT_MS) {
      if (!isShown) return null
      next = { ...outage, isShown, linkedAt, endedAt: now, isTimedOut: true }
    } else {
      next = { ...outage, isShown, linkedAt }
    }
  }
  return isSameOutage(next, outage) ? outage : next
}

/** 위쪽 띠에 보일 것. 안 보이면 null */
export function bannerOf(outage: Outage | null, input: ConnectionInput): Banner | null {
  if (!outage || !outage.isShown) return null
  const { back, total } = resumeProgress(outage, input)
  if (outage.endedAt !== null) {
    return outage.isTimedOut
      ? { phase: 'partial', text: `Resumed ${back}/${total} · check the session list` }
      : { phase: 'done', text: 'Reconnected' }
  }
  if (!input.isConnected) {
    return { phase: 'server', text: outage.requested === 'server' ? 'Restarting server…' : 'Reconnecting to server…' }
  }
  if (!input.isHostReachable) {
    return { phase: 'host', text: outage.requested === 'host' ? 'Restarting host…' : 'Reconnecting to host…' }
  }
  return { phase: 'resume', text: `Resuming sessions ${back}/${total}` }
}
