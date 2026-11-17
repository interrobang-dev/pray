import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ASK_HOOK_URL, ensureHooks, HOOK_EVENTS, HOOK_URL, missingHooks, withPrayHooks } from './hookInstall.js'

const NOW = () => new Date('2026-11-17T02:00:00.000Z')
let dir: string
let settingsPath: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pray-hooks-'))
  settingsPath = join(dir, '.claude', 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function readSettings(): Record<string, any> {
  return JSON.parse(readFileSync(settingsPath, 'utf8'))
}

describe('missingHooks·withPrayHooks', () => {
  it('빈 설정이면 7개 모두 빠졌고, 더하면 하나도 안 빠진다', () => {
    expect(missingHooks({})).toEqual([...HOOK_EVENTS, 'PermissionRequest (AskUserQuestion)'])
    const next = withPrayHooks({})
    expect(missingHooks(next)).toEqual([])
    expect(next.hooks).toMatchObject({
      Stop: [{ hooks: [{ type: 'http', url: HOOK_URL, timeout: 2 }] }],
      PermissionRequest: [
        { hooks: [{ type: 'http', url: HOOK_URL, timeout: 2 }] },
        { matcher: 'AskUserQuestion', hooks: [{ type: 'http', url: ASK_HOOK_URL, timeout: 3600 }] },
      ],
    })
  })

  it('기존 훅·다른 설정은 그대로 두고 빠진 것만 뒤에 더한다 (받은 객체는 안 바꾼다)', () => {
    const other = { matcher: '*', hooks: [{ type: 'command', command: 'orca' }] }
    const settings = { theme: 'auto', hooks: { Stop: [other, { hooks: [{ type: 'http', url: HOOK_URL, timeout: 9 }] }], PermissionRequest: [other] } }
    const before = JSON.stringify(settings)
    expect(missingHooks(settings)).toEqual(['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'SessionEnd', 'PermissionRequest (AskUserQuestion)'])
    const next = withPrayHooks(settings) as any
    expect(JSON.stringify(settings)).toBe(before)
    expect(next.theme).toBe('auto')
    expect(next.hooks.Stop).toHaveLength(2)
    expect(next.hooks.PermissionRequest[0]).toEqual(other)
    expect(next.hooks.PermissionRequest).toHaveLength(3)
  })

  it('꼴이 틀린 hooks 는 던진다 (덮어쓰지 않게)', () => {
    expect(() => missingHooks({ hooks: [] })).toThrow()
    expect(() => missingHooks({ hooks: { Stop: {} } })).toThrow()
    // 묶음 안의 이상한 항목은 건너뛰기만 한다
    expect(missingHooks({ hooks: { Stop: [null, 3, { hooks: 'x' }] } })).toContain('Stop')
  })
})

describe('ensureHooks', () => {
  it('파일이 없으면 폴더째 만들고 7개를 더한다 (bak 없음)', () => {
    const status = ensureHooks(settingsPath, NOW)
    expect(status).toEqual({ state: 'installed', added: [...HOOK_EVENTS, 'PermissionRequest (AskUserQuestion)'], missing: [], message: null, checkedAt: '2026-11-17T02:00:00.000Z' })
    expect(missingHooks(readSettings())).toEqual([])
    expect(existsSync(`${settingsPath}.bak`)).toBe(false)
  })

  it('있으면 ok 이고 파일을 쓰지 않는다', () => {
    ensureHooks(settingsPath, NOW)
    const text = readFileSync(settingsPath, 'utf8')
    writeFileSync(settingsPath, text.replace(/\n/g, '\r\n'))
    expect(ensureHooks(settingsPath, NOW).state).toBe('ok')
    expect(readFileSync(settingsPath, 'utf8')).toContain('\r\n')
  })

  it('빠졌으면 다른 설정을 지키며 더하고 원래 파일을 bak 으로 남긴다 (BOM 도 읽는다)', () => {
    ensureHooks(settingsPath, NOW) // 폴더 만들기
    const original = '﻿{ "theme": "auto", "env": { "A": "1" } }'
    writeFileSync(settingsPath, original)
    const status = ensureHooks(settingsPath, NOW)
    expect(status.state).toBe('installed')
    expect(readSettings()).toMatchObject({ theme: 'auto', env: { A: '1' } })
    expect(readFileSync(`${settingsPath}.bak`, 'utf8')).toBe(original)
  })

  it('JSON 이 아니거나 꼴이 틀리면 쓰지 않고 failed', () => {
    ensureHooks(settingsPath, NOW)
    for (const text of ['{ "theme": ', '[1]', '{ "hooks": [] }']) {
      writeFileSync(settingsPath, text)
      const status = ensureHooks(settingsPath, NOW)
      expect(status.state).toBe('failed')
      expect(status.message).toMatch(/hooks weren't added/)
      expect(readFileSync(settingsPath, 'utf8')).toBe(text)
    }
  })

  it('빈 파일은 빈 설정으로 본다', () => {
    ensureHooks(settingsPath, NOW)
    writeFileSync(settingsPath, '')
    expect(ensureHooks(settingsPath, NOW).state).toBe('installed')
    expect(missingHooks(readSettings())).toEqual([])
  })
})
