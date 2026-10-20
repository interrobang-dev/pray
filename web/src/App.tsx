import { useEffect, useState } from 'react'

type SessionStatus = 'working' | 'my-turn' | 'needs-approval' | 'idle' | 'ended' | 'unknown'

interface Session {
  id: string
  cwd: string
  title: string | null
  status: SessionStatus
  kind: 'web' | 'external'
  isAlive: boolean
  lastAt: string | null
  lastAssistantText: string | null
  pendingTool: string | null
}

const statusLabel: Record<SessionStatus, string> = {
  working: '작업중',
  'my-turn': '내 차례',
  'needs-approval': '승인 필요',
  idle: '대기',
  ended: '종료',
  unknown: '알 수 없음',
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const source = new EventSource('/api/events')
    source.addEventListener('sessions', (event) => {
      setSessions(JSON.parse((event as MessageEvent).data))
      setIsConnected(true)
    })
    source.onerror = () => setIsConnected(false)
    return () => source.close()
  }, [])

  return (
    <main>
      <header>
        <h1>jk-corp</h1>
        <span className={isConnected ? 'dot on' : 'dot'} title={isConnected ? '연결됨' : '끊김'} />
      </header>
      <table>
        <thead>
          <tr>
            <th>상태</th>
            <th>제목</th>
            <th>폴더</th>
            <th>마지막 활동</th>
            <th>마지막 말</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.id} className={session.isAlive ? '' : 'dead'}>
              <td>
                <span className={`badge ${session.status}`}>{statusLabel[session.status]}</span>
                {session.pendingTool && <small> {session.pendingTool}</small>}
              </td>
              <td>{session.title ?? session.id.slice(0, 8)}</td>
              <td className="cwd">{session.cwd}</td>
              <td>{formatTime(session.lastAt)}</td>
              <td className="last">{session.lastAssistantText?.split('\n')[0] ?? ''}</td>
            </tr>
          ))}
          {sessions.length === 0 && (
            <tr>
              <td colSpan={5}>세션 없음</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  )
}
