import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AddToChatIcon } from './AddToChatIcon'
import { diffRowsOf, STATUS_LABELS, STATUS_LETTERS } from './changes'
import { appendCommits, commitChatText, commitFileNotes, historyNote, parentNote, refChips } from './commitHistory'
import { CopyButton } from './CopyButton'
import { DiffView } from './DiffView'
import { FileName } from './FileName'
import { formatAgo, formatDateTime, type CommitDetail, type HistoryCommit, type WorkspaceDiff, type WorkspaceHistory } from './types'
import { apiUrl, fetchJson } from './workspaceApi'
import { nameOf } from './workspaceTree'

/** 세션별로 기억하는 History 상태 (FilesTab 의 sessionViews 에 든다. 새로고침하면 사라진다) */
export interface HistoryState {
  /** 파일별 히스토리 (cwd 상대). null = cwd 전체 */
  filterPath: string | null
  /** 받은 목록과 그 거르기 (지금 filterPath 와 다르면 다시 받는다) */
  list: (WorkspaceHistory & { filterPath: string | null }) | null
  /** 고른 커밋 (전체 해시) — 있으면 왼쪽 칸이 그 커밋의 파일 목록 */
  selectedHash: string | null
  /** 고른 커밋에서 고른 파일 — 오른쪽에 그 diff */
  selectedFile: string | null
}

export const EMPTY_HISTORY: HistoryState = { filterPath: null, list: null, selectedHash: null, selectedFile: null }

/** 커밋 상세는 바뀌지 않아 세션·해시별로 기억한다 (최근 MAX_CACHED_DETAILS 개) */
const MAX_CACHED_DETAILS = 100
const detailCache = new Map<string, CommitDetail>()
const NO_SELECTION = () => {}

interface Props {
  sessionId: string
  state: HistoryState
  onStateChange: (update: (previous: HistoryState) => HistoryState) => void
  /** 위 막대 ↻ (바뀌면 첫 쪽부터 다시 받는다) */
  reloadId: number
  /** 지금 브랜치 (Changes 목록이 받은 것) */
  branch: string | null
  /** 입력칸이 없는 세션이면 그 이유 (Add to chat 을 막는다) */
  addToChatBlockReason: string | null
  onAddToChat: (snippet: string) => void
  /** 커밋의 파일을 골랐다 (폰은 보기 칸을 띄운다) */
  onOpenFile: (path: string) => void
}

/**
 * Files 탭 왼쪽 칸의 History (git 커밋 히스토리, `GET /api/sessions/:id/history`): 머리줄(브랜치 또는 파일 거르기 칩 · ↻), 커밋 줄(제목·칩 / 짧은 해시·작성자·시각), Load more.
 * 커밋을 누르면 같은 칸이 그 커밋의 상세(Copy hash·Add to chat·전체 메시지·바뀐 파일)로 바뀌고 ← 로 목록에 돌아온다 (목록은 숨겨 둘 뿐이라 스크롤이 남는다)
 */
export function HistoryPanel({ sessionId, state, onStateChange, reloadId, branch, addToChatBlockReason, onAddToChat, onOpenFile }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  /** 머리줄 ↻ */
  const [refreshId, setRefreshId] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const { filterPath, list, selectedHash } = state

  /** skip 부터 한 쪽 받기. skip 0 이면 목록을 바꾸고 아니면 이어 붙인다. 앞 요청은 끊는다 */
  const load = useCallback(
    (forPath: string | null, skip: number) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setIsLoading(true)
      setLoadError(null)
      const params: Record<string, string> = { skip: String(skip) }
      if (forPath) params.path = forPath
      fetchJson<WorkspaceHistory>(apiUrl(sessionId, 'history', params), controller.signal).then(
        (data) => {
          if (controllerRef.current !== controller) return
          controllerRef.current = null
          setIsLoading(false)
          onStateChange((previous) =>
            previous.filterPath !== forPath
              ? previous
              : { ...previous, list: { ...data, filterPath: forPath, commits: skip === 0 ? data.commits : appendCommits(previous.list?.commits ?? [], data.commits) } },
          )
        },
        (error: Error) => {
          // 새 요청이 끊은 것이면 그쪽이 이어 간다. 그 밖(언마운트·바깥에서 끊김)은 "Loading…" 에 멈추지 않게 오류로 보인다
          if (controllerRef.current !== controller) return
          controllerRef.current = null
          setIsLoading(false)
          setLoadError(error.name === 'AbortError' ? 'Request was cancelled' : error.message)
        },
      )
    },
    [sessionId, onStateChange],
  )
  useEffect(() => () => controllerRef.current?.abort(), [])

  // 처음·거르기가 바뀌면 받는다. 받은 목록은 다시 열어도 그대로 둔다 (Load more 로 늘린 쪽이 남게. 새 커밋은 ↻)
  const isStale = list === null || list.filterPath !== filterPath
  useEffect(() => {
    if (isStale) load(filterPath, 0)
  }, [isStale, filterPath, load])
  // ↻ (위 막대·머리줄): 첫 쪽부터
  const reloadKey = `${reloadId}:${refreshId}`
  const reloadKeyRef = useRef(reloadKey)
  useEffect(() => {
    if (reloadKeyRef.current === reloadKey) return
    reloadKeyRef.current = reloadKey
    load(filterPath, 0)
  }, [reloadKey, filterPath, load])

  const shown = list && !isStale ? list : null
  const note = shown ? historyNote(shown, filterPath !== null) : null
  const selectedCommit = shown?.commits.find((commit) => commit.hash === selectedHash) ?? null

  return (
    <div className="ws-changes ws-history">
      <div className="ws-changes-head">
        {filterPath ? (
          <span className="ws-history-filter" title={`Commits that changed ${filterPath}`}>
            <span className="ws-history-filter-name">{nameOf(filterPath)}</span>
            <button
              type="button"
              className="ws-history-clear"
              onClick={() => onStateChange((previous) => ({ ...previous, filterPath: null, selectedHash: null, selectedFile: null }))}
              title="Show all commits"
              aria-label="Show all commits"
            >
              ×
            </button>
          </span>
        ) : (
          <span className="ws-vcs" title={branch ? `Branch ${branch}` : undefined}>
            {shown?.kind === 'git' ? 'git' : ''}
            {shown?.kind === 'git' && branch && <span className="ws-branch"> · {branch}</span>}
          </span>
        )}
        <button type="button" className="ws-changes-reload" onClick={() => setRefreshId((id) => id + 1)} title="Refresh history" aria-label="Refresh history">
          ↻
        </button>
      </div>
      {selectedHash && (
        <CommitPane
          sessionId={sessionId}
          hash={selectedHash}
          listed={selectedCommit}
          selectedFile={state.selectedFile}
          addToChatBlockReason={addToChatBlockReason}
          onAddToChat={onAddToChat}
          onOpenFile={onOpenFile}
          onBack={() => onStateChange((previous) => ({ ...previous, selectedHash: null, selectedFile: null }))}
        />
      )}
      {/* 상세를 보는 동안 숨겨만 둔다 (돌아오면 스크롤 자리가 그대로) */}
      <div className="ws-change-list" role="listbox" aria-label="Commits" hidden={selectedHash !== null}>
        {shown?.commits.map((commit) => (
          <CommitRow key={commit.hash} commit={commit} onOpen={() => onStateChange((previous) => ({ ...previous, selectedHash: commit.hash, selectedFile: null }))} />
        ))}
        {!shown && !loadError && <div className="ws-note">Loading…</div>}
        {loadError && <div className="ws-note error">Couldn't load history: {loadError}</div>}
        {note && <div className={`ws-note${note.isError ? ' error' : ''}`}>{note.text}</div>}
        {shown?.hasMore && (
          <button type="button" className="ws-load-more" disabled={isLoading} onClick={() => load(filterPath, shown.commits.length)}>
            {isLoading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  )
}

/** 커밋 한 줄: 제목 / 짧은 해시 · 시각 · 작성자 / (있으면) 브랜치·태그 칩 — 160px 칸에서 칩이 제목을 밀어내지 않게 칩은 셋째 줄 */
function CommitRow({ commit, onOpen }: { commit: HistoryCommit; onOpen: () => void }) {
  const chips = refChips(commit)
  const title = [`${commit.shortHash} ${commit.subject}`, `${commit.authorName} · ${formatDateTime(commit.authorDate)}`, ...(commit.refs.length > 0 ? [commit.refs.join(', ')] : [])].join('\n')
  return (
    <button type="button" role="option" aria-selected={false} className="ws-commit" title={title} onClick={onOpen}>
      <span className="ws-commit-subject">{commit.subject || <span className="ws-commit-empty">(no message)</span>}</span>
      <span className="ws-commit-meta">
        <code>{commit.shortHash}</code> · {formatAgo(commit.authorDate, Date.now())} · {commit.authorName}
      </span>
      {chips.length > 0 && (
        <span className="ws-commit-refs">
          {chips.map((chip) => (
            <span key={chip.text + chip.isTag} className={`ws-ref${chip.isTag ? ' is-tag' : ''}${chip.isCurrent ? ' is-current' : ''}`}>
              {chip.text}
            </span>
          ))}
        </span>
      )}
    </button>
  )
}

type DetailState = { hash: string } & ({ status: 'error'; message: string } | { status: 'ok'; detail: CommitDetail })

/** 고른 커밋의 상세: ← · 짧은 해시 · Copy hash · Add to chat / 제목 · 본문 · 작성자 · 시각 · 부모 안내 / 바뀐 파일 줄 */
function CommitPane({
  sessionId,
  hash,
  listed,
  selectedFile,
  addToChatBlockReason,
  onAddToChat,
  onOpenFile,
  onBack,
}: {
  sessionId: string
  hash: string
  /** 목록에서 받은 그 커밋 (상세가 오기 전에 제목·작성자를 먼저 보인다) */
  listed: HistoryCommit | null
  selectedFile: string | null
  addToChatBlockReason: string | null
  onAddToChat: (snippet: string) => void
  onOpenFile: (path: string) => void
  onBack: () => void
}) {
  const cacheKey = `${sessionId}|${hash}`
  const [state, setState] = useState<DetailState | null>(() => {
    const cached = detailCache.get(cacheKey)
    return cached ? { hash, status: 'ok', detail: cached } : null
  })
  useEffect(() => {
    const cached = detailCache.get(cacheKey)
    if (cached) {
      setState({ hash, status: 'ok', detail: cached })
      return
    }
    const controller = new AbortController()
    fetchJson<CommitDetail>(apiUrl(sessionId, `history/${hash}`, {}), controller.signal).then(
      (detail) => {
        detailCache.set(cacheKey, detail)
        while (detailCache.size > MAX_CACHED_DETAILS) detailCache.delete(detailCache.keys().next().value as string)
        setState({ hash, status: 'ok', detail })
      },
      (error: Error) => error.name !== 'AbortError' && setState({ hash, status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [sessionId, hash, cacheKey])
  const shown = state && state.hash === hash ? state : null
  const detail = shown?.status === 'ok' ? shown.detail : null
  const info = detail ?? listed
  const shortHash = info?.shortHash ?? hash.slice(0, 7)
  const snippet = commitChatText({ shortHash, subject: info?.subject ?? '' })
  const parent = detail ? parentNote(detail) : null

  return (
    <div className="ws-commit-pane">
      <div className="ws-commit-bar">
        <button type="button" className="ws-commit-back" onClick={onBack} title="Back to commits" aria-label="Back to commits">
          ←
        </button>
        <code className="ws-commit-hash" title={hash}>
          {shortHash}
        </code>
        <CopyButton text={hash} label="Copy hash" />
        <button
          type="button"
          className="ws-commit-add"
          disabled={addToChatBlockReason !== null}
          onClick={() => onAddToChat(snippet)}
          title={addToChatBlockReason ? `Can't add to chat: ${addToChatBlockReason}` : `Add to chat: ${snippet}`}
          aria-label="Add to chat"
        >
          <AddToChatIcon />
        </button>
      </div>
      <div className="ws-commit-scroll">
        {info && (
          <div className="ws-commit-message">
            <p className="ws-commit-title">{info.subject || <span className="ws-commit-empty">(no message)</span>}</p>
            {detail?.body && <p className="ws-commit-body">{detail.body}</p>}
            <p className="ws-commit-info">
              <span title={detail?.authorEmail || undefined}>{info.authorName}</span> · <span title={formatDateTime(info.authorDate)}>{formatAgo(info.authorDate, Date.now())}</span>
            </p>
            {parent && <p className="ws-commit-info">{parent}</p>}
          </div>
        )}
        <div role="listbox" aria-label="Changed files">
          {detail?.files.map((file) => {
            const slash = file.path.lastIndexOf('/')
            return (
              <button
                key={file.path}
                type="button"
                role="option"
                aria-selected={file.path === selectedFile}
                className={`ws-change${file.path === selectedFile ? ' selected' : ''}`}
                title={`${STATUS_LABELS[file.status]}: ${file.path}${file.oldPath ? ` (from ${file.oldPath})` : ''}`}
                onClick={() => onOpenFile(file.path)}
              >
                <span className={`ws-change-letter ${file.status}`} aria-label={STATUS_LABELS[file.status]}>
                  {STATUS_LETTERS[file.status]}
                </span>
                <FileName name={file.path.slice(slash + 1)} className={`ws-change-name${file.status === 'deleted' ? ' is-gone' : ''}`} />
                {slash > 0 && <span className="ws-change-dir">{file.path.slice(0, slash)}</span>}
              </button>
            )
          })}
          {!shown && <div className="ws-note">Loading…</div>}
          {shown?.status === 'error' && <div className="ws-note error">Couldn't load the commit: {shown.message}</div>}
          {detail && commitFileNotes(detail).map((text) => <div key={text} className="ws-note">{text}</div>)}
        </div>
      </div>
    </div>
  )
}

type CommitDiffState = { key: string } & ({ status: 'error'; message: string } | { status: 'ok'; diff: WorkspaceDiff })

/**
 * History 의 오른쪽: 고른 커밋의 그 파일 diff (`history/:hash/diff?path=`). 줄 고르기·Open in Files 는 끈다 —
 * 지난 커밋의 줄 번호는 지금 파일과 달라 위치로 공유하면 claude 가 엉뚱한 줄을 본다
 */
export function CommitDiffView({ sessionId, hash, path, reloadId }: { sessionId: string; hash: string | null; path: string | null; reloadId: number }) {
  const [state, setState] = useState<CommitDiffState | null>(null)
  const key = hash && path ? `${hash}:${path}` : null
  useEffect(() => {
    if (!hash || !path || !key) return
    const controller = new AbortController()
    fetchJson<WorkspaceDiff>(apiUrl(sessionId, `history/${hash}/diff`, { path }), controller.signal).then(
      (diff) => setState({ key, status: 'ok', diff }),
      (error: Error) => error.name !== 'AbortError' && setState({ key, status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [sessionId, hash, path, key, reloadId])
  const shown = state && state.key === key ? state : null
  const rows = useMemo(() => (shown?.status === 'ok' ? diffRowsOf(shown.diff.hunks) : []), [shown])
  if (!hash) return <p className="hint">Select a commit to see its changes</p>
  if (!path) return <p className="hint">Select a file to see its diff</p>
  if (!shown) return <p className="hint">Loading…</p>
  if (shown.status === 'error') return <p className="hint ws-error">Couldn't load the diff: {shown.message}</p>
  return <DiffView key={key} diff={shown.diff} rows={rows} selection={null} onSelectionChange={NO_SELECTION} isSelectable={false} />
}
