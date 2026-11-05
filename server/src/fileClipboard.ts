import { execFile } from 'node:child_process'

/** 파일을 클립보드에 넣는 powershell 이 이보다 오래 걸리면 끈다 */
export const CLIPBOARD_TIMEOUT_MS = 10_000

/** 넣을 파일 경로를 넘기는 환경변수. 명령 글자에 경로를 넣지 않아 따옴표·`$` 가 든 경로도 명령을 바꾸지 못한다 */
export const CLIPBOARD_PATH_ENV = 'PRAY_CLIPBOARD_PATH'

/**
 * 파일 복사 요청을 거절할 이유 (순수). 통과면 null.
 * 다른 PC 를 먼저 막는다 — 이 PC 의 클립보드에 넣는 것이라 다른 PC 에서는 쓸모가 없고, 파일 유무도 알려 주지 않는다
 */
export function copyFileRejection(input: { isLocal: boolean; isLocalPage: boolean }): { status: 403; message: string } | null {
  if (!input.isLocal) return { status: 403, message: 'Copying files works only on this PC (open it at 127.0.0.1)' }
  if (!input.isLocalPage) return { status: 403, message: 'Copy requests must come from this app on this PC' }
  return null
}

/**
 * Windows PowerShell 5.1 실행 인자 (순수). `Set-Clipboard -LiteralPath` 는 탐색기 Ctrl+C 와 같은 파일 목록을 넣는다
 * (PowerShell 7 에는 -LiteralPath·-Path 가 없어 powershell.exe 를 쓴다). 오류가 종료 코드 1 이 되게 Stop 을 건다.
 * 없는 경로도 오류 없이 그대로 넣으므로(실측) 파일이 있는지는 라우트가 먼저 본다
 */
export function clipboardCommand(file: string): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'; Set-Clipboard -LiteralPath $env:${CLIPBOARD_PATH_ENV}`],
    env: { [CLIPBOARD_PATH_ENV]: file },
  }
}

/** 파일 하나를 이 PC 의 클립보드에 넣는다. 실패(종료 코드·시간 초과·띄우기 실패)면 던진다 */
export function copyFileToClipboard(file: string, run: typeof execFile = execFile): Promise<void> {
  const { command, args, env } = clipboardCommand(file)
  return new Promise((resolve, reject) => {
    run(command, args, { env: { ...process.env, ...env }, timeout: CLIPBOARD_TIMEOUT_MS, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${error.message}${stderr ? ` — ${String(stderr).trim()}` : ''}`))
      else resolve()
    })
  })
}
