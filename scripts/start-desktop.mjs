// npm run desktop 이 부른다: 트레이를 바로가기·로그인 자동 실행과 같은 명령 `pray.exe "<저장소>\desktop"` 으로 띄운다.
// `electron .` 은 electron.exe 로 떠서 작업 관리자·바로가기의 exe 가 pray.exe 와 갈렸다.
// pray.exe 는 postinstall(scripts/brand-electron.mts)이 만드는 electron.exe 의 같은 폴더 사본. 없으면 경고하고 electron.exe 로 띄운다
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

const repoDir = resolve(import.meta.dirname, '..')
const electronExe = createRequire(import.meta.url)('electron')
const prayExe = join(dirname(electronExe), 'pray.exe')
const exe = process.platform === 'win32' && existsSync(prayExe) ? prayExe : electronExe
if (exe !== prayExe && process.platform === 'win32') console.warn(`start-desktop: ${prayExe} 가 없어 electron.exe 로 띄운다 (npm run brand:electron 으로 만든다)`)

// electron 의 cli.js 처럼: 이 셸에 ELECTRON_RUN_AS_NODE 가 있으면 트레이가 node 로 돌아 버린다
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(exe, [join(repoDir, 'desktop')], { cwd: repoDir, env, stdio: 'inherit', windowsHide: false })
child.on('error', (error) => {
  console.error(`start-desktop: ${exe} 를 띄우지 못했다: ${String(error)}`)
  process.exit(1)
})
child.on('close', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => !child.killed && child.kill(signal))
