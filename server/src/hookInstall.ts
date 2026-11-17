/**
 * ~/.claude/settings.json 의 Pray http 훅 확인·설치. 서버가 시작할 때와 1분마다(`index.ts`), `npm run hooks:install`(`hooks/install.mts`)이 쓴다.
 * 기존 훅·다른 설정은 건드리지 않고 빠진 Pray 훅만 더한다. 훅은 URL 로만 알아본다 (timeout 등 다른 칸이 달라도 있는 것으로 본다)
 */
import { copyFileSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const HOOK_URL = 'http://127.0.0.1:4710/api/hook'
/** 상태용 훅을 거는 이벤트 */
export const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'Stop', 'SessionEnd'] as const
/** AskUserQuestion 을 웹에서 답할 때까지 서버가 붙잡는 훅. 상태용 훅과 따로 둔다 (timeout 1시간) */
export const ASK_HOOK_URL = 'http://127.0.0.1:4710/api/hook/ask'
const ASK_HOOK_LABEL = 'PermissionRequest (AskUserQuestion)'

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 그 이벤트의 훅 묶음 배열에 이 URL 의 http 훅이 있는지. 꼴이 다른 묶음은 건너뛴다 */
function hasHttpHook(groups: unknown[], url: string): boolean {
  return groups.some((group) => isObject(group) && Array.isArray(group.hooks) && group.hooks.some((hook) => isObject(hook) && hook.type === 'http' && hook.url === url))
}

/** settings.hooks 의 꼴이 예상과 다르면 던진다 (모르는 꼴을 덮어써 사용자 설정을 망가뜨리지 않게) */
function hookGroupsOf(hooks: Json, event: string): unknown[] {
  const groups = hooks[event]
  if (groups === undefined) return []
  if (!Array.isArray(groups)) throw new Error(`settings.json hooks.${event} isn't a list`)
  return groups
}

function hooksOf(settings: Json): Json {
  if (settings.hooks === undefined) return {}
  if (!isObject(settings.hooks)) throw new Error("settings.json hooks isn't an object")
  return settings.hooks
}

/** 빠진 Pray 훅 이름 (이벤트 이름, 질문 훅은 "PermissionRequest (AskUserQuestion)"). 꼴이 틀리면 던진다 */
export function missingHooks(settings: Json): string[] {
  const hooks = hooksOf(settings)
  const missing: string[] = HOOK_EVENTS.filter((event) => !hasHttpHook(hookGroupsOf(hooks, event), HOOK_URL))
  if (!hasHttpHook(hookGroupsOf(hooks, 'PermissionRequest'), ASK_HOOK_URL)) missing.push(ASK_HOOK_LABEL)
  return missing
}

/** 빠진 Pray 훅을 더한 새 settings (받은 객체는 바꾸지 않는다). 꼴이 틀리면 던진다 */
export function withPrayHooks(settings: Json): Json {
  const hooks: Json = { ...hooksOf(settings) }
  for (const event of HOOK_EVENTS) {
    const groups = hookGroupsOf(hooks, event)
    if (!hasHttpHook(groups, HOOK_URL)) hooks[event] = [...groups, { hooks: [{ type: 'http', url: HOOK_URL, timeout: 2 }] }]
  }
  const permissionGroups = hookGroupsOf(hooks, 'PermissionRequest')
  if (!hasHttpHook(permissionGroups, ASK_HOOK_URL)) {
    hooks.PermissionRequest = [...permissionGroups, { matcher: 'AskUserQuestion', hooks: [{ type: 'http', url: ASK_HOOK_URL, timeout: 3600 }] }]
  }
  return { ...settings, hooks }
}

/**
 * 확인·설치 결과. ok = 다 있음, installed = 빠진 것(`added`)을 이번에 더함, failed = 빠졌는데 못 더함(`missing`·`message`).
 * message 는 화면·트레이에 보이는 영어 글
 */
export interface HookStatus {
  state: 'ok' | 'installed' | 'failed'
  added: string[]
  missing: string[]
  message: string | null
  checkedAt: string
}

function errorCode(error: unknown): string | undefined {
  return isObject(error) && typeof error.code === 'string' ? error.code : undefined
}

/** 같은 폴더 임시 파일에 다 쓴 뒤 바꿔 끼운다 (Claude Code 가 settings.json 을 핫리로드해 반쯤 쓴 파일을 읽지 않게). 바꿔 끼우기가 막히면 제자리에 쓴다 */
function writeSettings(path: string, text: string): void {
  const temp = `${path}.pray-${process.pid}.tmp`
  writeFileSync(temp, text)
  try {
    renameSync(temp, path)
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      // 임시 파일이 남아도 다음 쓰기가 덮는다
    }
    writeFileSync(path, text)
  }
}

/**
 * settings.json 을 읽어 빠진 Pray 훅을 더한다. 파일이 없으면 만든다 (Claude Code 를 새로 설치했을 때).
 * 해석이 안 되거나 꼴이 틀리면 쓰지 않고 failed. 더하기 전 원래 파일을 `settings.json.bak` 으로 남긴다. 던지지 않는다
 */
export function ensureHooks(settingsPath: string, now: () => Date = () => new Date()): HookStatus {
  const checkedAt = now().toISOString()
  const failed = (message: string, missing: string[] = []): HookStatus => ({ state: 'failed', added: [], missing, message, checkedAt })
  let text: string | null
  try {
    text = readFileSync(settingsPath, 'utf8')
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return failed(`Couldn't read ${settingsPath} (${errorCode(error) ?? String(error)})`)
    text = null
  }
  let settings: Json
  if (text === null || text.trim() === '') {
    settings = {}
  } else {
    let parsed: unknown
    try {
      parsed = JSON.parse(text.replace(/^﻿/, ''))
    } catch {
      return failed(`${settingsPath} isn't valid JSON, so Pray hooks weren't added`)
    }
    if (!isObject(parsed)) return failed(`${settingsPath} isn't a JSON object, so Pray hooks weren't added`)
    settings = parsed
  }
  let missing: string[]
  let next: Json
  try {
    missing = missingHooks(settings)
    if (missing.length === 0) return { state: 'ok', added: [], missing: [], message: null, checkedAt }
    next = withPrayHooks(settings)
  } catch (error) {
    return failed(`${error instanceof Error ? error.message : String(error)}, so Pray hooks weren't added`)
  }
  try {
    mkdirSync(dirname(settingsPath), { recursive: true })
    if (text !== null) copyFileSync(settingsPath, `${settingsPath}.bak`)
    writeSettings(settingsPath, JSON.stringify(next, null, 2) + '\n')
  } catch (error) {
    return failed(`Couldn't write ${settingsPath} (${errorCode(error) ?? String(error)})`, missing)
  }
  return { state: 'installed', added: missing, missing: [], message: null, checkedAt }
}
