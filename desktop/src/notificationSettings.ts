import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { NotifyKind } from './notify'

/**
 * 알림 설정 `~/.claude/pray/notifications.json` (트레이가 알림을 띄우기 전에 읽고, Notifications 메뉴로 enabled 를 쓴다. 화면은 서버 API 로 바꾼다).
 * 해석 규칙은 `host/src/notificationSettings.ts` 사본이다 — 트레이는 dist 를 그대로 실행하는 CommonJS 라 `@pray/host` 의 .ts 를 require 하지 못한다.
 * `notificationSettings.test.ts` 가 host 쪽과 같은 결과인지 본다 (같이 고친다)
 */

export interface NotificationSettings {
  enabled: boolean
  done: boolean
  myTurn: boolean
  needsApproval: boolean
  handOver: boolean
  reminders: boolean
  scheduledFailed: boolean
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

/** 파일 글 → 해석한 값. 없거나(null) 해석이 안 되면 null. BOM 은 뗀다 */
export function parseNotificationJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text.replace(/^﻿/, '')) as unknown
  } catch {
    return null
  }
}

/** 파일 글 → 설정 (없음·깨짐 = 전부 기본값 — 알림 설정이라 막지 않는다) */
export function parseNotificationSettings(text: string | null): NotificationSettings {
  return notificationSettingsOf(parseNotificationJson(text))
}

/** 세션 알림 종류 → 설정 키 */
const KIND_SETTING: Record<NotifyKind, keyof NotificationSettings> = {
  done: 'done',
  'my-turn': 'myTurn',
  'needs-approval': 'needsApproval',
  'hand-over': 'handOver',
}

export function settingKeyOf(kind: NotifyKind): keyof NotificationSettings {
  return KIND_SETTING[kind]
}

/** 띄울 세션 알림만 남긴다: 전체가 꺼졌으면 없음, 아니면 종류별 스위치. 묶음(3개 넘으면 한 장) 판정은 이 결과로 한다 */
export function allowedNotices<T extends { kind: NotifyKind }>(notices: readonly T[], settings: NotificationSettings): T[] {
  if (!settings.enabled) return []
  return notices.filter((notice) => settings[settingKeyOf(notice.kind)])
}

/** 종류 하나짜리 알림(Reminders·예약 실패)을 띄울지. 업데이트·훅 경고는 key 없이 enabled 만 */
export function isNoticeAllowed(settings: NotificationSettings, key?: 'reminders' | 'scheduledFailed'): boolean {
  return settings.enabled && (key === undefined || settings[key])
}

/**
 * 트레이 시작 때 옛 tray-settings.json 의 isNotifying 을 옮길지: notifications.json 이 없고 isNotifying 이 false 일 때만 `{ enabled: false }`.
 * 그 밖에는 null (아무것도 쓰지 않는다 — 없으면 기본값 켜짐)
 */
export function legacyNotificationFile(hasFile: boolean, legacyIsNotifying: unknown): { enabled: false } | null {
  return !hasFile && legacyIsNotifying === false ? { enabled: false } : null
}

/** 파일 글. 없거나 못 읽으면 null */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** 지금 설정 (알림을 띄우기 직전·메뉴를 만들 때 읽는다. 작은 파일이라 매번 읽는다) */
export function readNotificationSettings(path: string): NotificationSettings {
  return parseNotificationSettings(readText(path))
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

/** 서버 `server/src/notificationSettings.ts` 와 같은 방식: 같은 폴더 임시 파일에 다 쓴 뒤 바꿔 끼운다, 2칸 들여쓰기 */
function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tempPath = `${path}.${process.pid}.tmp`
  try {
    writeFileSync(tempPath, JSON.stringify(value, null, 2) + '\n')
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tempPath, path)
        break
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code ?? ''
        if (attempt >= RENAME_ATTEMPTS || !RENAME_RETRY_CODES.has(code)) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_RETRY_MS)
      }
    }
  } catch (error) {
    rmSync(tempPath, { force: true })
    throw error
  }
}

/**
 * patch 만 바꿔 쓴다 (트레이 메뉴는 enabled 만). 다른 키·모르는 키는 지금 파일 그대로 두고, 깨진 파일이면 patch 만 쓴다
 * (없는 키는 기본값으로 읽힌다). 쓰기 실패는 던진다
 */
export function writeNotificationPatch(path: string, patch: Partial<NotificationSettings>): void {
  const current = parseNotificationJson(readText(path))
  writeJsonAtomic(path, { ...(isPlainObject(current) ? current : {}), ...patch })
}
