import { spawn } from 'node:child_process'
import { win32 } from 'node:path'

/**
 * 팀 폴더 열기 요청을 거절할 이유 (순수). 통과면 null.
 * 다른 PC 를 먼저 막는다 — 이 PC 화면에 창을 띄우는 것이라 다른 PC 에서는 의미가 없고, 팀·폴더 유무도 알려 주지 않는다
 */
export function openFolderRejection(input: { isLocal: boolean; hasTeam: boolean; isDirectory: boolean }): { status: 403 | 404; message: string } | null {
  if (!input.isLocal) return { status: 403, message: 'Folders open only on this PC' }
  if (!input.hasTeam) return { status: 404, message: 'Team not found' }
  if (!input.isDirectory) return { status: 404, message: 'Team folder not found' }
  return null
}

/**
 * explorer.exe 에 그대로 넘길 인자 (순수): Windows 구분자, 끝 `\` 를 떼고(드라이브 루트는 남긴다) 늘 따옴표로 감싼다.
 * Node 는 공백이 없으면 따옴표를 붙이지 않는데, explorer 는 따옴표 밖의 쉼표를 자기 옵션 구분자로 읽어 `a,b` 폴더를 못 연다.
 * Windows 경로에는 `"` 가 들어갈 수 없어 이스케이프할 것이 없다
 */
export function explorerArgument(folder: string): string {
  const normalized = win32.normalize(folder)
  const trimmed = /^[A-Za-z]:\\$/.test(normalized) ? normalized : normalized.replace(/\\+$/, '')
  return `"${trimmed}"`
}

/** 탐색기에서 파일 하나를 고른 채 그 폴더를 열 인자 (순수): `/select,"<파일>"`. 경로는 explorerArgument 와 같이 따옴표로 감싼다 (쉼표·공백) */
export function explorerSelectArgument(file: string): string {
  return `/select,${explorerArgument(file)}`
}

/**
 * 탐색기로 폴더를 연다. 셸 없이 띄우고 기다리지 않는다 (detached + unref).
 * explorer.exe 는 이미 떠 있는 셸 프로세스에 넘기고 바로 끝나며 성공해도 종료 코드가 1 이라 종료 코드는 보지 않는다
 */
export function openInExplorer(folder: string, spawnProcess: typeof spawn = spawn): void {
  launchExplorer(explorerArgument(folder), folder, spawnProcess)
}

/** 탐색기로 파일이 든 폴더를 열고 그 파일을 고른다 (대화 속 경로 열기). 띄우는 방식은 openInExplorer 와 같다 */
export function selectInExplorer(file: string, spawnProcess: typeof spawn = spawn): void {
  launchExplorer(explorerSelectArgument(file), file, spawnProcess)
}

function launchExplorer(argument: string, path: string, spawnProcess: typeof spawn): void {
  const child = spawnProcess('explorer.exe', [argument], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true })
  // 'error' 를 듣지 않으면 띄우기 실패(ENOENT 등)가 잡히지 않은 예외로 서버를 죽인다
  child.on('error', (error) => console.error(`[open-folder] ${path}: ${error.message}`))
  child.unref()
}
