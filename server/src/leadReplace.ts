/**
 * Hand over 로 새 지시자를 띄울 때 옛 지시자를 끝내고 기다리기 (POST /api/sessions 의 replacesLead).
 * 옛 지시자에게 kill 을 보낸 뒤 근무가 끝나기를(isAlive false) 일정 간격으로 확인한다. 시계·잠자기 주입이라 테스트에서 시간을 돌린다
 */

/** 옛 지시자가 끝나기를 기다리는 최대 시간 */
export const LEAD_END_TIMEOUT_MS = 10_000
/** 끝났는지 확인하는 간격 */
export const LEAD_END_POLL_MS = 200

/**
 * ended = 옛 지시자가 끝났고 그 단위의 지시자는 아직 그 세션 (새 지시자를 띄워도 된다)
 * superseded = 기다리는 동안 다른 요청이 그 단위의 지시자를 바꿨다 (동시에 온 두 Hand over 중 늦은 쪽)
 * timeout = 시간 안에 안 끝났다
 */
export type LeadEndOutcome = 'ended' | 'superseded' | 'timeout'

export type LeadEndWait = {
  /** 끝내는 옛 지시자 세션 ID */
  leadId: string
  /** 그 단위의 지금 leadSessionId (매번 hq 에서 다시 읽는다) */
  currentLeadId: () => string | null | undefined
  /** 그 세션이 근무 중인지 (세션 목록의 isAlive 와 같은 기준) */
  isAlive: () => Promise<boolean>
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * 옛 지시자가 끝나기를 기다린다. 끝났다고 본 직후(await 뒤) 지시자가 그대로인지 한 번 더 보고 돌려준다 —
 * 부른 쪽은 'ended' 를 받으면 await 없이 바로 leadSessionId 를 바꿔야 다른 요청과 겹치지 않는다
 */
export async function waitForLeadEnd(wait: LeadEndWait): Promise<LeadEndOutcome> {
  const timeoutMs = wait.timeoutMs ?? LEAD_END_TIMEOUT_MS
  const pollMs = wait.pollMs ?? LEAD_END_POLL_MS
  const now = wait.now ?? Date.now
  const sleep = wait.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const startedAt = now()
  for (;;) {
    if (wait.currentLeadId() !== wait.leadId) return 'superseded'
    const isAlive = await wait.isAlive()
    if (wait.currentLeadId() !== wait.leadId) return 'superseded'
    if (!isAlive) return 'ended'
    if (now() - startedAt >= timeoutMs) return 'timeout'
    await sleep(pollMs)
  }
}
