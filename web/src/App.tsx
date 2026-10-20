import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Terminal } from './Terminal'
import { Chat } from './Chat'
import { Office } from './Office'
import { UsagePanel } from './UsagePanel'
import { statusLabel, type Office as OfficeData, type Room, type Seat, type Session } from './types'
import { avatarOf, cssColor } from './avatar'

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
}

const EMPTY_OFFICE: OfficeData = { rooms: [{ id: 'lobby', name: '로비', x: 0, y: 0, w: 16, h: 10 }], seats: {} }

const GROUPS: { kind: Session['kind']; title: string }[] = [
  { kind: 'web', title: '직원 (웹 세션)' },
  { kind: 'external', title: '파견 (터미널·IDE)' },
]

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

async function postJson(url: string, method: string, body: unknown): Promise<Response> {
  return fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ isHostReachable: false, sessions: [] })
  const [office, setOffice] = useState<OfficeData>(EMPTY_OFFICE)
  const [isConnected, setIsConnected] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isLeadForm, setIsLeadForm] = useState(false)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')
  const [transcriptVersions, setTranscriptVersions] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch('/api/office')
      .then((r) => r.json())
      .then(setOffice)
    const source = new EventSource('/api/events')
    source.addEventListener('sessions', (event) => {
      setSnapshot(JSON.parse((event as MessageEvent).data))
      setIsConnected(true)
    })
    source.addEventListener('office', (event) => setOffice(JSON.parse((event as MessageEvent).data)))
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
    const response = await postJson('/api/sessions', 'POST', {
      cwd: form.get('cwd'),
      prompt: form.get('prompt'),
      teamName: form.get('isLead') ? form.get('teamName') : undefined,
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

  function addRoom() {
    const name = prompt('방(업무) 이름')
    if (name?.trim()) void postJson('/api/rooms', 'POST', { name })
  }

  function editRoom(room: Room) {
    const waitingNote = prompt(`"${room.name}" 대기 메모 (비우면 삭제)`, room.waitingNote ?? '')
    if (waitingNote === null) return
    void postJson(`/api/rooms/${room.id}`, 'PATCH', { waitingNote })
  }

  function updateRoomBounds(roomId: string, bounds: Pick<Room, 'x' | 'y' | 'w' | 'h'>) {
    setOffice((prev) => ({ ...prev, rooms: prev.rooms.map((r) => (r.id === roomId ? { ...r, ...bounds } : r)) }))
    void postJson(`/api/rooms/${roomId}`, 'PATCH', bounds)
  }

  function moveSeat(sessionId: string, seat: Seat) {
    setOffice((prev) => ({ ...prev, seats: { ...prev.seats, [sessionId]: seat } }))
    void postJson(`/api/seats/${sessionId}`, 'PUT', seat)
  }

  function renderSession(session: Session) {
    const avatar = avatarOf(session.id)
    return (
      <li
        key={session.id}
        className={[session.id === selectedId ? 'selected' : '', session.isAlive ? '' : 'dead'].join(' ')}
        onClick={() => setSelectedId(session.id)}
      >
        <span className="avatar" style={{ '--hair': cssColor(avatar.hair), '--skin': cssColor(avatar.skin) } as CSSProperties} />
        <div className="row">
          <span className={`badge ${session.status}`}>{statusLabel[session.status]}</span>
          {session.role && <span className={`badge role-${session.role}`}>{session.role === 'lead' ? '팀장' : '팀원'}</span>}
          <span className="time">{formatTime(session.lastAt)}</span>
        </div>
        <div className="title">{session.title ?? session.id.slice(0, 8)}</div>
        <div className="cwd">{session.cwd}</div>
      </li>
    )
  }

  return (
    <main className={selected ? 'layout with-panel' : 'layout'}>
      <aside>
        <header>
          <h1>jk-corp</h1>
          <span className={isConnected ? 'dot on' : 'dot'} title={isConnected ? '서버 연결됨' : '서버 끊김'} />
          <span
            className={snapshot.isHostReachable ? 'dot on' : 'dot'}
            title={snapshot.isHostReachable ? '세션 호스트 연결됨' : '세션 호스트 끊김'}
          />
        </header>
        <div className="toolbar">
          <button onClick={() => setIsCreating(true)} disabled={!snapshot.isHostReachable}>
            + 새 세션
          </button>
          <button onClick={addRoom}>+ 방</button>
        </div>
        {isCreating && (
          <form className="create" onSubmit={createSession}>
            <input name="cwd" placeholder="폴더 경로 (예: D:\workspace\foo)" required autoFocus />
            <input name="prompt" placeholder="첫 지시 (선택)" />
            <label className="check">
              <input type="checkbox" name="isLead" checked={isLeadForm} onChange={(e) => setIsLeadForm(e.target.checked)} />
              팀장으로 (팀원을 만들어 일을 나눠 줄 수 있음)
            </label>
            {isLeadForm && <input name="teamName" placeholder="팀 이름" required />}
            <div>
              <button type="submit">시작</button>
              <button type="button" onClick={() => setIsCreating(false)}>
                취소
              </button>
            </div>
          </form>
        )}
        <ul className="sessions">
          {GROUPS.map((group) => {
            const members = snapshot.sessions.filter((s) => s.kind === group.kind)
            return [
              <li key={group.kind} className="group">
                {group.title} {members.length > 0 && <span className="count">{members.length}</span>}
              </li>,
              ...members.map(renderSession),
              ...(members.length === 0 ? [<li key={`${group.kind}-empty`} className="empty">없음</li>] : []),
            ]
          })}
        </ul>
        <UsagePanel />
      </aside>
      <Office
        office={office}
        sessions={snapshot.sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMoveSeat={moveSeat}
        onEditRoom={editRoom}
        onUpdateRoomBounds={updateRoomBounds}
      />
      {selected && (
        <section className="panel">
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
            <button onClick={() => setSelectedId(null)} title="닫기">
              ×
            </button>
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
        </section>
      )}
    </main>
  )
}
