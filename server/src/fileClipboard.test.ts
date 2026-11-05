import { describe, expect, it } from 'vitest'
import { CLIPBOARD_PATH_ENV, clipboardCommand, copyFileRejection, copyFileToClipboard } from './fileClipboard.js'

describe('copyFileRejection', () => {
  it('rejects other PCs first, then pages that are not this app on this PC', () => {
    expect(copyFileRejection({ isLocal: false, isLocalPage: true })?.status).toBe(403)
    expect(copyFileRejection({ isLocal: false, isLocalPage: false })?.message).toMatch(/only on this PC/)
    expect(copyFileRejection({ isLocal: true, isLocalPage: false })?.message).toMatch(/must come from this app/)
    expect(copyFileRejection({ isLocal: true, isLocalPage: true })).toBeNull()
  })
})

describe('clipboardCommand', () => {
  it('runs Windows PowerShell and passes the path only through the environment', () => {
    const file = `D:\\a "b" $(rm x)\\c.txt`
    const { command, args, env } = clipboardCommand(file)
    expect(command).toBe('powershell.exe')
    expect(args).toEqual(['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Set-Clipboard -LiteralPath $env:${CLIPBOARD_PATH_ENV}`])
    expect(args.join(' ')).not.toContain(file)
    expect(env).toEqual({ [CLIPBOARD_PATH_ENV]: file })
  })
})

describe('copyFileToClipboard', () => {
  it('resolves on success and rejects with stderr on failure', async () => {
    const calls: { env: NodeJS.ProcessEnv }[] = []
    const ok = ((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      calls.push(options)
      callback(null, '', '')
    }) as never
    await copyFileToClipboard('D:\\x.txt', ok)
    expect(calls[0].env[CLIPBOARD_PATH_ENV]).toBe('D:\\x.txt')
    const failed = ((_command: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) =>
      callback(new Error('exit 1'), '', 'Set-Clipboard : boom\r\n')) as never
    await expect(copyFileToClipboard('D:\\x.txt', failed)).rejects.toThrow('exit 1 — Set-Clipboard : boom')
  })
})
