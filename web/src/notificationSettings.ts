import type { NotificationSettings } from './types'

export type NotificationKey = keyof NotificationSettings

export const NOTIFICATION_ROWS: { key: NotificationKey; label: string; description: string | null }[] = [
  { key: 'done', label: 'Done', description: 'A session finished its turn' },
  { key: 'myTurn', label: 'My turn', description: 'A session is waiting for your reply' },
  { key: 'needsApproval', label: 'Needs approval', description: 'A session needs tool approval' },
  { key: 'handOver', label: 'Hand over', description: "A lead's context passed 150k" },
  { key: 'reminders', label: 'Reminders', description: null },
  { key: 'scheduledFailed', label: 'Scheduled message failed', description: null },
  { key: 'sound', label: 'Sound', description: null },
]

const KEYS: NotificationKey[] = ['enabled', ...NOTIFICATION_ROWS.map((row) => row.key)]

/** 응답에서 설정 읽기: 모든 키가 boolean 이어야 한다. 아니면 null */
export function parseNotificationSettings(value: unknown): NotificationSettings | null {
  const settings = (value as { settings?: unknown } | null)?.settings
  if (typeof settings !== 'object' || settings === null) return null
  const record = settings as Record<string, unknown>
  if (!KEYS.every((key) => typeof record[key] === 'boolean')) return null
  return Object.fromEntries(KEYS.map((key) => [key, record[key]])) as unknown as NotificationSettings
}

/** 한 키만 바꾼 새 설정 */
export function withNotificationSetting(settings: NotificationSettings, key: NotificationKey, value: boolean): NotificationSettings {
  return { ...settings, [key]: value }
}

/** 실패한 PUT 을 되돌릴 때: 그 키가 아직 낙관적으로 바꾼 값이면 이전 값으로 (그 사이 다른 요청이 바꿨으면 그대로 둔다) */
export function revertNotificationSetting(settings: NotificationSettings, key: NotificationKey, attempted: boolean, previous: boolean): NotificationSettings {
  return settings[key] === attempted ? { ...settings, [key]: previous } : settings
}
