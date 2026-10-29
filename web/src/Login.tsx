import { useState, type FormEvent } from 'react'

interface Props {
  canLogin: boolean
  onLoggedIn: () => void
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export function Login({ canLogin, onLoggedIn }: Props) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [isCodeSent, setIsCodeSent] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function requestCode(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    const response = await postJson('/api/auth/request', { email })
    if (!response.ok) {
      setMessage((await response.json()).message ?? 'Request failed')
      return
    }
    setIsCodeSent(true)
    setMessage('If this address is allowed, a code is on its way. Enter it within 10 minutes.')
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    const response = await postJson('/api/auth/verify', { email, code })
    if (!response.ok) {
      const reason = (await response.json()).message
      setMessage(
        reason === 'wrong'
          ? 'Wrong code'
          : reason === 'expired'
            ? 'The code expired. Request a new one'
            : reason === 'locked'
              ? 'Too many attempts. Request a new code'
              : 'Request a code first',
      )
      return
    }
    onLoggedIn()
  }

  return (
    <main className="login">
      <h1>
        <img className="logo" src="/logo.svg" width={32} height={32} alt="" />
        Pray
      </h1>
      <p className="tagline">Do your best. Then pray.</p>
      {!canLogin && <p>Remote login isn't set up. Open 127.0.0.1 on this PC.</p>}
      {canLogin && !isCodeSent && (
        <form onSubmit={requestCode}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" required autoFocus />
          <button type="submit">Send code</button>
        </form>
      )}
      {canLogin && isCodeSent && (
        <form onSubmit={verify}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" inputMode="numeric" pattern="\d{6}" required autoFocus />
          <button type="submit">Verify</button>
          <button type="button" onClick={() => setIsCodeSent(false)}>
            Resend
          </button>
        </form>
      )}
      {message && <p className="message">{message}</p>}
    </main>
  )
}
