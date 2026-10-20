import nodemailer from 'nodemailer'
import type { SmtpConfig } from './config.js'

export type SendCode = (email: string, code: string) => Promise<void>

export function makeSendCode(smtp: SmtpConfig | null): SendCode | null {
  if (!smtp) return null
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  })
  return async (email, code) => {
    await transport.sendMail({
      from: `"jk-corp" <${smtp.user}>`,
      to: email,
      subject: `[jk-corp] 로그인 인증번호 ${code}`,
      text: `인증번호: ${code}\n\n10분 안에 입력하세요. 요청한 적이 없다면 무시하세요.`,
    })
  }
}
