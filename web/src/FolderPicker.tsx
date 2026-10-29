import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { alertDialog, promptDialog } from './Dialog'
import { chosenFolderInfo, type FolderEntry, type FolderListing, type FolderVcs } from './folderChoice'

interface Props {
  /** 처음 열 폴더. 비었거나 못 열면 드라이브 목록 */
  initialPath: string
  onSelect: (folder: { path: string; vcs: FolderVcs | null; teamName: string | null }) => void
  onCancel: () => void
}

async function fetchListing(path: string): Promise<FolderListing> {
  const response = await fetch(`/api/fs/dirs?path=${encodeURIComponent(path)}`)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.message ?? `HTTP ${response.status}`)
  return body as FolderListing
}

/**
 * 팀 만들기 창 안에 펼치는 폴더 고르기 (이 PC 전용 API). 드라이브 → 폴더, 두 번 클릭·Enter 로 들어가고 ↑ 로 위로.
 * 한 번 클릭은 그 줄을 고르고, 아무 줄도 안 골랐으면 지금 폴더를 고른다
 */
export function FolderPicker({ initialPath, onSelect, onCancel }: Props) {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [pathText, setPathText] = useState(initialPath)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const listRef = useRef<HTMLUListElement>(null)
  const requestRef = useRef(0)

  async function open(path: string, { selectPath = null as string | null, isInitial = false } = {}) {
    const request = ++requestRef.current
    setIsLoading(true)
    try {
      const next = await fetchListing(path)
      if (request !== requestRef.current) return
      setListing(next)
      setPathText(next.path ?? '')
      setSelectedPath(selectPath)
      setError(null)
    } catch (caught) {
      if (request !== requestRef.current) return
      setError((caught as Error).message)
      // 적힌 경로를 못 열면 드라이브 목록부터 (오류는 그대로 보인다)
      if (isInitial && path) {
        const drives = await fetchListing('').catch(() => null)
        if (request === requestRef.current && drives) setListing(drives)
      }
    } finally {
      if (request === requestRef.current) setIsLoading(false)
    }
  }

  // 처음 한 번만
  useEffect(() => {
    void open(initialPath.trim(), { isInitial: true })
  }, [])

  useEffect(() => {
    if (!selectedPath) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(selectedPath)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus()
  }, [selectedPath, listing])

  const entries = listing?.entries ?? []
  const selectedEntry = entries.find((entry) => entry.path === selectedPath) ?? null
  const chosen = listing ? chosenFolderInfo(listing, selectedEntry) : null

  async function createNewFolder() {
    if (!listing?.path) return
    const name = await promptDialog(`New folder in ${listing.path}`, { placeholder: 'Folder name', confirmLabel: 'Create' })
    if (name === null) return
    const response = await fetch('/api/fs/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parent: listing.path, name }),
    }).catch(() => null)
    if (!response) {
      void alertDialog("Couldn't create the folder: Network error")
      return
    }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      void alertDialog(`Couldn't create the folder: ${body.message ?? `HTTP ${response.status}`}`)
      return
    }
    // 만든 폴더를 고른 상태로 목록을 다시 받는다 (Select 한 번이면 그 폴더)
    await open(listing.path, { selectPath: body.path })
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLLIElement>, entry: FolderEntry) {
    const index = entries.indexOf(entry)
    if (event.key === 'Enter') {
      event.preventDefault()
      void open(entry.path)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = entries[index + (event.key === 'ArrowDown' ? 1 : -1)]
      if (next) setSelectedPath(next.path)
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      goUp()
    }
  }

  const parent = listing?.parent ?? null
  /** 위로 가면 방금 있던 폴더를 고른 채로 */
  function goUp() {
    if (parent !== null) void open(parent, { selectPath: listing?.path ?? null })
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker-bar">
        <button type="button" className="folder-up" disabled={parent === null || isLoading} onClick={goUp} title="Up one level" aria-label="Up one level">
          ↑
        </button>
        <input
          className="folder-path"
          value={pathText}
          onChange={(event) => setPathText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            void open(pathText.trim())
          }}
          placeholder="This PC"
          aria-label="Folder path"
          spellCheck={false}
        />
      </div>
      <ul className="folder-list" ref={listRef} role="listbox" aria-label="Folders" aria-busy={isLoading}>
        {entries.map((entry) => (
          <li
            key={entry.path}
            data-path={entry.path}
            role="option"
            tabIndex={entry.path === selectedPath || (selectedPath === null && entry === entries[0]) ? 0 : -1}
            aria-selected={entry.path === selectedPath}
            className={entry.path === selectedPath ? 'is-selected' : ''}
            onClick={() => setSelectedPath(entry.path)}
            onDoubleClick={() => void open(entry.path)}
            onKeyDown={(event) => onRowKeyDown(event, entry)}
            title={entry.teamName ? `${entry.path} · Team "${entry.teamName}"` : entry.path}
          >
            <span className="folder-name">{entry.name}</span>
            {entry.vcs && <span className="vcs-chip">{entry.vcs === 'git' ? 'git' : 'SVN'}</span>}
            {entry.teamName && <span className="folder-team">Team: {entry.teamName}</span>}
          </li>
        ))}
        {!isLoading && listing && entries.length === 0 && <li className="folder-empty">{listing.path === null ? 'No drives' : 'No folders'}</li>}
      </ul>
      {listing?.isTruncated && <div className="form-hint">Showing the first {entries.length} folders</div>}
      {error && <div className="folder-error">{error}</div>}
      <div className="folder-chosen" title={chosen?.path}>
        {chosen ? (
          <>
            <span className="folder-chosen-label">Selected</span> {chosen.path}
            {chosen.teamName && <span className="folder-team">Team: {chosen.teamName}</span>}
          </>
        ) : (
          'Pick a drive or folder'
        )}
      </div>
      <div className="actions folder-actions">
        <button type="button" onClick={() => void createNewFolder()} disabled={!listing?.path || isLoading}>
          New folder
        </button>
        <span className="folder-actions-gap" />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!chosen || isLoading} onClick={() => chosen && onSelect(chosen)}>
          Select
        </button>
      </div>
    </div>
  )
}
