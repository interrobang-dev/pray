/**
 * 대화 탭의 보낸 시각·날짜 구분선 (순수 함수). 시각은 이 PC 시각이다.
 * 줄마다 보낸 쪽·시각을 받아 그 줄에 시각 글자를 붙일지, 그 줄 앞에 날짜 구분선을 그릴지 정한다 (Chat 이 줄 앞에 붙여 그린다 — 줄 수에 들지 않는다)
 */

/** 줄 하나의 시각 정보 */
export interface RowStamp {
  /** 날짜를 볼 시각 (ISO). null 이거나 읽을 수 없으면 날짜 구분선에 관여하지 않는다 */
  at: string | null
  /**
   * 시각을 붙이는 보낸 쪽 ('me'·'claude'·'relay:<지시자 이름>' 등, 같은 값이면 같은 쪽). null = 시각을 붙이지 않는 줄 (작업 묶음·알림·대기 중 등) —
   * 연속을 끊는다
   */
  sender: string | null
}

export interface RowTime {
  /** 이 줄에 붙일 시각 글자 "14:05". 붙이지 않으면 null */
  time: string | null
  /** 이 줄 앞 날짜 구분선 글자 "Today"·"Yesterday"·"Nov 12, 2026". 없으면 null */
  dateLabel: string | null
}

function parseTime(iso: string | null): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 이 PC 시각의 날짜 키 "2026-11-13" */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 이 PC 시각의 분 키 "2026-11-13 14:05" (연속 메시지 판정) */
function localMinuteKey(date: Date): string {
  return `${localDayKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** "14:05" (24시간, 이 PC 시각) */
export function formatTimeOfDay(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 날짜 구분선 글자: 오늘 "Today", 어제 "Yesterday", 그 밖 "Nov 12, 2026" */
export function dateDividerLabel(date: Date, now: Date): string {
  const key = localDayKey(date)
  if (key === localDayKey(now)) return 'Today'
  if (key === localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * 줄마다 시각 글자·날짜 구분선.
 * - 날짜 구분선: 시각이 있는 줄 중 날짜(이 PC)가 앞 줄과 바뀌는 줄 앞, 그리고 첫 줄 앞
 * - 시각: 보낸 쪽이 있는 줄에 붙이되, 바로 다음 줄이 같은 쪽·같은 분이고 그 사이에 구분선이 없으면 붙이지 않는다 (연속 메시지는 마지막 것에만).
 *   다음 줄이 다른 쪽·보낸 쪽 없음(작업 묶음 등)이면 끊긴다
 */
export function rowTimes(stamps: RowStamp[], now: Date): RowTime[] {
  const dates = stamps.map((stamp) => parseTime(stamp.at))
  let previousDay: string | null = null
  const dateLabels = dates.map((date) => {
    if (!date) return null
    const day = localDayKey(date)
    if (day === previousDay) return null
    previousDay = day
    return dateDividerLabel(date, now)
  })
  return stamps.map((stamp, index) => {
    const date = dates[index]
    if (stamp.sender === null || !date) return { time: null, dateLabel: dateLabels[index] }
    const next = stamps[index + 1]
    const nextDate = dates[index + 1]
    const isContinued =
      next !== undefined && next.sender === stamp.sender && nextDate !== null && dateLabels[index + 1] === null && localMinuteKey(nextDate) === localMinuteKey(date)
    return { time: isContinued ? null : formatTimeOfDay(date), dateLabel: dateLabels[index] }
  })
}
