import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { Terminal } from './Terminal'
import { Chat } from './Chat'
import { Office } from './Office'
import { UsagePanel } from './UsagePanel'
import { Modal, Segmented } from './Modal'
import { statusLabel, type Office as OfficeData, type Group, type Session, type Team } from './types'
import { avatarOf, cssColor } from './avatar'

interface Snapshot {
  isHostReachable: boolean
  sessions: Session[]
}

const EMPTY_OFFICE: OfficeData = { groups: [], teams: [] }


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
  const [isGroupForm, setIsGroupForm] = useState(false)
  /** 팀 추가 모달. 그룹 헤더의 "+ 팀" 으로 열리며 그 그룹에 고정 */
  const [teamForm, setTeamForm] = useState<{ groupId: string } | null>(null)
  /** 세션 추가 모달. 팀 헤더의 "+ 세션" 이면 그 팀에 고정, 툴바의 "+ 세션" 이면 로비(폴더 직접 입력) */
  const [sessionForm, setSessionForm] = useState<{ teamId: string | null } | null>(null)
  const [sessionRole, setSessionRole] = useState<'member' | 'lead'>('member')
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
    if (!sessionForm) return
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/sessions', 'POST', {
      cwd: sessionForm.teamId ? undefined : form.get('cwd'),
      teamId: sessionForm.teamId ?? undefined,
      prompt: form.get('prompt'),
      isLead: Boolean(sessionForm.teamId) && sessionRole === 'lead',
    })
    if (!response.ok) {
      alert((await response.json()).message ?? '생성 실패')
      return
    }
    const { sessionId } = await response.json()
    setSelectedId(sessionId)
    setTab('terminal')
    setSessionForm(null)
  }

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!teamForm) return
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/team', 'POST', { name: form.get('name'), cwd: form.get('cwd'), groupId: teamForm.groupId })
    if (!response.ok) {
      alert((await response.json()).message ?? '팀 생성 실패')
      return
    }
    setTeamForm(null)
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const response = await postJson('/api/groups', 'POST', { name: form.get('name') })
    if (!response.ok) {
      alert((await response.json()).message ?? '그룹 생성 실패')
      return
    }
    setIsGroupForm(false)
  }

  function openTeamForm(groupId: string) {
    setSessionForm(null)
    setTeamForm({ groupId })
  }

  function openSessionForm(teamId: string | null) {
    setTeamForm(null)
    setSessionRole('member')
    setSessionForm({ teamId })
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

  async function removeGroup(group: Group) {
    if (!confirm(`"${group.name}" 그룹을 지울까요?`)) return
    const response = await fetch(`/api/groups/${group.id}`, { method: 'DELETE' })
    if (!response.ok) alert((await response.json()).message ?? '삭제 실패')
  }

  function editGroup(group: Group) {
    const waitingNote = prompt(`"${group.name}" 대기 메모 (비우면 삭제)`, group.waitingNote ?? '')
    if (waitingNote === null) return
    void postJson(`/api/groups/${group.id}`, 'PATCH', { waitingNote })
  }

  function updateGroupBounds(groupId: string, bounds: Pick<Group, 'x' | 'y' | 'w' | 'h'>) {
    setOffice((prev) => ({ ...prev, groups: prev.groups.map((r) => (r.id === groupId ? { ...r, ...bounds } : r)) }))
    void postJson(`/api/groups/${groupId}`, 'PATCH', bounds)
  }

  function patchTeam(teamId: string, patch: Partial<Team>) {
    setOffice((prev) => ({ ...prev, teams: prev.teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)) }))
  }

  function moveDesk(teamId: string, sessionId: string, desk: { dx: number; dy: number }) {
    const team = office.teams.find((t) => t.id === teamId)
    if (team) patchTeam(teamId, { desks: { ...team.desks, [sessionId]: desk } })
    void postJson(`/api/team/${teamId}/desks/${sessionId}`, 'PUT', desk)
  }

  function moveTeam(teamId: string, anchor: { groupId: string; x: number; y: number }) {
    patchTeam(teamId, anchor)
    void postJson(`/api/team/${teamId}`, 'PATCH', anchor)
  }

  function editTeam(team: Team) {
    const name = prompt(`팀 이름 (폴더: ${team.cwd})`, team.name)
    if (name?.trim()) void postJson(`/api/team/${team.id}`, 'PATCH', { name: name.trim() })
  }

  function renderSessionModal(teamId: string | null) {
    const team = teamId ? office.teams.find((t) => t.id === teamId) : undefined
    const hasLiveLead = Boolean(team?.leadSessionId && snapshot.sessions.some((s) => s.id === team.leadSessionId && s.isAlive))
    return (
      <Modal
        title={team ? `세션 추가 — 팀 「${team.name}」` : '세션 추가 — 로비 (팀 없음)'}
        subtitle={team?.cwd}
        onClose={() => setSessionForm(null)}
      >
        <form className="create" onSubmit={createSession}>
          {team && (
            <Segmented
              value={sessionRole}
              onChange={setSessionRole}
              options={[
                { value: 'member', label: '팀원', hint: '팀장의 지시를 받아 일한다' },
                {
                  value: 'lead',
                  label: '팀장',
                  isDisabled: hasLiveLead,
                  hint: hasLiveLead ? '이 팀에는 이미 팀장이 있음' : '팀원을 만들어 일을 나눠 준다 (MCP 도구 장착)',
                },
              ]}
            />
          )}
          {!team && <input name="cwd" placeholder="폴더 경로 (예: D:\workspace\foo)" required autoFocus />}
          <input name="prompt" placeholder="첫 지시 (선택)" autoFocus={Boolean(team)} />
          <div className="actions">
            <button type="submit" className="primary">
              시작
            </button>
            <button type="button" onClick={() => setSessionForm(null)}>
              취소
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  /** 팀 헤더 + 소속 세션. 그룹 안에 중첩된다 */
  function renderTeam(team: Team) {
    const members = snapshot.sessions.filter((s) => s.teamId === team.id)
    return [
      <li key={team.id} className="group level-team" title={team.cwd}>
        {team.name} {members.length > 0 && <span className="count">{members.length}</span>}
        <span className="group-actions">
          <button onClick={() => openSessionForm(team.id)} disabled={!snapshot.isHostReachable} title="이 팀에 세션 추가">
            + 세션
          </button>
          {team.leadSessionId && (
            <button onClick={() => releaseLead(team)} title="팀장 지정 해제">
              팀장 해제
            </button>
          )}
          <button onClick={() => removeTeam(team)} title="팀 삭제 (세션은 유지)">
            삭제
          </button>
        </span>
      </li>,
      ...members.map((session) => renderSession(session, true)),
      ...(members.length === 0 ? [<li key={`${team.id}-empty`} className="empty nested">세션 없음</li>] : []),
    ]
  }

  function renderSession(session: Session, isNested = false) {
    const avatar = avatarOf(session.id)
    return (
      <li
        key={session.id}
        className={[session.id === selectedId ? 'selected' : '', session.isAlive ? '' : 'dead', isNested ? 'nested' : ''].join(' ')}
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
          <button onClick={() => setIsGroupForm(true)}>+ 그룹</button>
          <button onClick={() => openSessionForm(null)} disabled={!snapshot.isHostReachable}>
            + 세션 (로비)
          </button>
        </div>
        <ul className="sessions">
          {office.groups.map((group) => {
            const teams = office.teams.filter((t) => t.groupId === group.id)
            return [
              <li key={group.id} className="group level-group">
                {group.name} {teams.length > 0 && <span className="count">{teams.length}</span>}
                <span className="group-actions">
                  <button onClick={() => openTeamForm(group.id)} title="이 그룹에 팀 추가">
                    + 팀
                  </button>
                  {teams.length === 0 && (
                    <button onClick={() => removeGroup(group)} title="그룹 삭제">
                      삭제
                    </button>
                  )}
                </span>
              </li>,
              ...teams.flatMap((team) => renderTeam(team)),
              ...(teams.length === 0 ? [<li key={`${group.id}-empty`} className="empty">팀 없음</li>] : []),
            ]
          })}
          {office.teams.filter((t) => !office.groups.some((g) => g.id === t.groupId)).flatMap((team) => renderTeam(team))}
          {[{ key: 'lobby', title: '로비 (팀 없음)', members: snapshot.sessions.filter((s) => !s.teamId) }].map((bucket) => [
            <li key={bucket.key} className="group level-group">
              {bucket.title} {bucket.members.length > 0 && <span className="count">{bucket.members.length}</span>}
            </li>,
            ...bucket.members.map((session) => renderSession(session)),
            ...(bucket.members.length === 0 ? [<li key={`${bucket.key}-empty`} className="empty">없음</li>] : []),
          ])}
        </ul>
        <UsagePanel />
      </aside>
      {isGroupForm && (
        <Modal title="그룹 추가" onClose={() => setIsGroupForm(false)}>
          <form className="create" onSubmit={createGroup}>
            <input name="name" placeholder="그룹 이름" required autoFocus />
            <div className="actions">
              <button type="submit" className="primary">
                만들기
              </button>
              <button type="button" onClick={() => setIsGroupForm(false)}>
                취소
              </button>
            </div>
          </form>
        </Modal>
      )}
      {teamForm && (
        <Modal
          title={`팀 추가 — 그룹 「${office.groups.find((g) => g.id === teamForm.groupId)?.name ?? ''}」`}
          onClose={() => setTeamForm(null)}
        >
          <form className="create" onSubmit={createTeam}>
            <input name="name" placeholder="팀 이름" required autoFocus />
            <input name="cwd" placeholder="작업 폴더 (예: D:\workspace\foo). 이 폴더의 세션이 팀이 됨" required />
            <div className="actions">
              <button type="submit" className="primary">
                만들기
              </button>
              <button type="button" onClick={() => setTeamForm(null)}>
                취소
              </button>
            </div>
          </form>
        </Modal>
      )}
      {sessionForm && renderSessionModal(sessionForm.teamId)}
      <Office
        office={office}
        sessions={snapshot.sessions}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMoveDesk={moveDesk}
        onMoveTeam={moveTeam}
        onEditTeam={editTeam}
        onEditGroup={editGroup}
        onUpdateGroupBounds={updateGroupBounds}
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
