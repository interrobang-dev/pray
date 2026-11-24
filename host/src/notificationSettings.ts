/**
 * 알림 설정 `~/.claude/pray/notifications.json`: 트레이 Windows 알림을 띄울지 (전체·종류별·소리). 꼴·해석·patch 검증 순수 함수.
 * 파일 읽기·쓰기는 서버 `server/src/notificationSettings.ts`, 트레이는 CommonJS 빌드라 `desktop/src/notificationSettings.ts` 에 같은 규칙 사본 (같이 고친다)
 */

export interface NotificationSettings {
  /** 전체 스위치. false 면 트레이가 아무 알림도 띄우지 않는다 (트레이 메뉴 Notifications 체크) */
  enabled: boolean
  done: boolean
  myTurn: boolean
  needsApproval: boolean
  handOver: boolean
  reminders: boolean
  scheduledFailed: boolean
  /** false 면 소리 없이 */
  sound: boolean
}

export const NOTIFICATION_SETTING_KEYS = [
  'enabled',
  'done',
  'myTurn',
  'needsApproval',
  'handOver',
  'reminders',
  'scheduledFailed',
  'sound',
] as const satisfies readonly (keyof NotificationSettings)[]

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  done: true,
  myTurn: true,
  needsApproval: true,
  handOver: true,
  reminders: true,
  scheduledFailed: true,
  sound: true,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 해석한 값 → 설정. 객체가 아니면 전부 기본값, 키가 없거나 boolean 이 아니면 그 키만 기본값 */
export function notificationSettingsOf(value: unknown): NotificationSettings {
  const settings = { ...DEFAULT_NOTIFICATION_SETTINGS }
  if (!isPlainObject(value)) return settings
  for (const key of NOTIFICATION_SETTING_KEYS) {
    const each = value[key]
    if (typeof each === 'boolean') settings[key] = each
  }
  return settings
}

/** 파일 글 → 해석한 값. 없거나(null) 해석이 안 되면 null (알림 설정이라 막지 않고 기본값으로 읽는다). BOM 은 뗀다 */
export function parseNotificationJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text.replace(/^﻿/, '')) as unknown
  } catch {
    return null
  }
}

/** 파일 글 → 설정 (없음·깨짐 = 전부 기본값) */
export function parseNotificationSettings(text: string | null): NotificationSettings {
  return notificationSettingsOf(parseNotificationJson(text))
}

export type NotificationPatchResult = { patch: Partial<NotificationSettings> } | { message: string }

/** PUT 본문의 settings 검증. 객체가 아니거나 모르는 키·boolean 아닌 값이면 화면에 보낼 영어 문구 */
export function parseNotificationPatch(value: unknown): NotificationPatchResult {
  if (!isPlainObject(value)) return { message: 'settings must be an object' }
  const keys = NOTIFICATION_SETTING_KEYS as readonly string[]
  const patch: Partial<NotificationSettings> = {}
  for (const [key, each] of Object.entries(value)) {
    if (!keys.includes(key)) return { message: `Unknown notification setting: ${key}` }
    if (typeof each !== 'boolean') return { message: `${key} must be true or false` }
    patch[key as keyof NotificationSettings] = each
  }
  return { patch }
}

/**
 * 저장할 파일 내용: 지금 해석한 값의 모르는 키는 그대로 두고(새 코드가 더한 키를 옛 쪽이 지우지 않게) 8개 키는 해석한 설정 + patch.
 * 결과의 settings 는 합친 전체
 */
export function mergeNotificationFile(
  current: unknown,
  patch: Partial<NotificationSettings>,
): { file: Record<string, unknown>; settings: NotificationSettings } {
  const settings = { ...notificationSettingsOf(current), ...patch }
  const file = { ...(isPlainObject(current) ? current : {}), ...settings }
  return { file, settings }
}
