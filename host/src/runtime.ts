import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** `--name=value` 형식의 실행 인자. 작업 스케줄러는 환경변수를 못 넘기므로 인자로 받는다 */
export function getArg(name: string): string | undefined {
  const prefix = `--${name}=`
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

/** `--log=<path>` 가 있으면 console 출력을 그 파일에 덧붙인다 (UTF-8, 타임스탬프) */
export function setupFileLog(): void {
  const path = getArg('log')
  if (!path) return
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
