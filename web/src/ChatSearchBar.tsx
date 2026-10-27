import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { findMatchingTargets, resolveCurrentIndex, searchCountLabel, stepIndex, type SearchTarget } from './chatSearch'
import { clearSearchHighlights, paintSearchHighlights, revealCurrentMatch } from './chatSearchPaint'

/** 입력을 멈추고 이만큼 지나야 찾는다 (긴 대화에서 글자마다 전체를 훑지 않게) */
const QUERY_DEBOUNCE_MS = 150
/** 대화가 다시 그려진 뒤 이만큼 모아서 한 번만 다시 칠한다 */
const REPAINT_DELAY_MS = 60

interface Props {
  /** 대화 순서의 검색 대상 전부 (Chat 이 만든다) */
  targets: SearchTarget[]
  /** 대화 스크롤 영역. 칠할 대상 요소를 여기서 찾고, 다시 그려지면 다시 칠한다 */
  containerRef: RefObject<HTMLElement | null>
  /** 바뀔 때마다 입력칸에 포커스하고 글을 전체 선택한다 (Ctrl+F 를 다시 눌렀을 때) */
  focusId: number
  onClose: () => void
  /**
   * 현재 결과가 바뀜 (null = 없음). isNavigation = 사용자가 검색어를 바꾸거나 이동해서 바뀐 것이라 그 결과로 스크롤한다.
   * 대화가 갱신돼 현재 위치만 다시 잡힌 것이면 false
   */
  onCurrentChange: (target: SearchTarget | null, isNavigation: boolean) => void
}

interface Current {
  key: string | null
  /** 결과 목록에서의 번호. 키가 없어졌을 때 가까운 곳을 찾는 데 쓴다 */
  index: number
  /** 사용자가 검색어를 바꾸거나 이동할 때마다 올라간다. 같은 결과로 다시 이동해도 다시 스크롤하게 */
  stamp: number
}

function SearchIcon({ direction }: { direction: 'up' | 'down' | 'close' }) {
  const path = direction === 'up' ? 'M4 10l4-4 4 4' : direction === 'down' ? 'M4 6l4 4 4-4' : 'M4 4l8 8M12 4l-8 8'
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * 대화 탭 안 검색 막대와 검색 상태. 입력·결과 번호가 여기 state 라 글자를 칠 때 Chat(대화 전체)은 다시 그려지지 않는다.
 * 현재 결과가 바뀔 때만 onCurrentChange 로 Chat 에 알린다. 닫히면(언마운트) 칠한 것을 지우고 현재 결과를 없앤다
 */
export function ChatSearch({ targets, containerRef, focusId, onClose, onCurrentChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputText, setInputText] = useState('')
  const [query, setQuery] = useState('')
  const matches = useMemo(() => findMatchingTargets(targets, query), [targets, query])
  const matchKeys = useMemo(() => matches.map((target) => target.key), [matches])
  const [current, setCurrent] = useState<Current>({ key: null, index: -1, stamp: 0 })
  const stampRef = useRef(0)
  const lastQueryRef = useRef('')
  const lastNotifiedRef = useRef<{ key: string | null; stamp: number }>({ key: null, stamp: 0 })
  const onCurrentChangeRef = useRef(onCurrentChange)
  onCurrentChangeRef.current = onCurrentChange

  // 입력은 바로 보이고 찾기는 잠시 뒤에
  useEffect(() => {
    const timer = setTimeout(() => setQuery(inputText), QUERY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputText])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusId])

  // 결과가 다시 계산됐다. 새 검색어면 맨 아래(가장 최근) 결과에서 시작하고, 같은 검색어에서 대화만 갱신됐으면 같은 대상에 남는다 (없어졌으면 가까운 곳)
  useEffect(() => {
    const isNewQuery = lastQueryRef.current !== query
    lastQueryRef.current = query
    if (matches.length === 0) {
      setCurrent((previous) => (previous.key === null ? previous : { key: null, index: -1, stamp: previous.stamp }))
      return
    }
    if (isNewQuery) {
      setCurrent({ key: matches[matches.length - 1].key, index: matches.length - 1, stamp: ++stampRef.current })
      return
    }
    setCurrent((previous) => {
      const index = resolveCurrentIndex(matches, previous.key, previous.index)
      const key = matches[index].key
      return key === previous.key && index === previous.index ? previous : { key, index, stamp: previous.stamp }
    })
  }, [matches, query])

  // 현재 결과가 바뀌면 Chat 에 알린다 (스크롤·테두리·묶음 펼치기는 Chat)
  useEffect(() => {
    const last = lastNotifiedRef.current
    if (last.key === current.key && last.stamp === current.stamp) return
    lastNotifiedRef.current = { key: current.key, stamp: current.stamp }
    const target = current.key === null ? null : (matches[current.index]?.key === current.key ? matches[current.index] : matches.find((item) => item.key === current.key)) ?? null
    onCurrentChangeRef.current(target, current.stamp !== last.stamp)
  }, [current, matches])

  // 칠하기: 결과·현재 결과·검색어가 바뀌었을 때와 대화가 다시 그려졌을 때(메시지 갱신·묶음 펼침). 모아서 한 번만
  const paintStateRef = useRef({ query, matchKeys, currentKey: current.key, stamp: current.stamp })
  paintStateRef.current = { query, matchKeys, currentKey: current.key, stamp: current.stamp }
  const revealedStampRef = useRef(0)
  const repaintTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scheduleRepaint = useCallback(() => {
    clearTimeout(repaintTimerRef.current)
    repaintTimerRef.current = setTimeout(() => {
      const container = containerRef.current
      if (!container) return
      const state = paintStateRef.current
      if (revealedStampRef.current !== state.stamp) {
        revealedStampRef.current = state.stamp
        revealCurrentMatch(container, state.currentKey, state.query)
      }
      paintSearchHighlights(container, state.query, state.matchKeys, state.currentKey)
    }, REPAINT_DELAY_MS)
  }, [containerRef])

  useEffect(() => {
    scheduleRepaint()
  }, [scheduleRepaint, query, matchKeys, current.key, current.stamp])

  // 글이 바뀌는 건 childList 로 본다. 작업 중 표시기의 1초 타이머는 글자(characterData)만 바꿔 여기 안 걸린다
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new MutationObserver(scheduleRepaint)
    observer.observe(container, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [containerRef, scheduleRepaint])

  // 닫힐 때 칠한 것·현재 결과 테두리를 지운다
  useEffect(
    () => () => {
      clearTimeout(repaintTimerRef.current)
      clearSearchHighlights()
      onCurrentChangeRef.current(null, false)
    },
    [],
  )

  const currentIndex = resolveCurrentIndex(matches, current.key, current.index)

  function go(delta: 1 | -1) {
    if (matches.length === 0) return
    const index = stepIndex(currentIndex, delta, matches.length)
    setCurrent({ key: matches[index].key, index, stamp: ++stampRef.current })
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 한글 조합 중 Enter 는 조합 확정이라 이동하지 않는다
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    // 입력 직후(찾기 전) Enter 는 지금 글로 바로 찾는다
    if (inputText !== query) {
      setQuery(inputText)
      return
    }
    go(event.shiftKey ? -1 : 1)
  }

  // Esc: 이 막대만 닫는다. 이벤트를 멈춰 패널·모달의 Esc 닫기가 같이 일어나지 않게
  function onBarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  const countLabel = searchCountLabel(query, currentIndex, matches.length)
  return (
    <div className="chat-search" role="search" onKeyDown={onBarKeyDown}>
      <input
        ref={inputRef}
        type="text"
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Search"
        aria-label="Search conversation"
        autoComplete="off"
        spellCheck={false}
      />
      <span className={`chat-search-count${countLabel === 'No results' ? ' empty' : ''}`} role="status">
        {countLabel}
      </span>
      <button type="button" onClick={() => go(-1)} disabled={matches.length === 0} title="Previous" aria-label="Previous">
        <SearchIcon direction="up" />
      </button>
      <button type="button" onClick={() => go(1)} disabled={matches.length === 0} title="Next" aria-label="Next">
        <SearchIcon direction="down" />
      </button>
      <button type="button" onClick={onClose} title="Close" aria-label="Close">
        <SearchIcon direction="close" />
      </button>
    </div>
  )
}
