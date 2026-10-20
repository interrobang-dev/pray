import { useEffect, useState, type FormEvent } from 'react'
import { Terminal } from './Terminal'
import { Chat } from './Chat'

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

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
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
  const [snapshot, setSnapshot] = useState<Snapshot>({ isHostReachable: false, sessions: [] })
  const [isConnected, setIsConnected] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  const [transcriptVersions, setTranscriptVersions] = useState<Record<string, number>>({})

  useEffect(() => {
    const source = new EventSource('/api/events')
    source.addEventListener('sessions', (event) => {
      setSnapshot(JSON.parse((event as MessageEvent).data))
      setIsConnected(true)
    })
    source.addEventListener('transcript', (event) => {
      const { sessionId } = JSON.parse((event as MessageEvent).data) as { sessionId: string }
      setTranscriptVersions((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? 0) + 1 }))
    })
    source.onerror = () => setIsConnected(false)
    return () => source.close()
  }, [])

  const selected = snapshot.sessions.find((s) => s.id === selectedId) ?? null

  async function createSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: form.get('cwd'), prompt: form.get('prompt') }),
    })
    if (!response.ok) {
      alert((await response.json()).message ?? '생성 실패')
      return
    }
    const { sessionId } = await response.json()
    setSelectedId(sessionId)
    setTab('terminal')
    setIsCreating(false)
  }

  return (
    <main className="layout">
      <aside>
        <header>
          <h1>jk-corp</h1>
          <span className={isConnected ? 'dot on' : 'dot'} title={isConnected ? '서버 연결됨' : '서버 끊김'} />
          <span
            className={snapshot.isHostReachable ? 'dot on' : 'dot'}
            title={snapshot.isHostReachable ? '세션 호스트 연결됨' : '세션 호스트 끊김'}
          />
          <button onClick={() => setIsCreating(true)} disabled={!snapshot.isHostReachable}>
            + 새 세션
          </button>
        </header>
        {isCreating && (
          <form className="create" onSubmit={createSession}>
            <input name="cwd" placeholder="폴더 경로 (예: D:\workspace\foo)" required autoFocus />
            <input name="prompt" placeholder="첫 지시 (선택)" />
            <div>
              <button type="submit">시작</button>
              <button type="button" onClick={() => setIsCreating(false)}>
                취소
              </button>
            </div>
          </form>
        )}
        <ul className="sessions">
          {snapshot.sessions.map((session) => (
            <li
              key={session.id}
              className={[session.id === selectedId ? 'selected' : '', session.isAlive ? '' : 'dead'].join(' ')}
              onClick={() => setSelectedId(session.id)}
            >
              <div className="row">
                <span className={`badge ${session.status}`}>{statusLabel[session.status]}</span>
                {session.kind === 'web' && <span className="kind">웹</span>}
                <span className="time">{formatTime(session.lastAt)}</span>
              </div>
              <div className="title">{session.title ?? session.id.slice(0, 8)}</div>
              <div className="cwd">{session.cwd}</div>
            </li>
          ))}
          {snapshot.sessions.length === 0 && <li>세션 없음</li>}
        </ul>
      </aside>
      <section className="panel">
        {!selected && <p className="hint">세션을 선택하세요</p>}
        {selected && (
          <>
            <div className="panel-header">
              <b>{selected.title ?? selected.id.slice(0, 8)}</b>
              <span className="cwd">{selected.cwd}</span>
              <nav className="tabs">
                <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
                  대화
                </button>
                {selected.kind === 'web' && (
                  <button className={tab === 'terminal' ? 'on' : ''} onClick={() => setTab('terminal')}>
                    터미널
                  </button>
                )}
              </nav>
              {selected.kind === 'web' && (
                <button
                  onClick={() => {
                    if (confirm('세션을 종료할까요?')) void fetch(`/api/sessions/${selected.id}`, { method: 'DELETE' })
                  }}
                >
                  종료
                </button>
              )}
            </div>
            {tab === 'terminal' && selected.kind === 'web' ? (
              <Terminal sessionId={selected.id} />
            ) : (
              <Chat
                sessionId={selected.id}
                isWritable={selected.kind === 'web'}
                isApprovalNeeded={selected.status === 'needs-approval'}
                pendingTool={selected.pendingTool}
                version={transcriptVersions[selected.id] ?? 0}
              />
            )}
          </>
        )}
      </section>
    </main>
  )
}
