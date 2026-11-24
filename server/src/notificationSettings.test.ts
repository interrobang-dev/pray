import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_NOTIFICATION_SETTINGS } from '@pray/host/notificationSettings'
import { readNotificationSettings, saveNotificationSettings } from './notificationSettings.js'

let dir: string
let path: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pray-notification-settings-'))
  path = join(dir, 'pray', 'notifications.json')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('notifications.json', () => {
  it('파일이 없으면 기본값으로 읽고 만들지 않는다', () => {
    expect(readNotificationSettings(path)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    expect(readdirSync(dir)).toEqual([])
  })

  it('저장하면 폴더째 만들고 2칸 들여쓰기 전체 값을 쓴다 (임시 파일은 남지 않는다)', () => {
    const settings = saveNotificationSettings(path, { done: false })
    expect(settings).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, done: false })
    const text = readFileSync(path, 'utf8')
    expect(text).toBe(JSON.stringify(settings, null, 2) + '\n')
    expect(readdirSync(join(dir, 'pray'))).toEqual(['notifications.json'])
    expect(readNotificationSettings(path)).toEqual(settings)
  })

  it('지금 값에 합치고 모르는 키는 남긴다', () => {
    saveNotificationSettings(path, { enabled: false })
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({ ...raw, future: 'keep' }))
    const settings = saveNotificationSettings(path, { sound: false })
    expect(settings).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false, sound: false })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ ...settings, future: 'keep' })
  })

  it('깨진 파일은 기본값으로 읽고, 저장하면 덮어쓴다', () => {
    saveNotificationSettings(path, {})
    writeFileSync(path, '{ broken')
    expect(readNotificationSettings(path)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    expect(saveNotificationSettings(path, { reminders: false })).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, reminders: false })
    expect(readNotificationSettings(path).reminders).toBe(false)
  })
})
