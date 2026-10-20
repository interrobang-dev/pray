import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Terminal } from './Terminal'
import { Chat } from './Chat'
import { Office } from './Office'
import { UsagePanel } from './UsagePanel'
import { statusLabel, type Office as OfficeData, type Room, type Session, type Team } from './types'
import { avatarOf, cssColor } from './avatar'

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
}

const EMPTY_OFFICE: OfficeData = { rooms: [{ id: 'lobby', name: '로비', x: 0, y: 0, w: 16, h: 10 }], teams: [] }


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
  const [isCreatingTeam, setIsCreatingTeam] = useState(false)
  /** 새 세션 폼에서 고른 팀. '' 이면 폴더 직접 입력 */
  const [formTeamId, setFormTeamId] = useState('')
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
      cwd: formTeamId ? undefined : form.get('cwd'),
      teamId: formTeamId || undefined,
      prompt: form.get('prompt'),
      isLead: Boolean(formTeamId && form.get('isLead')),
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

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/team', 'POST', { name: form.get('name'), cwd: form.get('cwd'), roomId: form.get('roomId') })
    if (!response.ok) {
      alert((await response.json()).message ?? '팀 생성 실패')
      return
    }
    setIsCreatingTeam(false)
  }

  function releaseLead(team: Team) {
    if (confirm(`"${team.name}" 팀장 지정을 해제할까요? (세션은 그대로 남고 팀원이 됩니다)`)) {
      void postJson(`/api/team/${team.id}`, 'PATCH', { leadSessionId: null })
    }
  }

  function removeTeam(team: Team) {
    if (confirm(`"${team.name}" 팀을 지울까요? 세션은 종료되지 않고 무소속이 됩니다.`)) {
      void fetch(`/api/team/${team.id}`, { method: 'DELETE' })
    }
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

  function patchTeam(teamId: string, patch: Partial<Team>) {
    setOffice((prev) => ({ ...prev, teams: prev.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)) }))
  }

  function moveDesk(teamId: string, sessionId: string, desk: { dx: number; dy: number }) {
    const team = office.teams.find((t) => t.id === teamId)
    if (team) patchTeam(teamId, { desks: { ...team.desks, [sessionId]: desk } })
    void postJson(`/api/team/${teamId}/desks/${sessionId}`, 'PUT', desk)
  }

  function moveTeam(teamId: string, anchor: { roomId: string; x: number; y: number }) {
    patchTeam(teamId, anchor)
    void postJson(`/api/team/${teamId}`, 'PATCH', anchor)
  }

  function editTeam(team: Team) {
    const name = prompt(`팀 이름 (폴더: ${team.cwd})`, team.name)
    if (name?.trim()) void postJson(`/api/team/${team.id}`, 'PATCH', { name: name.trim() })
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
          <button onClick={() => setIsCreatingTeam(true)}>+ 팀</button>
          <button onClick={addRoom}>+ 방</button>
        </div>
        {isCreatingTeam && (
          <form className="create" onSubmit={createTeam}>
            <input name="name" placeholder="팀 이름" required autoFocus />
            <input name="cwd" placeholder="작업 폴더 (예: D:\workspace\foo). 이 폴더의 세션이 팀이 됨" required />
            <select name="roomId" defaultValue={office.rooms[0]?.id}>
              {office.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  방: {room.name}
                </option>
              ))}
            </select>
            <div>
              <button type="submit">만들기</button>
              <button type="button" onClick={() => setIsCreatingTeam(false)}>
                취소
              </button>
            </div>
          </form>
        )}
        {isCreating && (
          <form className="create" onSubmit={createSession}>
            <select value={formTeamId} onChange={(e) => setFormTeamId(e.target.value)}>
              <option value="">폴더 직접 입력 (무소속)</option>
              {office.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  팀: {team.name} — {team.cwd}
                </option>
              ))}
            </select>
            {!formTeamId && <input name="cwd" placeholder="폴더 경로 (예: D:\workspace\foo)" required autoFocus />}
            <input name="prompt" placeholder="첫 지시 (선택)" />
            {formTeamId && (
              <label className="check">
                <input type="checkbox" name="isLead" />
                팀장으로 (팀원을 만들어 일을 나눠 줄 수 있음)
              </label>
            )}
            <div>
              <button type="submit">시작</button>
              <button type="button" onClick={() => setIsCreating(false)}>
                취소
              </button>
            </div>
          </form>
        )}
        <ul className="sessions">
          {[
            ...office.teams.map((team) => ({
              key: team.id,
              title: team.name,
              hint: team.cwd,
              team,
              members: snapshot.sessions.filter((s) => s.teamId === team.id),
            })),
            { key: 'free', title: '무소속 (웹)', hint: '', team: null, members: snapshot.sessions.filter((s) => !s.teamId && s.kind === 'web') },
            { key: 'external', title: '파견 (터미널·IDE)', hint: '', team: null, members: snapshot.sessions.filter((s) => !s.teamId && s.kind === 'external') },
          ].map((group) => [
            <li key={group.key} className="group" title={group.hint}>
              {group.title} {group.members.length > 0 && <span className="count">{group.members.length}</span>}
              {group.team && (
                <span className="group-actions">
                  {group.team.leadSessionId && (
                    <button onClick={() => releaseLead(group.team)} title="팀장 지정 해제">
                      팀장 해제
                    </button>
                  )}
                  <button onClick={() => removeTeam(group.team)} title="팀 삭제 (세션은 유지)">
                    삭제
                  </button>
                </span>
              )}
            </li>,
            ...group.members.map(renderSession),
            ...(group.members.length === 0 ? [<li key={`${group.key}-empty`} className="empty">없음</li>] : []),
          ])}
        </ul>
        <UsagePanel />
      </aside>
      <Office
        office={office}
        sessions={snapshot.sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMoveDesk={moveDesk}
        onMoveTeam={moveTeam}
        onEditTeam={editTeam}
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
