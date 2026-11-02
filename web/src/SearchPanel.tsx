import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { WorkspaceSearchResult } from './types'
import { apiUrl, fetchJson } from './workspaceApi'
import { previewPieces, searchKey, searchNotes, searchParams, searchSummary, type SearchInput } from './workspaceSearch'
import { nameOf } from './workspaceTree'

/** 입력을 멈추고 이만큼 지나면 찾는다 (Enter·토글은 바로) */
const SEARCH_DEBOUNCE_MS = 300

/** 세션별로 기억하는 Search 상태 (FilesTab 의 sessionViews 에 든다. 새로고침하면 사라진다) */
export interface SearchState extends SearchInput {
  /** 마지막으로 받은 결과와 그 검색 키 (지금 입력과 키가 다르면 찾는 중이거나 지난 결과) */
  result: { key: string; data: WorkspaceSearchResult } | null
  error: { key: string; message: string } | null
  /** 접은 결과 파일 */
  collapsed: Set<string>
}

export const EMPTY_SEARCH: SearchState = { query: '', isCaseSensitive: false, isWholeWord: false, isRegex: false, result: null, error: null, collapsed: new Set() }

interface Props {
  sessionId: string
  state: SearchState
  onStateChange: (update: (previous: SearchState) => SearchState) => void
  /** 바뀔 때마다 입력칸에 포커스하고 전체 선택한다. text 가 있으면 그 글로 바꿔 바로 찾는다 (Ctrl+Shift+F, 골라 둔 글자) */
  focusRequest: { id: number; text: string | null } | null
  /** 요청을 처리했다 (다시 마운트될 때 또 하지 않게 FilesTab 이 비운다) */
  onFocusRequestHandled: () => void
  /** 마지막으로 연 결과 줄 (표시) */
  openedMatch: { path: string; line: number } | null
  onOpenMatch: (path: string, line: number) => void
}

const TOGGLES = [
  { key: 'isCaseSensitive', label: 'Aa', title: 'Match case' },
  { key: 'isWholeWord', label: 'ab', title: 'Match whole word' },
  { key: 'isRegex', label: '.*', title: 'Use regular expression' },
] as const

/**
 * Files 탭 왼쪽 칸의 Search (작업 폴더 전체 내용 찾기, `GET /api/sessions/:id/search`): 입력칸 + 토글 3개, 파일별로 묶은 결과(접기), 줄 번호 + 줄 글(맞은 곳 칠함).
 * 입력은 300ms 모아서·Enter·토글은 바로 찾고, 앞 요청은 끊는다. 결과 줄을 누르면 그 파일·줄을 연다
 */
export function SearchPanel({ sessionId, state, onStateChange, focusRequest, onFocusRequestHandled, openedMatch, onOpenMatch }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<AbortController | null>(null)
  /** 지금 도는 검색 키 (같은 키를 또 보내지 않게) */
  const runningKeyRef = useRef<string | null>(null)
  const [runningKey, setRunningKey] = useState<string | null>(null)
  const key = searchKey(state)

  const start = useCallback(
    (input: SearchInput) => {
      controllerRef.current?.abort()
      const startKey = searchKey(input)
      const controller = new AbortController()
      controllerRef.current = controller
      runningKeyRef.current = startKey
      setRunningKey(startKey)
      const finish = () => {
        if (controllerRef.current !== controller) return
        controllerRef.current = null
        runningKeyRef.current = null
        setRunningKey(null)
      }
      fetchJson<WorkspaceSearchResult>(apiUrl(sessionId, 'search', searchParams(input)), controller.signal).then(
        (data) => {
          finish()
          onStateChange((previous) => ({ ...previous, result: { key: startKey, data }, error: null, collapsed: new Set() }))
        },
        (error: Error) => {
          if (error.name === 'AbortError') return
          finish()
          onStateChange((previous) => ({ ...previous, error: { key: startKey, message: error.message } }))
        },
      )
    },
    [sessionId, onStateChange],
  )

  // 입력이 바뀌면 잠시 뒤 찾는다 (이미 그 결과·오류가 있거나 도는 중이면 그대로). 빈 글이면 앞 요청만 끊는다
  useEffect(() => {
    if (state.query === '') {
      controllerRef.current?.abort()
      controllerRef.current = null
      runningKeyRef.current = null
      setRunningKey(null)
      return
    }
    if (state.result?.key === key || state.error?.key === key || runningKeyRef.current === key) return
    const input: SearchInput = { query: state.query, isCaseSensitive: state.isCaseSensitive, isWholeWord: state.isWholeWord, isRegex: state.isRegex }
    const timer = setTimeout(() => start(input), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [key, state.query, state.isCaseSensitive, state.isWholeWord, state.isRegex, state.result, state.error, start])

  useEffect(() => () => controllerRef.current?.abort(), [])

  // 패널을 열면 서버가 파일 목록(30초 캐시)을 미리 만들게 빈 빠른 찾기를 한 번 보낸다 — 첫 찾기가 목록 만들기(최대 3초)를 기다리지 않게.
  // 데우기라 응답·실패는 보지 않는다 (같은 폴더를 만드는 중이면 서버에서 찾기가 같이 기다린다)
  useEffect(() => {
    fetchJson(apiUrl(sessionId, 'find', { q: '' })).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    if (!focusRequest) return
    const { text } = focusRequest
    if (text !== null) {
      onStateChange((previous) => ({ ...previous, query: text }))
      start({ query: text, isCaseSensitive: state.isCaseSensitive, isWholeWord: state.isWholeWord, isRegex: state.isRegex })
    }
    inputRef.current?.focus()
    inputRef.current?.select()
    onFocusRequestHandled()
    // 요청이 바뀔 때만 (그 렌더의 state 가 지금 값이다)
  }, [focusRequest])

  function setToggle(name: (typeof TOGGLES)[number]['key']) {
    const next = { ...state, [name]: !state[name] }
    onStateChange((previous) => ({ ...previous, [name]: !previous[name] }))
    if (next.query !== '') start(next)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      if (state.query !== '') start(state)
    } else if (event.key === 'Escape') {
      // 패널이 같이 닫히지 않게
      event.stopPropagation()
      inputRef.current?.blur()
    }
  }

  function toggleFile(path: string) {
    onStateChange((previous) => {
      const collapsed = new Set(previous.collapsed)
      if (collapsed.has(path)) collapsed.delete(path)
      else collapsed.add(path)
      return { ...previous, collapsed }
    })
  }

  const isSearching = runningKey !== null && runningKey === key
  const error = state.error?.key === key && !isSearching ? state.error.message : null
  /** 입력이 바뀌어 찾는 중이면 지난 결과를 흐리게 둔다 (빈 글이면 없다) */
  const result = state.query !== '' && !error ? state.result : null
  const isStale = result !== null && result.key !== key
  const data = result?.data ?? null
  const notes = data && !isStale ? searchNotes(data) : []
  return (
    <div className="ws-search">
      <div className="ws-search-box">
        <input
          ref={inputRef}
          type="text"
          value={state.query}
          placeholder="Search"
          title="Search file contents (Ctrl+Shift+F)"
          aria-label="Search file contents"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            const query = event.target.value
            onStateChange((previous) => ({ ...previous, query }))
          }}
          onKeyDown={onKeyDown}
        />
        {TOGGLES.map((toggle) => (
          <button
            key={toggle.key}
            type="button"
            className={`find-toggle${state[toggle.key] ? ' on' : ''}`}
            aria-pressed={state[toggle.key]}
            onClick={() => setToggle(toggle.key)}
            title={toggle.title}
            aria-label={toggle.title}
          >
            {toggle.label}
          </button>
        ))}
      </div>
      {state.query !== '' && (
        <div className={`ws-search-summary${error ? ' error' : ''}`} role="status" title={data && !isStale ? `Searched ${data.searchedFileCount.toLocaleString('en')} files in ${data.elapsedMs.toLocaleString('en')} ms` : undefined}>
          {error ? error : isSearching || isStale || !data ? 'Searching…' : searchSummary(data)}
        </div>
      )}
      {notes.map((note) => (
        <div key={note} className="ws-search-note">
          {note}
        </div>
      ))}
      {data && (
        <div className={`ws-search-results${isStale ? ' is-stale' : ''}`} role="tree" aria-label="Search results">
          {data.files.map((file) => {
            const isCollapsed = state.collapsed.has(file.path)
            const slash = file.path.lastIndexOf('/')
            return (
              <div key={file.path} role="treeitem" aria-expanded={!isCollapsed}>
                <button type="button" className="ws-search-file" title={file.path} onClick={() => toggleFile(file.path)}>
                  <span className="ws-chevron" aria-hidden="true">
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                  <span className="ws-search-name">{nameOf(file.path)}</span>
                  {slash > 0 && <span className="ws-search-dir">{file.path.slice(0, slash)}</span>}
                  <span className="ws-count">{file.matchCount.toLocaleString('en')}</span>
                </button>
                {!isCollapsed &&
                  file.matches.map((match) => {
                    const { pieces, isCutBefore, isCutAfter } = previewPieces(match)
                    const isOpened = openedMatch?.path === file.path && openedMatch.line === match.line
                    return (
                      <button
                        key={match.line}
                        type="button"
                        className={`ws-search-match${isOpened ? ' selected' : ''}`}
                        title={`${file.path}:${match.line}\n${match.text.trim()}`}
                        onClick={() => onOpenMatch(file.path, match.line)}
                      >
                        <span className="ws-search-line">{match.line}</span>
                        <span className="ws-search-text">
                          {isCutBefore && '…'}
                          {pieces.map((piece, index) =>
                            piece.isMatch ? (
                              <mark key={index} className="ws-search-hit">
                                {piece.text}
                              </mark>
                            ) : (
                              piece.text
                            ),
                          )}
                          {isCutAfter && '…'}
                        </span>
                      </button>
                    )
                  })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
