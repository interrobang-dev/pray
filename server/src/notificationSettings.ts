import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  mergeNotificationFile,
  notificationSettingsOf,
  parseNotificationJson,
  type NotificationSettings,
} from '@pray/host/notificationSettings'

/**
 * 알림 설정 파일 `~/.claude/pray/notifications.json` 읽기·쓰기 (`GET`·`PUT /api/notification-settings`). 해석 규칙은 `@pray/host/notificationSettings`.
 * 트레이도 같은 파일을 읽고(알림을 띄우기 전) Notifications 메뉴로 enabled 를 쓴다
 */

/** 파일 글. 없거나 못 읽으면 null (알림 설정이라 막지 않는다 — 기본값으로 읽힌다) */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function readNotificationSettings(path: string): NotificationSettings {
  return notificationSettingsOf(parseNotificationJson(readText(path)))
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_ATTEMPTS = 5
const RENAME_RETRY_MS = 50

/** hq.ts 의 writeHq 와 같은 방식: 같은 폴더 임시 파일에 다 쓴 뒤 바꿔 끼운다 (Windows 의 잠김은 50ms 간격 5번까지) */
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
 * 지금 파일 값에 patch 를 합쳐 저장하고 합친 전체를 준다. 깨진 파일은 기본값 + patch 로 덮어쓴다.
 * 모르는 키는 남긴다 (새 코드가 더한 키를 옛 서버·트레이가 지우지 않게). 쓰기 실패는 던진다 (Express 가 500)
 */
export function saveNotificationSettings(path: string, patch: Partial<NotificationSettings>): NotificationSettings {
  const { file, settings } = mergeNotificationFile(parseNotificationJson(readText(path)), patch)
  writeJsonAtomic(path, file)
  return settings
}
