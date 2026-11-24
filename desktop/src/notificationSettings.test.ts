import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as host from '../../host/src/notificationSettings'
import {
  allowedNotices,
  DEFAULT_NOTIFICATION_SETTINGS,
  isNoticeAllowed,
  legacyNotificationFile,
  NOTIFICATION_SETTING_KEYS,
  parseNotificationSettings,
  readNotificationSettings,
  settingKeyOf,
  writeNotificationPatch,
} from './notificationSettings'
import type { NotifyKind } from './notify'

describe('notificationSettings (host/src/notificationSettings.ts 사본)', () => {
  it('키·기본값이 같다', () => {
    expect(NOTIFICATION_SETTING_KEYS).toEqual(host.NOTIFICATION_SETTING_KEYS)
    expect(DEFAULT_NOTIFICATION_SETTINGS).toEqual(host.DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('파일 글 해석이 같다', () => {
    const texts = [
      null,
      '',
      '{',
      'null',
      '[]',
      '"x"',
      '﻿{"sound":false}',
      JSON.stringify({ enabled: false, done: 'no', myTurn: 0, needsApproval: false, extra: true }),
      JSON.stringify(Object.fromEntries(NOTIFICATION_SETTING_KEYS.map((key) => [key, false]))),
    ]
    for (const text of texts) expect(parseNotificationSettings(text)).toEqual(host.parseNotificationSettings(text))
  })
})

describe('알림 거르기', () => {
  const kinds: NotifyKind[] = ['done', 'my-turn', 'needs-approval', 'hand-over']
  const notices = kinds.map((kind) => ({ kind, sessionId: kind }))

  it('종류 → 설정 키', () => {
    expect(kinds.map(settingKeyOf)).toEqual(['done', 'myTurn', 'needsApproval', 'handOver'])
  })

  it('기본값이면 다 남긴다', () => {
    expect(allowedNotices(notices, DEFAULT_NOTIFICATION_SETTINGS)).toEqual(notices)
  })

  it('전체가 꺼지면 종류 스위치와 상관없이 없다', () => {
    expect(allowedNotices(notices, { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false })).toEqual([])
  })

  it('꺼진 종류만 뺀다', () => {
    const settings = { ...DEFAULT_NOTIFICATION_SETTINGS, done: false, handOver: false }
    expect(allowedNotices(notices, settings).map((notice) => notice.kind)).toEqual(['my-turn', 'needs-approval'])
  })

  it('Reminders·예약 실패는 enabled 와 그 키, 업데이트·훅 경고는 enabled 만', () => {
    const off = { ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false }
    expect(isNoticeAllowed(DEFAULT_NOTIFICATION_SETTINGS, 'reminders')).toBe(true)
    expect(isNoticeAllowed({ ...DEFAULT_NOTIFICATION_SETTINGS, reminders: false }, 'reminders')).toBe(false)
    expect(isNoticeAllowed({ ...DEFAULT_NOTIFICATION_SETTINGS, reminders: false }, 'scheduledFailed')).toBe(true)
    expect(isNoticeAllowed({ ...DEFAULT_NOTIFICATION_SETTINGS, scheduledFailed: false }, 'scheduledFailed')).toBe(false)
    expect(isNoticeAllowed(off, 'reminders')).toBe(false)
    expect(isNoticeAllowed({ ...DEFAULT_NOTIFICATION_SETTINGS, done: false, reminders: false })).toBe(true)
    expect(isNoticeAllowed(off)).toBe(false)
  })
})

describe('legacyNotificationFile', () => {
  it('파일이 없고 옛 isNotifying 이 false 일 때만 enabled false', () => {
    expect(legacyNotificationFile(false, false)).toEqual({ enabled: false })
    expect(legacyNotificationFile(true, false)).toBeNull()
    expect(legacyNotificationFile(false, true)).toBeNull()
    expect(legacyNotificationFile(false, undefined)).toBeNull()
    expect(legacyNotificationFile(false, 'false')).toBeNull()
  })
})

describe('파일 읽기·쓰기', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pray-tray-notifications-'))
    path = join(dir, 'pray', 'notifications.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('없으면 기본값', () => {
    expect(readNotificationSettings(path)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
  })

  it('enabled 만 바꾸고 다른 키·모르는 키는 그대로 둔다 (2칸 들여쓰기)', () => {
    writeNotificationPatch(path, { sound: false })
    const before = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({ ...before, done: false, future: 1 }))
    writeNotificationPatch(path, { enabled: false })
    const text = readFileSync(path, 'utf8')
    expect(JSON.parse(text)).toEqual({ sound: false, done: false, future: 1, enabled: false })
    expect(text).toBe(JSON.stringify({ sound: false, done: false, future: 1, enabled: false }, null, 2) + '\n')
    expect(readNotificationSettings(path)).toEqual({ ...DEFAULT_NOTIFICATION_SETTINGS, enabled: false, done: false, sound: false })
  })

  it('깨진 파일은 기본값으로 읽고, 쓰면 patch 만 남는다', () => {
    writeNotificationPatch(path, {})
    writeFileSync(path, '{ broken')
    expect(readNotificationSettings(path)).toEqual(DEFAULT_NOTIFICATION_SETTINGS)
    writeNotificationPatch(path, { enabled: true })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ enabled: true })
  })
})
