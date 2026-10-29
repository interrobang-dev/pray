import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataDirResult } from './dataDir.js'

/** `--name=value` 형식의 실행 인자. 작업 스케줄러는 환경변수를 못 넘기므로 인자로 받는다 */
export function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/**
 * `--log=<path>` 가 있으면 console 출력을 그 파일에 덧붙인다 (UTF-8, 타임스탬프).
 * 로그 폴더를 만들기 전에 설정 폴더 이전(dataDir)을 먼저 한다 — 로그 폴더 `~/.claude/pray/logs` 를 먼저 만들면 `pray/` 가 생겨 옛 폴더를 옮기지 않는다
 */
export function setupFileLog(): void {
  const { warning } = dataDirResult()
  const path = getArg('log')
  if (path) {
    mkdirSync(dirname(path), { recursive: true })
    const write = (level: string, args: unknown[]) => {
      const line = args.map((a) => (a instanceof Error ? a.stack ?? a.message : String(a))).join(' ')
      appendFileSync(path, `${new Date().toISOString()} ${level} ${line}\n`)
    }
    console.log = (...args: unknown[]) => write('info', args)
    console.error = (...args: unknown[]) => write('error', args)
    process.on('uncaughtException', (error) => {
      write('fatal', [error])
      process.exit(1)
    })
  }
  if (warning) console.error(warning)
}
