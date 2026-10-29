import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import { diffLineRange, diffRowsOf, STATUS_LABELS, STATUS_LETTERS } from './changes'
import { CodeEditor, type CodeEditorHandle } from './CodeEditor'
import { CodeView } from './CodeView'
import { chatLocationText, clampLineRange, lineCountOf, locationText, type LineRange } from './codeSelection'
import { CopyButton } from './CopyButton'
import { alertDialog, choiceDialog } from './Dialog'
import { DiffView } from './DiffView'
import { formatSize } from './Files'
import {
  formatAgo,
  formatDateTime,
  type ChangedFile,
  type WorkspaceChanges,
  type WorkspaceDiff,
  type WorkspaceEntry,
  type WorkspaceFile,
  type WorkspaceFindResult,
  type WorkspaceFolder,
} from './types'
import { setUnsavedEdit, whenLeavingAllowed } from './unsavedEdits'
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
/** 변경 목록 받기 */
type ChangesState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; changes: WorkspaceChanges }
/** 받은 diff. FileState 처럼 path 가 지금 고른 변경 파일과 다르면 받는 중 */
type DiffState = { path: string } & ({ status: 'error'; message: string } | { status: 'ok'; diff: WorkspaceDiff })

/** 세션별로 기억하는 Files 탭 상태 (이 화면의 메모리. 탭·세션을 바꿔 다시 열어도 펼침·고른 파일이 남고, 새로고침하면 사라진다) */
interface SessionView {
  folders: Record<string, FolderState>
  expanded: Set<string>
  selectedPath: string | null
  /** 파일별로 고른 줄 범위 */
  lineRanges: Record<string, LineRange>
  /** 왼쪽 칸: 파일 트리 · 변경 목록 */
  sideMode: 'files' | 'changes'
  selectedChange: string | null
  /** 변경 파일별로 고른 diff 줄(row) 범위 */
  diffRanges: Record<string, LineRange>
  /** 마지막 변경 목록 (다시 열 때 먼저 보이고 다시 받는다) */
  changes: ChangesState | null
}
const sessionViews = new Map<string, SessionView>()

interface Props {
  sessionId: string
  cwd: string
  /** 위치 글을 이 세션 대화 입력칸에 넣고 대화 탭으로 간다 */
  onAddToChat: (snippet: string) => void
  /** 입력칸이 없는 세션(외부·휴식·퇴근)이면 그 이유. 있으면 Add to chat 을 막고 title 로 보인다 */
  addToChatBlockReason: string | null
}

/**
 * 세션 패널의 Files 탭: 세션 cwd 를 IDE 처럼 본다. 위 막대(빠른 찾기·경로·편집·저장·Add to chat·Copy path·↻), 왼쪽 트리(폴더를 펼칠 때 받는다)·변경 목록, 오른쪽 파일 보기·편집기·diff.
 * 편집은 연필 버튼으로 들어가고 이 PC(127.0.0.1) 접속에서만 된다 (서버가 파일마다 editBlockReason 으로 알려 준다).
 * 폰은 트리 → 파일을 누르면 보기 → ← 로 트리. 세션마다 App 이 key 로 새로 만든다
 */
export function FilesTab({ sessionId, cwd, onAddToChat, addToChatBlockReason }: Props) {
  const saved = sessionViews.get(sessionId)
  const [folders, setFolders] = useState<Record<string, FolderState>>(saved?.folders ?? {})
  const [expanded, setExpanded] = useState<Set<string>>(saved?.expanded ?? new Set())
  const [selectedPath, setSelectedPath] = useState<string | null>(saved?.selectedPath ?? null)
  const [lineRanges, setLineRanges] = useState<Record<string, LineRange>>(saved?.lineRanges ?? {})
  const [sideMode, setSideMode] = useState<'files' | 'changes'>(saved?.sideMode ?? 'files')
  const [selectedChange, setSelectedChange] = useState<string | null>(saved?.selectedChange ?? null)
  const [diffRanges, setDiffRanges] = useState<Record<string, LineRange>>(saved?.diffRanges ?? {})
  const [changesState, setChangesState] = useState<ChangesState>(saved?.changes ?? { status: 'loading' })
  const [diffState, setDiffState] = useState<DiffState | null>(null)
  /** 변경 목록 머리줄 ↻ (목록과 고른 diff 만) */
  const [changesReloadId, setChangesReloadId] = useState(0)
  const [fileState, setFileState] = useState<FileState | null>(null)
  /** 편집 모드인 파일. 고른 파일이 이것이고 Files 쪽이고 글 파일일 때만 편집기가 보인다 (다른 파일을 열면 null) */
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const editingPathRef = useRef(editingPath)
  editingPathRef.current = editingPath
  /** 편집기 글이 저장된 글과 다르다 (●) */
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)
  const editorRef = useRef<CodeEditorHandle>(null)
  const wsRef = useRef<HTMLDivElement>(null)
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
    sessionViews.set(sessionId, { folders, expanded, selectedPath, lineRanges, sideMode, selectedChange, diffRanges, changes: changesState })
  }, [sessionId, folders, expanded, selectedPath, lineRanges, sideMode, selectedChange, diffRanges, changesState])

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
      (file) => {
        setFileState({ path: selectedPath, status: 'ok', file })
        // 편집 중인 파일을 다시 받았으면(↻·충돌 뒤 Reload — 저장 안 한 편집은 버리기로 한 뒤다) 편집기 글도 바꾼다
        if (file.kind === 'text' && editingPathRef.current === selectedPath) editorRef.current?.setText(file.text)
        // 다시 읽은 파일이 줄었으면 고른 범위를 자른다 (글이 아니게 됐으면 뺀다)
        setLineRanges((prev) => {
          const range = prev[selectedPath]
          if (!range) return prev
          const clamped = file.kind === 'text' ? clampLineRange(range, lineCountOf(file.text)) : null
          if (clamped === range) return prev
          const next = { ...prev }
          if (clamped) next[selectedPath] = clamped
          else delete next[selectedPath]
          return next
        })
      },
      (error: Error) => error.name !== 'AbortError' && setFileState({ path: selectedPath, status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [sessionId, selectedPath, reloadId])
  const shownFile = fileState && fileState.path === selectedPath ? fileState : null

  // 변경 목록: 열 때(개수를 탭에 보이려고 Files 쪽을 보고 있어도)·↻. 다시 받는 동안은 앞 목록을 둔다
  useEffect(() => {
    const controller = new AbortController()
    setChangesState((prev) => (prev.status === 'ok' ? prev : { status: 'loading' }))
    fetchJson<WorkspaceChanges>(apiUrl(sessionId, 'changes', {}), controller.signal).then(
      (changes) => setChangesState({ status: 'ok', changes }),
      (error: Error) => error.name !== 'AbortError' && setChangesState({ status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [sessionId, reloadId, changesReloadId])

  // 고른 변경 파일의 diff (Changes 를 보고 있을 때만). 다시 받은 diff 의 줄 수가 줄었으면 고른 범위를 자른다
  useEffect(() => {
    if (sideMode !== 'changes' || !selectedChange) return
    const controller = new AbortController()
    fetchJson<WorkspaceDiff>(apiUrl(sessionId, 'changes/diff', { path: selectedChange }), controller.signal).then(
      (diff) => {
        setDiffState({ path: selectedChange, status: 'ok', diff })
        const rowCount = diffRowsOf(diff.hunks).length
        setDiffRanges((prev) => {
          const range = prev[selectedChange]
          if (!range) return prev
          const clamped = clampLineRange(range, rowCount)
          if (clamped === range) return prev
          const next = { ...prev }
          if (clamped && rowCount > 0) next[selectedChange] = clamped
          else delete next[selectedChange]
          return next
        })
      },
      (error: Error) => error.name !== 'AbortError' && setDiffState({ path: selectedChange, status: 'error', message: error.message }),
    )
    return () => controller.abort()
  }, [sessionId, sideMode, selectedChange, reloadId, changesReloadId])
  const shownDiff = diffState && diffState.path === selectedChange ? diffState : null
  const diffRows = useMemo(() => (shownDiff?.status === 'ok' ? diffRowsOf(shownDiff.diff.hunks) : []), [shownDiff])
  const diffRange = selectedChange ? (diffRanges[selectedChange] ?? null) : null

  const changeDiffRange = useCallback(
    (range: LineRange | null) => {
      if (!selectedChange) return
      setDiffRanges((prev) => {
        const next = { ...prev }
        if (range) next[selectedChange] = range
        else delete next[selectedChange]
        return next
      })
    },
    [selectedChange],
  )
  const lineRange = selectedPath ? (lineRanges[selectedPath] ?? null) : null

  const changeLineRange = useCallback(
    (range: LineRange | null) => {
      if (!selectedPath) return
      setLineRanges((prev) => {
        const next = { ...prev }
        if (range) next[selectedPath] = range
        else delete next[selectedPath]
        return next
      })
    },
    [selectedPath],
  )

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
    if (path !== selectedPath) setEditingPath(null)
    setSelectedPath(path)
    setIsViewing(true)
  }

  /** 다른 파일·Changes·↻ 로 편집기 글이 바뀌거나 사라지기 전에: 저장 안 한 편집이 있으면 버릴지 묻고 버리기로 했을 때만 */
  function guardEdit(run: () => void) {
    whenLeavingAllowed(run)
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

  function openChange(path: string) {
    setSelectedChange(path)
    setIsViewing(true)
  }

  /** diff 의 Open in Files: Files 쪽으로 바꿔 그 파일을 연다 (트리를 펼쳐 보이게) */
  function openInFiles(path: string) {
    setSideMode('files')
    revealFile(path)
  }

  const isChanges = sideMode === 'changes'
  const textFile = !isChanges && shownFile?.status === 'ok' && shownFile.file.kind === 'text' ? shownFile.file : null
  const isEditing = textFile !== null && editingPath !== null && editingPath === selectedPath
  /** 편집을 막는 이유 (서버가 파일마다 준다. 필드가 없는 옛 서버는 저장 API 도 없다) */
  const editBlock = textFile ? (textFile.editBlockReason === undefined ? 'The server needs a restart to support editing' : textFile.editBlockReason) : null
  /** 위 막대가 가리키는 파일과 공유할 줄 (Changes 면 고른 diff 줄의 새 파일 줄 번호, 편집 중이면 누를 때 편집기에서 고른 줄) */
  const shownPath = isChanges ? selectedChange : selectedPath
  const shownRange = isChanges ? diffLineRange(diffRows, diffRange) : isEditing ? null : lineRange
  const locationRange = () => (isEditing ? (editorRef.current?.selectionLines() ?? null) : shownRange)
  const entry = selectedPath ? entryOf(folders, selectedPath) : null
  const meta = isChanges ? null : shownFile?.status === 'ok' ? shownFile.file : entry

  // 편집을 그만두면 ● 도 끈다. 저장 안 한 편집은 App 이 탭·세션을 바꾸기 전에 묻도록 적어 둔다 (탭이 언마운트되면 편집기 글이 사라진다)
  useEffect(() => {
    if (!isEditing) setIsDirty(false)
  }, [isEditing])
  useEffect(() => {
    setUnsavedEdit(isEditing && isDirty ? selectedPath : null)
  }, [isEditing, isDirty, selectedPath])
  useEffect(() => () => setUnsavedEdit(null), [])
  // 창 닫기·새로고침: 브라우저 기본 확인 창 (beforeunload 는 앱 안 창을 띄울 수 없다)
  useEffect(() => {
    if (!isEditing || !isDirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isEditing, isDirty])

  /**
   * 편집기 글 저장 (PUT file). 열었을 때의 hash 를 실어 보내고, 디스크 파일이 바뀌었으면(409) Overwrite·Reload·Cancel 을 고른다.
   * 저장하면 파일 정보(hash·mtime·크기)를 바꾸고 변경 목록을 다시 받는다
   */
  async function save() {
    const editor = editorRef.current
    const text = editor?.getText() ?? null
    if (!isEditing || !isDirty || !selectedPath || !textFile || !editor || text === null || isSavingRef.current) return
    const path = selectedPath
    isSavingRef.current = true
    setIsSaving(true)
    try {
      let hash = textFile.hash
      for (;;) {
        let response: Response
        try {
          response = await fetch(apiUrl(sessionId, 'file', { path }), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, hash }),
          })
        } catch {
          await alertDialog("Couldn't save the file: network error", { title: 'Save failed' })
          return
        }
        const body = (await response.json().catch(() => null)) as { message?: string; hash?: string; mtime?: string; size?: number; current?: { hash?: string } } | null
        if (response.ok && body?.hash && body.mtime && typeof body.size === 'number') {
          setFileState({ path, status: 'ok', file: { ...textFile, text, hash: body.hash, mtime: body.mtime, size: body.size } })
          editor.markSaved(text)
          setChangesReloadId((id) => id + 1)
          return
        }
        if (response.status === 409 && body?.current?.hash) {
          const choice = await choiceDialog(`${nameOf(path)} changed on disk after you opened it. Overwrite it with your version, or reload it and lose your changes?`, {
            title: 'File changed on disk',
            choices: [
              { label: 'Reload', value: 'reload' },
              { label: 'Overwrite', value: 'overwrite', isDanger: true },
            ],
          })
          if (choice === 'overwrite') {
            hash = body.current.hash
            continue
          }
          if (choice === 'reload') {
            setUnsavedEdit(null)
            setReloadId((id) => id + 1)
          }
          return
        }
        await alertDialog(`Couldn't save the file: ${body?.message ?? `HTTP ${response.status}`}`, { title: 'Save failed' })
        return
      }
    } finally {
      isSavingRef.current = false
      setIsSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // Ctrl+S (맥 Cmd+S): 편집 중이고 포커스가 Files 탭 안(또는 아무 데도 없음)일 때 브라우저 저장 창 대신 저장. 편집기 안은 편집기 키맵이 먼저 받는다
  useEffect(() => {
    if (!isEditing) return
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const isSKey = event.code === 'KeyS' || event.key.toLowerCase() === 's'
      if (!isSKey || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.defaultPrevented) return
      const active = document.activeElement
      if (document.querySelector('.modal-overlay') || !(active === document.body || (active && wsRef.current?.contains(active)))) return
      event.preventDefault()
      void saveRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEditing])

  function toggleEdit() {
    if (!isEditing) {
      setEditingPath(selectedPath)
      return
    }
    guardEdit(() => setEditingPath(null))
  }

  return (
    <div className={`ws${isViewing ? ' is-viewing' : ''}${isEditing ? ' is-editing' : ''}`} ref={wsRef}>
      <div className="ws-toolbar">
        <button
          type="button"
          className="ws-back"
          onClick={() => setIsViewing(false)}
          title={isChanges ? 'Back to changes' : 'Back to files'}
          aria-label={isChanges ? 'Back to changes' : 'Back to files'}
        >
          ←
        </button>
        <QuickFind sessionId={sessionId} focusId={findFocusId} onOpen={(path) => (path === selectedPath && !isChanges ? openInFiles(path) : guardEdit(() => openInFiles(path)))} />
        {/* 좁으면 폴더 부분만 말줄임되고 파일 이름은 남는다 */}
        <nav className="ws-path" aria-label="Path" title={shownPath ? [cwd.replace(/[\\/]+$/, ''), ...shownPath.split('/')].join('\\') : cwd}>
          <span className="ws-path-dir">{[rootName, ...(shownPath?.split('/').slice(0, -1) ?? [])].join(' / ')}</span>
          {shownPath && (
            <>
              <span className="ws-path-sep" aria-hidden="true">
                /
              </span>
              {isEditing && isDirty && (
                <span className="ws-dirty" title="Unsaved changes" aria-label="Unsaved changes">
                  ●
                </span>
              )}
              <b>{nameOf(shownPath)}</b>
              {shownRange && <span className="ws-path-lines">{locationText('', shownRange)}</span>}
            </>
          )}
        </nav>
        {meta && (
          <span className="ws-meta" title={formatDateTime(meta.mtime)}>
            {formatSize(meta.size)} · {formatAgo(meta.mtime, Date.now())}
            {shownFile?.status === 'ok' && shownFile.file.kind === 'text' && shownFile.file.encoding === 'euc-kr' && ' · EUC-KR'}
          </span>
        )}
        {isEditing && (
          <button type="button" className="ws-save" disabled={!isDirty || isSaving} onClick={() => void save()} title="Save (Ctrl+S)">
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        )}
        {textFile && (
          <button
            type="button"
            className={`ws-edit${isEditing ? ' on' : ''}`}
            disabled={!isEditing && editBlock !== null}
            aria-pressed={isEditing}
            onClick={toggleEdit}
            title={isEditing ? 'Stop editing' : editBlock ? `Can't edit: ${editBlock}` : 'Edit'}
            aria-label={isEditing ? 'Stop editing' : 'Edit'}
          >
            <PencilIcon />
          </button>
        )}
        {shownPath && (
          <>
            <button
              type="button"
              className="ws-add-chat"
              disabled={addToChatBlockReason !== null}
              onClick={() => onAddToChat(chatLocationText(shownPath, locationRange()))}
              title={
                addToChatBlockReason
                  ? `Can't add to chat: ${addToChatBlockReason}`
                  : isEditing
                    ? `Add to chat: ${shownPath} (with the selected lines)`
                    : `Add to chat: ${locationText(shownPath, shownRange)}`
              }
              aria-label="Add to chat"
            >
              <AddToChatIcon />
            </button>
            <CopyButton text={() => locationText(shownPath, locationRange())} label="Copy path" />
          </>
        )}
        <button type="button" className="ws-reload" onClick={() => guardEdit(() => setReloadId((id) => id + 1))} title="Reload" aria-label="Reload">
          ↻
        </button>
      </div>
      <div className="ws-body">
        {/* aside 가 아니다: style.css 의 aside 규칙(왼쪽 목록)이 걸린다 */}
        <div className="ws-side">
          <div className="ws-side-tabs" role="tablist" aria-label="Side panel">
            <button type="button" role="tab" aria-selected={!isChanges} className={isChanges ? '' : 'on'} onClick={() => setSideMode('files')}>
              Files
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isChanges}
              className={isChanges ? 'on' : ''}
              onClick={() =>
                !isChanges &&
                guardEdit(() => {
                  setEditingPath(null)
                  setSideMode('changes')
                })
              }
            >
              Changes
              {changesState.status === 'ok' && changesState.changes.kind !== 'none' && changesState.changes.files.length > 0 && (
                <span className="ws-count">{changesState.changes.files.length.toLocaleString('en')}{changesState.changes.isTruncated ? '+' : ''}</span>
              )}
            </button>
          </div>
          {isChanges ? (
            <ChangesList state={changesState} selectedPath={selectedChange} onOpen={openChange} onReload={() => setChangesReloadId((id) => id + 1)} />
          ) : (
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
                  onClick={() => (row.entry.kind === 'dir' ? toggleFolder(row.path) : row.path === selectedPath ? openFile(row.path) : guardEdit(() => openFile(row.path)))}
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
          )}
        </div>
        <section className="ws-view">
          {isChanges ? (
            <ChangeView
              path={selectedChange}
              state={shownDiff}
              rows={diffRows}
              range={diffRange}
              onRangeChange={changeDiffRange}
              onOpenInFiles={openInFiles}
            />
          ) : (
            <FileView
              sessionId={sessionId}
              path={selectedPath}
              state={shownFile}
              reloadId={reloadId}
              lineRange={lineRange}
              onLineRangeChange={changeLineRange}
              editor={isEditing ? { ref: editorRef, onDirtyChange: setIsDirty, onSave: () => void saveRef.current() } : null}
            />
          )}
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
 * 변경 목록 (Changes): 머리줄(git · 브랜치 / SVN · ↻. 개수는 탭 배지) + 상태 글자·이름·폴더 줄. 받는 중·실패·형상관리 없음·명령 실패·변경 없음은 회색 한 줄
 */
function ChangesList({ state, selectedPath, onOpen, onReload }: { state: ChangesState; selectedPath: string | null; onOpen: (path: string) => void; onReload: () => void }) {
  const changes = state.status === 'ok' ? state.changes : null
  const files: ChangedFile[] = changes && changes.kind !== 'none' ? changes.files : []
  const note =
    state.status === 'loading'
      ? 'Loading…'
      : state.status === 'error'
        ? `Couldn't list changes: ${state.message}`
        : changes?.kind === 'none'
          ? 'Not a git or SVN working copy'
          : changes?.error
            ? changes.error
            : files.length === 0
              ? 'No changes'
              : null
  const isError = state.status === 'error' || (changes?.kind !== 'none' && Boolean(changes?.error))
  return (
    <div className="ws-changes">
      <div className="ws-changes-head">
        <span className="ws-vcs" title={changes && changes.kind !== 'none' && changes.branch ? `Branch ${changes.branch}` : undefined}>
          {changes && changes.kind !== 'none' ? (changes.kind === 'git' ? 'git' : 'SVN') : ''}
          {changes && changes.kind !== 'none' && changes.branch && <span className="ws-branch"> · {changes.branch}</span>}
        </span>
        <button type="button" className="ws-changes-reload" onClick={onReload} title="Refresh changes" aria-label="Refresh changes">
          ↻
        </button>
      </div>
      <div className="ws-change-list" role="listbox" aria-label="Changes">
        {files.map((file) => {
          const slash = file.path.lastIndexOf('/')
          const title = `${STATUS_LABELS[file.status]}: ${file.path}${file.oldPath ? ` (from ${file.oldPath})` : ''}`
          return (
            <button
              key={file.path}
              type="button"
              role="option"
              aria-selected={file.path === selectedPath}
              className={`ws-change${file.path === selectedPath ? ' selected' : ''}`}
              title={title}
              onClick={() => onOpen(file.path)}
            >
              <span className={`ws-change-letter ${file.status}`} aria-label={STATUS_LABELS[file.status]}>
                {STATUS_LETTERS[file.status]}
              </span>
              <span className={`ws-change-name${file.status === 'deleted' || file.status === 'missing' ? ' is-gone' : ''}`}>{file.path.slice(slash + 1)}</span>
              {slash > 0 && <span className="ws-change-dir">{file.path.slice(0, slash)}</span>}
            </button>
          )
        })}
        {note && <div className={`ws-note${isError ? ' error' : ''}`}>{note}</div>}
        {changes && changes.kind !== 'none' && changes.isTruncated && <div className="ws-note">Showing the first 2,000 changes</div>}
        {changes && changes.kind !== 'none' && changes.hiddenCount > 0 && (
          <div className="ws-note" title="Untracked files in .git, node_modules, dist, build and similar folders aren't listed">
            {changes.hiddenCount.toLocaleString('en')} untracked in hidden folders
          </div>
        )}
      </div>
    </div>
  )
}

/** Changes 의 오른쪽: 고른 변경 파일의 diff */
function ChangeView({
  path,
  state,
  rows,
  range,
  onRangeChange,
  onOpenInFiles,
}: {
  path: string | null
  state: DiffState | null
  rows: ReturnType<typeof diffRowsOf>
  range: LineRange | null
  onRangeChange: (range: LineRange | null) => void
  onOpenInFiles: (path: string) => void
}) {
  if (!path) return <p className="hint">Select a changed file to see its diff</p>
  if (!state) return <p className="hint">Loading…</p>
  if (state.status === 'error') return <p className="hint ws-error">Couldn't load the diff: {state.message}</p>
  return <DiffView key={path} diff={state.diff} rows={rows} selection={range} onSelectionChange={onRangeChange} onOpenInFiles={() => onOpenInFiles(path)} />
}

/** 연필 (Edit) */
function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** 말풍선 + "+" (Add to chat) */
function AddToChatIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M12 7.5v6M9 10.5h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/** 오른쪽 파일 보기. 글 파일은 CodeView(줄 고르기 포함), 편집 모드면 그 자리에 CodeEditor */
function FileView({
  sessionId,
  path,
  state,
  reloadId,
  lineRange,
  onLineRangeChange,
  editor,
}: {
  sessionId: string
  path: string | null
  state: FileState | null
  reloadId: number
  lineRange: LineRange | null
  onLineRangeChange: (range: LineRange | null) => void
  /** 편집 모드면 편집기에 줄 것 */
  editor: { ref: Ref<CodeEditorHandle>; onDirtyChange: (isDirty: boolean) => void; onSave: () => void } | null
}) {
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
  if (editor) return <CodeEditor key={path} ref={editor.ref} text={file.text} path={path} onDirtyChange={editor.onDirtyChange} onSave={editor.onSave} />
  return <CodeView key={path} text={file.text} language={file.language} selection={lineRange} onSelectionChange={onLineRangeChange} />
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
