import { randomBytes, randomInt } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CODE_TTL_MS = 10 * 60 * 1000
const CODE_RESEND_MS = 30 * 1000
const CODE_MAX_ATTEMPTS = 5
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface PendingCode {
  code: string
  issuedAt: number
  attempts: number
}

interface TokenRecord {
  email: string
  expiresAt: number
}

export type RequestResult = 'sent' | 'not-allowed' | 'too-soon'
export type VerifyResult = { ok: true; token: string } | { ok: false; reason: 'no-code' | 'expired' | 'wrong' | 'locked' }

/** 메일 인증 코드와 로그인 토큰. 토큰은 파일에 저장해 서버 재시작에도 유지한다 */
export class AuthStore {
  private codes = new Map<string, PendingCode>()
  private tokens = new Map<string, TokenRecord>()

  constructor(
    private readonly allowedEmails: string[],
    private readonly tokenPath: string | null,
    private readonly now: () => number = Date.now,
  ) {
    this.loadTokens()
  }

  requestCode(emailRaw: string): { result: RequestResult; code?: string } {
    const email = emailRaw.trim().toLowerCase()
    if (!this.allowedEmails.includes(email)) return { result: 'not-allowed' }
    const pending = this.codes.get(email)
    if (pending && this.now() - pending.issuedAt < CODE_RESEND_MS) return { result: 'too-soon' }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.codes.set(email, { code, issuedAt: this.now(), attempts: 0 })
    return { result: 'sent', code }
  }

  verifyCode(emailRaw: string, code: string): VerifyResult {
    const email = emailRaw.trim().toLowerCase()
    const pending = this.codes.get(email)
    if (!pending) return { ok: false, reason: 'no-code' }
    if (this.now() - pending.issuedAt > CODE_TTL_MS) {
      this.codes.delete(email)
      return { ok: false, reason: 'expired' }
    }
    if (pending.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: 'locked' }
    pending.attempts += 1
    if (pending.code !== code.trim()) return { ok: false, reason: 'wrong' }
    this.codes.delete(email)
    const token = randomBytes(32).toString('hex')
    this.tokens.set(token, { email, expiresAt: this.now() + TOKEN_TTL_MS })
    this.saveTokens()
    return { ok: true, token }
  }

  emailOf(token: string | undefined): string | null {
    if (!token) return null
    const record = this.tokens.get(token)
    if (!record) return null
    if (record.expiresAt < this.now()) {
      this.tokens.delete(token)
      this.saveTokens()
      return null
    }
    return record.email
  }

  revoke(token: string | undefined): void {
    if (token && this.tokens.delete(token)) this.saveTokens()
  }

  private loadTokens(): void {
    if (!this.tokenPath) return
    try {
      const parsed = JSON.parse(readFileSync(this.tokenPath, 'utf8')) as Record<string, TokenRecord>
      for (const [token, record] of Object.entries(parsed)) {
        if (record.expiresAt > this.now()) this.tokens.set(token, record)
      }
    } catch {
      // 파일 없음
    }
  }

  private saveTokens(): void {
    if (!this.tokenPath) return
    mkdirSync(dirname(this.tokenPath), { recursive: true })
    writeFileSync(this.tokenPath, JSON.stringify(Object.fromEntries(this.tokens), null, 2) + '\n')
  }
}

export const TOKEN_TTL_SECONDS = TOKEN_TTL_MS / 1000

export function isLoopback(remoteAddress: string | undefined): boolean {
  return remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}
