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
      setMessage((await response.json()).message ?? '요청 실패')
      return
    }
    setIsCodeSent(true)
    setMessage('허용된 주소라면 인증번호를 보냈습니다. 10분 안에 입력하세요.')
  }

  async function verify(event: FormEvent) {
    event.preventDefault()
    setMessage(null)
    const response = await postJson('/api/auth/verify', { email, code })
    if (!response.ok) {
      const reason = (await response.json()).message
      setMessage(
        reason === 'wrong' ? '인증번호가 틀립니다' : reason === 'expired' ? '만료됐습니다. 다시 요청하세요' : reason === 'locked' ? '시도 횟수 초과. 다시 요청하세요' : '인증번호를 먼저 요청하세요',
      )
      return
    }
    onLoggedIn()
  }

  return (
    <main className="login">
      <h1>jk-corp</h1>
      {!canLogin && <p>원격 로그인이 설정되지 않았습니다. 이 PC에서 127.0.0.1 로 접속하세요.</p>}
      {canLogin && !isCodeSent && (
        <form onSubmit={requestCode}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="메일 주소" required autoFocus />
          <button type="submit">인증번호 받기</button>
        </form>
      )}
      {canLogin && isCodeSent && (
        <form onSubmit={verify}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6자리 인증번호" inputMode="numeric" pattern="\d{6}" required autoFocus />
          <button type="submit">로그인</button>
          <button type="button" onClick={() => setIsCodeSent(false)}>
            다시 요청
          </button>
        </form>
      )}
      {message && <p className="message">{message}</p>}
    </main>
  )
}
