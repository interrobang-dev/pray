import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chromeArguments, chromeCandidates, findChrome, isHtmlFile, openInChrome, parseRegistryDefault, resolveChatHtml } from './openInChrome.js'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

describe('isHtmlFile', () => {
  it('accepts .html and .htm in any case only', () => {
    for (const path of ['a.html', 'C:\\r\\Report.HTM', 'd/x.Html']) expect(isHtmlFile(path), path).toBe(true)
    for (const path of ['a.htmlx', 'a.html.txt', 'a.xhtml', 'a.svg', 'html', 'a.md']) expect(isHtmlFile(path), path).toBe(false)
  })
})

describe('parseRegistryDefault', () => {
  it('reads the default value whatever the value-name column says', () => {
    const english = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\chrome.exe\r\n    (Default)    REG_SZ    ${CHROME}\r\n\r\n`
    const korean = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\...\\chrome.exe\r\n    (기본값)    REG_SZ    ${CHROME}\r\n\r\n`
    expect(parseRegistryDefault(english, {})).toBe(CHROME)
    expect(parseRegistryDefault(korean, {})).toBe(CHROME)
  })

  it('strips quotes and expands REG_EXPAND_SZ variables', () => {
    expect(parseRegistryDefault(`    (Default)    REG_SZ    "${CHROME}"\r\n`, {})).toBe(CHROME)
    const expand = '    (Default)    REG_EXPAND_SZ    %LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe\r\n'
    expect(parseRegistryDefault(expand, { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })).toBe('C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
  })

  it('null without a string value', () => {
    expect(parseRegistryDefault('', {})).toBe(null)
    expect(parseRegistryDefault('ERROR: The system was unable to find the specified registry key or value.', {})).toBe(null)
  })
})

describe('findChrome', () => {
  const env = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }

  it('lists the install folders in order', () => {
    expect(chromeCandidates(env)).toEqual([
      CHROME,
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
    ])
    expect(chromeCandidates({ ProgramFiles: '' })).toEqual([])
  })

  it('prefers HKLM, then HKCU, then the install folders, and only existing absolute paths', async () => {
    const userChrome = 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    const exists = async (path: string) => path === CHROME || path === userChrome
    expect(await findChrome({ readRegistry: async (hive) => (hive === 'HKLM' ? CHROME : userChrome), exists, env })).toBe(CHROME)
    expect(await findChrome({ readRegistry: async (hive) => (hive === 'HKLM' ? null : userChrome), exists, env })).toBe(userChrome)
    // 레지스트리 값이 없는 파일·상대 경로·"(value not set)" 이면 설치 위치를 본다
    expect(await findChrome({ readRegistry: async () => '(value not set)', exists, env })).toBe(CHROME)
    expect(await findChrome({ readRegistry: async () => 'D:\\gone\\chrome.exe', exists: async (path) => path === userChrome, env })).toBe(userChrome)
    expect(await findChrome({ readRegistry: async () => null, exists: async () => false, env })).toBe(null)
  })
})

describe('chromeArguments', () => {
  it('passes one absolute path that starts with a drive letter or UNC, never a flag', () => {
    for (const file of ['C:\\Users\\me\\report.html', 'D:\\a b\\--incognito.html', 'D:\\-x\\a.htm', '\\\\server\\share\\a.html']) {
      const args = chromeArguments(file)
      expect(args, file).toEqual([file])
      expect(args![0].startsWith('-'), file).toBe(false)
    }
  })

  it('refuses anything that could read as a flag or is not absolute', () => {
    for (const file of ['--incognito', '-a.html', 'report.html', 'C:report.html', '/c/a.html', '']) expect(chromeArguments(file), file).toBe(null)
  })
})

describe('openInChrome', () => {
  it('spawns chrome without a shell, detached, and survives spawn errors', () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    const spawnProcess = vi.fn(() => child) as unknown as typeof spawn
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    openInChrome(CHROME, ['C:\\r\\a.html'], spawnProcess)
    expect(spawnProcess).toHaveBeenCalledWith(CHROME, ['C:\\r\\a.html'], { detached: true, stdio: 'ignore' })
    expect(child.unref).toHaveBeenCalled()
    // 'error' 를 들으므로 던지지 않는다
    child.emit('error', new Error('spawn ENOENT'))
    expect(errorLog).toHaveBeenCalled()
    errorLog.mockRestore()
  })
})

describe('resolveChatHtml', () => {
  let base: string
  let root: string
  let temp: string
  let outside: string

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), 'pray-chat-html-')))
    root = join(base, 'work')
    temp = join(base, 'temp-claude')
    outside = join(base, 'outside')
    for (const dir of [join(root, 'docs'), join(temp, 's', 'scratchpad'), outside]) mkdirSync(dir, { recursive: true })
    writeFileSync(join(root, 'docs', 'report.html'), '<p>hi</p>')
    writeFileSync(join(root, 'old.HTM'), '<p>hi</p>')
    writeFileSync(join(root, 'shot.png'), 'png')
    writeFileSync(join(temp, 's', 'scratchpad', 'cap.html'), '<p>cap</p>')
    writeFileSync(join(outside, 'secret.html'), '<p>no</p>')
    mkdirSync(join(root, 'folder.html'))
    symlinkSync(outside, join(root, 'out-link'), 'junction')
  })

  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('opens .html/.htm inside the session folder or the Claude temp folder', async () => {
    expect(await resolveChatHtml('docs/report.html', root, temp)).toBe(join(root, 'docs', 'report.html'))
    expect(await resolveChatHtml(join(root, 'old.HTM'), root, temp)).toBe(join(root, 'old.HTM'))
    expect(await resolveChatHtml(join(temp, 's', 'scratchpad', 'cap.html'), null, temp)).toBe(join(temp, 's', 'scratchpad', 'cap.html'))
  })

  it('refuses other files, folders, missing files and paths outside the ranges', async () => {
    expect(await resolveChatHtml('shot.png', root, temp)).toBe(null)
    expect(await resolveChatHtml('folder.html', root, temp)).toBe(null)
    expect(await resolveChatHtml('missing.html', root, temp)).toBe(null)
    expect(await resolveChatHtml(join(outside, 'secret.html'), root, temp)).toBe(null)
    expect(await resolveChatHtml('out-link/secret.html', root, temp)).toBe(null)
  })
})
