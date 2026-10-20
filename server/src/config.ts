import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export interface SmtpConfig {
  host: string
  port: number
  user: string
  pass: string
}

export interface Config {
  /** 서버 바인딩 주소. 기본 127.0.0.1 (로컬만). 원격 접속을 열려면 0.0.0.0 */
  bind: string
  /** 인증 코드를 받을 수 있는 메일 주소. 비어 있으면 원격 로그인 불가 */
  loginEmails: string[]
  smtp: SmtpConfig | null
}

export const configDir = join(homedir(), '.claude', 'jk-corp')
const configPath = join(configDir, 'config.json')

export function readConfig(): Config {
  let parsed: Partial<Config> = {}
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    // 파일 없음 → 로컬 전용 기본값
  }
  return {
    bind: parsed.bind ?? '127.0.0.1',
    loginEmails: (parsed.loginEmails ?? []).map((e) => e.toLowerCase()),
    smtp: parsed.smtp ?? null,
  }
}
