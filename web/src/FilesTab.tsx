import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { CodeView } from './CodeView'
import { formatSize } from './Files'
import { formatAgo, formatDateTime, type WorkspaceEntry, type WorkspaceFile, type WorkspaceFindResult, type WorkspaceFolder } from './types'
import { ancestorFolders, nameOf, treeRows, type FolderState } from './workspaceTree'

/** 서버 /file/raw 가 주는 그림 (SVG 는 글자로 본다) */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'])
const FIND_DEBOUNCE_MS = 150

function isImagePath(path: string): boolean {
  const name = nameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

const apiUrl = (sessionId: string, route: string, params: Record<string, string>) => `/api/sessions/${sessionId}/${route}?${new URLSearchParams(params)}`

/** JSON 받기. 실패는 서버 message → HTTP 코드 → "Network error" 를 담은 Error */
async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', signal })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
    throw new Error('Network error')
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null
    throw new Error(typeof body?.message === 'string' ? body.message : `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

/** 받은 파일. path 가 지금 고른 파일과 다르면 받는 중으로 본다 (고른 직후 한 번 그릴 때 앞 파일 내용이 보이지 않게) */
type FileState = { path: string } & ({ status: 'error'; message: string } | { status: 'ok'; file: WorkspaceFile })

/** 세션별로 기억하는 Files 탭 상태 (이 화면의 메모리. 탭·세션을 바꿔 다시 열어도 펼침·고른 파일이 남고, 새로고침하면 사라진다) */
interface SessionView {
  folders: Record<string, FolderState>
  expanded: Set<string>
  selectedPath: string | null
}
const sessionViews = new Map<string, SessionView>()

/**
 * 세션 패널의 Files 탭: 세션 cwd 를 IDE 처럼 본다 (읽기 전용). 위 막대(빠른 찾기·경로·↻), 왼쪽 트리(폴더를 펼칠 때 받는다), 오른쪽 파일 보기.
 * 폰은 트리 → 파일을 누르면 보기 → ← 로 트리. 세션마다 App 이 key 로 새로 만든다
 */
export function FilesTab({ sessionId, cwd }: { sessionId: string; cwd: string }) {
  const saved = sessionViews.get(sessionId)
  const [folders, setFolders] = useState<Record<string, FolderState>>(saved?.folders ?? {})
  const [expanded, setExpanded] = useState<Set<string>>(saved?.expanded ?? new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(saved?.selectedPath ?? null)
  const [fileState, setFileState] = useState<FileState | null>(null)
  /** 폰에서 파일 보기를 띄웠는지 (데스크톱은 늘 둘 다 보인다) */
  const [isViewing, setIsViewing] = useState(false)
  const [reloadId, setReloadId] = useState(0)
  const [findFocusId, setFindFocusId] = useState(0)
  /** 찾기로 연 파일: 트리에 그 줄이 그려지면 보이게 스크롤한다 */
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const expandedRef = useRef(expanded)
  expandedRef.current = expanded
  const rootName = nameOf(cwd.replace(/[\\/]+$/, '').replace(/\\/g, '/')) || cwd

  useEffect(() => {
    sessionViews.set(sessionId, { folders, expanded, selectedPath })
  }, [sessionId, folders, expanded, selectedPath])

  const loadFolder = useCallback(
    async (path: string) => {
      // 다시 받을 때는 받은 목록을 둔 채 바꿔 끼운다 (트리가 깜박이지 않게)
      setFolders((prev) => (prev[path]?.status === 'ok' ? prev : { ...prev, [path]: { status: 'loading' } }))
      try {
        const listing = await fetchJson<WorkspaceFolder>(apiUrl(sessionId, 'tree', { path }))
        setFolders((prev) => ({ ...prev, [path]: { status: 'ok', listing } }))
      } catch (error) {
        setFolders((prev) => ({ ...prev, [path]: { status: 'error', message: (error as Error).message } }))
      }
    },
    [sessionId],
  )

  // 열 때·↻: 기준 폴더와 펼친 폴더를 다시 받는다
  useEffect(() => {
    for (const path of ['', ...expandedRef.current]) void loadFolder(path)
  }, [loadFolder, reloadId])

  // 고른 파일 받기 (그림은 img 가 직접 받는다). ↻ 로 같은 파일을 다시 받는 동안은 앞 내용을 둔다
  useEffect(() => {
    if (!selectedPath || isImagePath(selectedPath)) return
    const controller = new AbortController()
    fetchJson<WorkspaceFile>(apiUrl(sessionId, 'file', { path: selectedPath }), controller.signal).then(
      (file) => setFileState({ path: selectedPath, status: 'ok', file }),
      (error: Error) => error.name !== 'AbortError' && setFileState({ path: selectedPath, status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [sessionId, selectedPath, reloadId])
  const shownFile = fileState && fileState.path === selectedPath ? fileState : null

  // Ctrl+P (맥 Meta+P): Files 탭이 열려 있고 모달이 없을 때만 브라우저 인쇄 대신 빠른 찾기. 한글 자판에서도 되게 code 로도 본다
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const isPKey = event.code === 'KeyP' || event.key.toLowerCase() === 'p'
      if (!isPKey || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || document.querySelector('.modal-overlay')) return
      event.preventDefault()
      setFindFocusId((id) => id + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const rows = useMemo(() => treeRows(folders, expanded), [folders, expanded])

  useEffect(() => {
    if (!revealPath) return
    const tree = treeRef.current
    const row = tree?.querySelector<HTMLElement>(`[data-path="${CSS.escape(revealPath)}"]`)
    if (!tree || !row) return
    // scrollIntoView 는 overflow hidden 인 조상(패널)까지 움직여서 트리만 스크롤한다
    if (row.offsetTop < tree.scrollTop || row.offsetTop + row.offsetHeight > tree.scrollTop + tree.clientHeight) {
      tree.scrollTop = row.offsetTop - tree.clientHeight / 2
    }
    setRevealPath(null)
  }, [rows, revealPath])

  function toggleFolder(path: string) {
    const next = new Set(expanded)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
      if (folders[path]?.status !== 'ok') void loadFolder(path)
    }
    setExpanded(next)
  }

  function openFile(path: string) {
    setSelectedPath(path)
    setIsViewing(true)
  }

  /** 빠른 찾기로 고른 파일: 조상 폴더를 펼치고(안 받은 것은 받고) 고른 뒤 트리에서 보이게 한다 */
  function revealFile(path: string) {
    const next = new Set(expanded)
    for (const folder of ancestorFolders(path)) {
      next.add(folder)
      if (folders[folder]?.status !== 'ok') void loadFolder(folder)
    }
    setExpanded(next)
    openFile(path)
    setRevealPath(path)
  }

  const entry = selectedPath ? entryOf(folders, selectedPath) : null
  const meta = shownFile?.status === 'ok' ? shownFile.file : entry

  return (
    <div className={`ws${isViewing ? ' is-viewing' : ''}`}>
      <div className="ws-toolbar">
        <button type="button" className="ws-back" onClick={() => setIsViewing(false)} title="Back to files" aria-label="Back to files">
          ←
        </button>
        <QuickFind sessionId={sessionId} focusId={findFocusId} onOpen={revealFile} />
        {/* 좁으면 폴더 부분만 말줄임되고 파일 이름은 남는다 */}
        <nav className="ws-path" aria-label="Path" title={selectedPath ? [cwd.replace(/[\\/]+$/, ''), ...selectedPath.split('/')].join('\\') : cwd}>
          <span className="ws-path-dir">{[rootName, ...(selectedPath?.split('/').slice(0, -1) ?? [])].join(' / ')}</span>
          {selectedPath && (
            <>
              <span className="ws-path-sep" aria-hidden="true">
                /
              </span>
              <b>{nameOf(selectedPath)}</b>
            </>
          )}
        </nav>
        {meta && (
          <span className="ws-meta" title={formatDateTime(meta.mtime)}>
            {formatSize(meta.size)} · {formatAgo(meta.mtime, Date.now())}
            {shownFile?.status === 'ok' && shownFile.file.kind === 'text' && shownFile.file.encoding === 'euc-kr' && ' · EUC-KR'}
          </span>
        )}
        <button type="button" className="ws-reload" onClick={() => setReloadId((id) => id + 1)} title="Reload" aria-label="Reload">
          ↻
        </button>
      </div>
      <div className="ws-body">
        {/* 3단계: 이 왼쪽 칸 위에 Files·Changes 전환이 들어가고 Changes 는 변경 파일 목록을 같은 자리에 그린다 */}
        {/* aside 가 아니다: style.css 의 aside 규칙(왼쪽 목록)이 걸린다 */}
        <div className="ws-side">
          <div className="ws-tree" ref={treeRef} role="tree" aria-label="Files">
            {rows.map((row) =>
              row.kind === 'entry' ? (
                <button
                  key={row.path}
                  type="button"
                  role="treeitem"
                  aria-expanded={row.entry.kind === 'dir' ? row.isExpanded : undefined}
                  aria-selected={row.path === selectedPath}
                  data-path={row.path}
                  className={`ws-row${row.path === selectedPath ? ' selected' : ''}`}
                  style={{ '--depth': row.depth } as CSSProperties}
                  title={row.path}
                  onClick={() => (row.entry.kind === 'dir' ? toggleFolder(row.path) : openFile(row.path))}
                >
                  <span className="ws-chevron" aria-hidden="true">
                    {row.entry.kind === 'dir' ? (row.isExpanded ? '▾' : '▸') : ''}
                  </span>
                  <span className="ws-row-name">{row.entry.name}</span>
                </button>
              ) : (
                <div
                  key={row.key}
                  className={`ws-note ${row.note}`}
                  style={{ '--depth': row.depth } as CSSProperties}
                  title={row.note === 'hidden' ? 'Hidden: .git, .svn, node_modules, dist, build and similar folders, and links that point outside' : undefined}
                >
                  {row.text}
                </div>
              ),
            )}
          </div>
        </div>
        <section className="ws-view">
          <FileView sessionId={sessionId} path={selectedPath} state={shownFile} reloadId={reloadId} />
        </section>
      </div>
    </div>
  )
}

/** 트리에 받아 둔 그 파일의 목록 항목 (그림·받기 전 크기·시각용) */
function entryOf(folders: Record<string, FolderState>, path: string): WorkspaceEntry | null {
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const state = folders[parent]
  return state?.status === 'ok' ? (state.listing.entries.find((entry) => entry.name === nameOf(path)) ?? null) : null
}

/**
 * 오른쪽 파일 보기. 2단계(줄 고르기·Add to chat)는 CodeView 의 줄(data-line)에 붙고, 4단계(편집)는 글 파일일 때 CodeView 자리를 편집기로 바꾼다
 * (그때 file.hash·encoding 을 저장 요청에 쓴다)
 */
function FileView({ sessionId, path, state, reloadId }: { sessionId: string; path: string | null; state: FileState | null; reloadId: number }) {
  if (!path) return <p className="hint">Select a file to view it</p>
  if (isImagePath(path)) {
    return (
      <div className="ws-image">
        <img src={`${apiUrl(sessionId, 'file/raw', { path })}&v=${reloadId}`} alt={nameOf(path)} />
      </div>
    )
  }
  if (!state) return <p className="hint">Loading…</p>
  if (state.status === 'error') return <p className="hint ws-error">Couldn't open the file: {state.message}</p>
  const { file } = state
  if (file.kind === 'binary') return <p className="hint">Binary file · {formatSize(file.size)} · No preview</p>
  if (file.kind === 'too-large') return <p className="hint">Too large to show · {formatSize(file.size)} (limit 1 MB)</p>
  return <CodeView text={file.text} language={file.language} />
}

/**
 * 파일 이름 빠른 찾기 (`GET /api/sessions/:id/find?q=`). 입력은 150ms 모아 보내고 늦게 온 앞 응답은 버린다.
 * ↑↓ 로 고르고 Enter 로 연다. Esc 는 글이 있으면 지우고 없으면 닫는다 (이벤트를 멈춰 패널이 같이 닫히지 않게)
 */
function QuickFind({ sessionId, focusId, onOpen }: { sessionId: string; focusId: number; onOpen: (path: string) => void }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<{ query: string; data: WorkspaceFindResult | null; error: string | null } | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trimmed = query.trim()

  useEffect(() => {
    if (focusId === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
    setIsOpen(true)
  }, [focusId])

  useEffect(() => {
    if (!trimmed) {
      setResult(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetchJson<WorkspaceFindResult>(apiUrl(sessionId, 'find', { q: trimmed }), controller.signal).then(
        (data) => {
          setResult({ query: trimmed, data, error: null })
          setActiveIndex(0)
        },
        (error: Error) => error.name !== 'AbortError' && setResult({ query: trimmed, data: null, error: error.message }),
      )
    }, FIND_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [sessionId, trimmed])

  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const paths = result?.data?.paths ?? []

  function choose(path: string) {
    onOpen(path)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.blur()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      if (paths.length > 0) setActiveIndex((index) => (index + (event.key === 'ArrowDown' ? 1 : paths.length - 1)) % paths.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (paths[activeIndex]) choose(paths[activeIndex])
    } else if (event.key === 'Escape') {
      event.stopPropagation()
      if (query) setQuery('')
      else {
        setIsOpen(false)
        inputRef.current?.blur()
      }
    }
  }

  const isSearching = trimmed !== '' && result?.query !== trimmed
  const data = result?.data ?? null
  const notes = [
    result?.error ? `Search failed: ${result.error}` : null,
    isSearching && paths.length === 0 ? 'Searching…' : null,
    data && data.total === 0 ? 'No matching files' : null,
    data && data.total > paths.length ? `Showing ${paths.length} of ${data.total.toLocaleString('en')} · type more to narrow` : null,
    data?.isIndexPartial ? `Searched only the first ${data.fileCount.toLocaleString('en')} files` : null,
  ].filter((note): note is string => note !== null)
  return (
    <div className="ws-find">
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Go to file"
        title="Go to file (Ctrl+P)"
        aria-label="Go to file"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value)
          setIsOpen(true)
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={onKeyDown}
      />
      {isOpen && trimmed && (
        // mousedown 기본 동작을 막아 입력칸 blur 로 목록이 먼저 닫히지 않게
        <div className="ws-find-results" ref={listRef} role="listbox" onMouseDown={(event) => event.preventDefault()}>
          {paths.map((path, i) => {
            const slash = path.lastIndexOf('/')
            return (
              <button
                key={path}
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                className={`ws-find-item${i === activeIndex ? ' active' : ''}`}
                title={path}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(path)}
              >
                <span className="ws-find-name">{path.slice(slash + 1)}</span>
                {slash > 0 && <span className="ws-find-dir">{path.slice(0, slash)}</span>}
              </button>
            )
          })}
          {notes.length > 0 && <div className="ws-find-note">{notes.join(' · ')}</div>}
        </div>
      )}
    </div>
  )
}
