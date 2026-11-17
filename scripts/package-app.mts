// 트레이 앱 설치 파일(NSIS)을 만든다: npm run package [-- --publish]
// 1) 호스트·서버·MCP·검색 worker 를 esbuild 로 묶어 release/resources/pray/ 에 (node-pty 만 밖에 두고 prebuild 를 같이 복사)
// 2) 트레이 main 을 electron-updater 까지 묶어 release/app/main.js 에 (package.json 은 의존성 없이 — npm workspaces 의 node_modules 를 모으지 않게)
// 3) electron-builder 로 release/dist/Pray-Setup-<버전>.exe. --publish 면 GitHub Releases(interrobang-dev/pray)에 올린다 (GH_TOKEN 필요)
// 웹 빌드(web/dist)는 먼저 npm run build 로 만들어 둔다.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build as bundle } from 'esbuild'
import { build as buildApp, Platform } from 'electron-builder'
import { appIconIco } from '../desktop/src/icon.ts'

const root = resolve(import.meta.dirname, '..')
const release = join(root, 'release')
const appDir = join(release, 'app')
const prayDir = join(release, 'resources', 'pray')
const isPublish = process.argv.includes('--publish')

const desktopPackage = JSON.parse(readFileSync(join(root, 'desktop', 'package.json'), 'utf8')) as { version: string }
const version = desktopPackage.version
// 태그로 돈 CI 면 태그와 버전이 같아야 한다 (v0.2.0 태그인데 package.json 이 0.1.0 이면 업데이트가 영영 안 잡힌다)
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined
if (tag && tag !== `v${version}`) throw new Error(`태그 ${tag} 와 desktop/package.json 버전 ${version} 이 다르다`)
if (!existsSync(join(root, 'web', 'dist', 'index.html'))) throw new Error('web/dist 가 없다. npm run build 를 먼저 한다')
const electronVersion = (JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')) as { version: string }).version

rmSync(release, { recursive: true, force: true })
mkdirSync(appDir, { recursive: true })
mkdirSync(prayDir, { recursive: true })

// ESM 묶음 안에서 CommonJS 의존성(express 등)이 require 를 쓸 수 있게
const requireBanner = "import { createRequire as __prayCreateRequire } from 'node:module'; const require = __prayCreateRequire(import.meta.url);"
await bundle({
  entryPoints: {
    host: join(root, 'host', 'src', 'index.ts'),
    server: join(root, 'server', 'src', 'index.ts'),
    workspaceSearchWorker: join(root, 'server', 'src', 'workspaceSearchWorker.ts'),
    mcp: join(root, 'mcp', 'src', 'index.ts'),
  },
  outdir: prayDir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['node-pty'],
  banner: { js: requireBanner },
  logLevel: 'warning',
})

// node-pty: 실행에 필요한 것만 (lib + win32-x64 prebuild. N-API 라 Electron node 에서도 다시 빌드하지 않고 돈다)
const ptySource = join(root, 'node_modules', 'node-pty')
const ptyTarget = join(prayDir, 'node_modules', 'node-pty')
cpSync(join(ptySource, 'package.json'), join(ptyTarget, 'package.json'))
cpSync(join(ptySource, 'lib'), join(ptyTarget, 'lib'), { recursive: true })
cpSync(join(ptySource, 'prebuilds', 'win32-x64'), join(ptyTarget, 'prebuilds', 'win32-x64'), { recursive: true })

await bundle({
  entryPoints: [join(root, 'desktop', 'src', 'main.ts')],
  outfile: join(appDir, 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'warning',
})
writeFileSync(
  join(appDir, 'package.json'),
  JSON.stringify({ name: '@pray/desktop', productName: 'Pray', version, description: 'Pray tray app', author: 'interrobang-dev', main: 'main.js' }, null, 2),
)
mkdirSync(join(appDir, 'build'), { recursive: true })
writeFileSync(join(appDir, 'build', 'icon.ico'), appIconIco())

await buildApp({
  projectDir: appDir,
  targets: Platform.WINDOWS.createTarget('nsis', 1 /* x64 */),
  publish: isPublish ? 'always' : 'never',
  config: {
    appId: 'pray', // 알림 ID(app.setAppUserModelId('pray'))와 같게 — 시작 메뉴 바로가기의 AUMID 가 된다
    productName: 'Pray',
    electronVersion,
    npmRebuild: false,
    asar: true,
    files: ['main.js', 'package.json'],
    directories: { output: join(release, 'dist'), buildResources: 'build' },
    extraResources: [
      // electron-builder 는 extraResources 안의 node_modules 를 기본으로 뺀다 — node-pty 는 따로, 들어갈 자리를 to 로 준다
      { from: prayDir, to: 'pray', filter: ['*.mjs'] },
      { from: ptyTarget, to: 'pray/node_modules/node-pty' },
      { from: join(root, 'web', 'dist'), to: 'web' },
      { from: join(root, 'mod'), to: 'mod', filter: ['**/*', '!tests/**', '!.claude-plugin/types/**'] },
    ],
    win: { target: 'nsis', icon: 'build/icon.ico' },
    nsis: {
      oneClick: true,
      perMachine: false,
      artifactName: 'Pray-Setup-${version}.${ext}',
      shortcutName: 'Pray',
      deleteAppDataOnUninstall: false,
    },
    publish: [{ provider: 'github', owner: 'interrobang-dev', repo: 'pray', releaseType: 'release' }],
  },
})
console.log(`release/dist/Pray-Setup-${version}.exe`)
