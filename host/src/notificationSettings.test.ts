import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  mergeNotificationFile,
  NOTIFICATION_SETTING_KEYS,
  notificationSettingsOf,
  parseNotificationPatch,
  parseNotificationSettings,
} from './notificationSettings.js'

describe('parseNotificationSettings', () => {
  it('기본값은 모두 true 이고 키는 8개', () => {
    expect(NOTIFICATION_SETTING_KEYS).toHaveLength(8)
    expect(Object.keys(DEFAULT_NOTIFICATION_SETTINGS).sort()).toEqual([...NOTIFICATION_SETTING_KEYS].sort())
    for (const key of NOTIFICATION_SETTING_KEYS) expect(DEFAULT_NOTIFICATION_SETTINGS[key]).toBe(true)
  })

  it('파일이 없거나 깨졌거나 객체가 아니면 전부 기본값', () => {
    for (const text of [null, '', '{', 'null', '[]', '"x"', '3', 'true']) {
      expect(parseNotificationSettings(text)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    }
  })

  it('boolean 인 키만 읽고 없는 키·다른 꼴은 기본값, 모르는 키는 무시', () => {
    const text = JSON.stringify({ enabled: false, done: 'no', myTurn: 0, sound: false, extra: false })
    expect(parseNotificationSettings(text)).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false, sound: false })
  })

  it('BOM 을 뗀다', () => {
    expect(parseNotificationSettings('﻿{"reminders":false}').reminders).toBe(false)
  })

  it('돌려준 값은 기본값 객체와 따로다', () => {
    const settings = notificationSettingsOf(null)
    settings.enabled = false
    expect(DEFAULT_NOTIFICATION_SETTINGS.enabled).toBe(true)
  })
})

describe('parseNotificationPatch', () => {
  it('일부 키만 받는다 (빈 객체 포함)', () => {
    expect(parseNotificationPatch({ done: false, sound: true })).toEqual({ patch: { done: false, sound: true } })
    expect(parseNotificationPatch({})).toEqual({ patch: {} })
  })

  it('객체가 아니면 400 문구', () => {
    for (const value of [undefined, null, [], 'x', true]) {
      expect(parseNotificationPatch(value)).toEqual({ message: 'settings must be an object' })
    }
  })

  it('모르는 키·boolean 아닌 값은 400 문구', () => {
    expect(parseNotificationPatch({ done: false, volume: true })).toEqual({ message: 'Unknown notification setting: volume' })
    expect(parseNotificationPatch({ myTurn: 'false' })).toEqual({ message: 'myTurn must be true or false' })
    expect(parseNotificationPatch({ sound: null })).toEqual({ message: 'sound must be true or false' })
  })
})

describe('mergeNotificationFile', () => {
  it('지금 값에 patch 를 합치고 모르는 키는 남긴다', () => {
    const current = { enabled: false, future: { a: 1 }, done: 'bad' }
    const { file, settings } = mergeNotificationFile(current, { done: false })
    expect(settings).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false, done: false })
    expect(file).toEqual({ ...settings, future: { a: 1 } })
  })

  it('깨진 파일(null)·객체가 아닌 값이면 기본값 + patch', () => {
    for (const current of [null, [1], 'x']) {
      const { file, settings } = mergeNotificationFile(current, { sound: false })
      expect(settings).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, sound: false })
      expect(file).toEqual(settings)
    }
  })
})
