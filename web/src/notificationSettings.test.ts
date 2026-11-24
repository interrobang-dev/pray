import { describe, expect, it } from 'vitest'
import { parseNotificationSettings, revertNotificationSetting, withNotificationSetting } from './notificationSettings'
import type { NotificationSettings } from './types'

const ALL_ON: NotificationSettings = { enabled: true, done: true, myTurn: true, needsApproval: true, handOver: true, reminders: true, scheduledFailed: true, sound: true }

describe('parseNotificationSettings', () => {
  it('reads a full settings object', () => {
    expect(parseNotificationSettings({ settings: { ...ALL_ON, sound: false, extra: 1 } })).toEqual({ ...ALL_ON, sound: false })
  })
  it('rejects missing or non-boolean values', () => {
    expect(parseNotificationSettings(null)).toBeNull()
    expect(parseNotificationSettings({})).toBeNull()
    expect(parseNotificationSettings({ settings: { ...ALL_ON, done: 'yes' } })).toBeNull()
    const { sound: _sound, ...partial } = ALL_ON
    expect(parseNotificationSettings({ settings: partial })).toBeNull()
  })
})

describe('withNotificationSetting', () => {
  it('changes only that key', () => {
    expect(withNotificationSetting(ALL_ON, 'done', false)).toEqual({ ...ALL_ON, done: false })
  })
})

describe('revertNotificationSetting', () => {
  it('restores the previous value when the attempt is still shown', () => {
    expect(revertNotificationSetting({ ...ALL_ON, done: false }, 'done', false, true)).toEqual(ALL_ON)
  })
  it('keeps a newer value', () => {
    const newer = { ...ALL_ON, done: true }
    expect(revertNotificationSetting(newer, 'done', false, true)).toBe(newer)
  })
})
