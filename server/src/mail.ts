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
      from: `"Pray" <${smtp.user}>`,
      to: email,
      subject: `[Pray] Login code ${code}`,
      text: `Your login code: ${code}\n\nEnter it within 10 minutes. If you didn't request it, ignore this email.`,
    })
  }
}
