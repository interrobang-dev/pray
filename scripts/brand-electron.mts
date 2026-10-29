// 트레이 앱이 그대로 실행하는 node_modules\electron\dist\electron.exe 의 아이콘과 이름을 Pray 로 바꾼다. 루트 postinstall 이 부른다.
// - 탐색기·작업 관리자·바로가기·작업 표시줄은 exe 아이콘을, Windows 알림 머리 이름은 exe 파일 설명(FileDescription)을 따른다
// - 다시 돌려도 결과가 같다: 이미 바뀌었는지 보지 않고 같은 ico·같은 글자를 다시 쓴다
// - exe 가 잠겨 있거나(트레이 실행 중) 실패하면 경고만 내고 종료 코드 0 — 설치를 막지 않는다. 트레이 Quit 뒤 npm run brand:electron 으로 다시 한다
// 쓰기: node --import tsx scripts/brand-electron.mts [electron.exe 경로]   (경로가 없으면 설치된 electron 패키지의 exe)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appIconIco } from '../desktop/src/icon.ts'

const NAME = 'Pray'
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// git 이 무시하는 폴더 (desktop 빌드 결과 옆)
const icoPath = join(repoDir, 'desktop', 'dist', 'pray.ico')

async function main(): Promise<void> {
  if (process.platform !== 'win32') return
  const exePath = process.argv[2] ? resolve(process.argv[2]) : (createRequire(import.meta.url)('electron') as string)
  try {
    mkdirSync(dirname(icoPath), { recursive: true })
    writeFileSync(icoPath, appIconIco())
    const { rcedit } = await import('rcedit')
    await rcedit(exePath, { icon: icoPath, 'version-string': { FileDescription: NAME, ProductName: NAME } })
    console.log(`brand-electron: ${exePath} 의 아이콘·파일 설명·제품 이름을 ${NAME} 로 바꿨다`)
  } catch (error) {
    console.warn(`brand-electron: ${exePath} 를 바꾸지 못했다 (트레이가 떠 있으면 Quit 뒤 npm run brand:electron): ${String(error)}`)
  }
}

await main()
