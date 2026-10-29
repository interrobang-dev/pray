import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { SearchIcon } from './ChatSearchBar'
import { stepIndex } from './chatSearch'
import { codeFindCountLabel, findInLines, firstMatchFrom, matchIndexesBetween } from './codeFind'
import { clearCodeFindHighlights, paintCodeMatches, scrollMatchIntoView, visibleLines } from './codeViewDom'

/** 입력을 멈추고 이만큼 지나야 찾는다 (큰 파일에서 글자마다 전체를 훑지 않게) */
const QUERY_DEBOUNCE_MS = 120
/** 보이는 줄 위아래로 이만큼 더 칠해 둔다 (조금 스크롤해도 바로 다시 칠하지 않아도 보이게) */
const PAINT_MARGIN_LINES = 150

interface Props {
  /** 코드 보기의 줄 글 (줄 N = lines[N-1], CR 없음) */
  lines: string[]
  /** 줄 HTML. 바뀌면 줄 요소가 새것이라 다시 칠한다 */
  html: string
  viewRef: RefObject<HTMLDivElement | null>
  linesRef: RefObject<HTMLDivElement | null>
  /** 바뀔 때마다 입력칸에 포커스하고 글을 전체 선택한다 (Ctrl+F 를 다시 눌렀을 때) */
  focusId: number
  /** 처음 글·대소문자 (다른 파일을 열어도 같은 글로 이어 찾는다 — FilesTab 이 기억한다) */
  initialQuery: string
  initialCaseSensitive: boolean
  /** 찾는 글이 정해질 때(디바운스 뒤) */
  onChange: (query: string, isCaseSensitive: boolean) => void
  onClose: () => void
}

/**
 * Files 탭 코드 보기 위 찾기 막대 (Ctrl+F). 대화 탭 찾기 막대와 같은 모양(`.chat-search`) + 대소문자 Aa.
 * 맞은 곳은 보이는 줄 근처만 칠하고(스크롤하면 다시) 현재 맞은 곳으로 스크롤한다. 입력·결과·현재 번호가 여기 state 라 글자를 칠 때 코드 보기는 다시 그려지지 않는다
 */
export function CodeFindBar({ lines, html, viewRef, linesRef, focusId, initialQuery, initialCaseSensitive, onChange, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputText, setInputText] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  const [isCaseSensitive, setIsCaseSensitive] = useState(initialCaseSensitive)
  const matches = useMemo(() => findInLines(lines, query, isCaseSensitive), [lines, query, isCaseSensitive])
  /** stamp 는 사용자가 검색어를 바꾸거나 이동할 때마다 올라간다 — 그때만 스크롤한다 (파일을 다시 읽어 결과만 바뀌면 그 자리) */
  const [current, setCurrent] = useState({ index: -1, stamp: 0 })
  const lastSearchRef = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const timer = setTimeout(() => setQuery(inputText), QUERY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputText])

  useEffect(() => {
    onChangeRef.current(query, isCaseSensitive)
  }, [query, isCaseSensitive])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusId])

  // 새 검색어면 지금 보이는 맨 윗줄이나 그 뒤의 첫 맞은 곳에서 시작한다. 같은 검색어에서 글만 바뀌었으면(↻) 번호를 맞춰 둔다.
  // layout effect 라 그리기 전에 번호가 정해진다 (아니면 한 프레임 "0/17" 이 보인다)
  useLayoutEffect(() => {
    const search = JSON.stringify([query, isCaseSensitive])
    const isNewSearch = lastSearchRef.current !== search
    lastSearchRef.current = search
    if (isNewSearch) {
      const view = viewRef.current
      const lineElements = linesRef.current
      const topLine = view && lineElements ? visibleLines(view, lineElements)[0] : 1
      setCurrent((previous) => ({ index: firstMatchFrom(matches, topLine), stamp: previous.stamp + 1 }))
    } else {
      setCurrent((previous) => {
        const index = matches.length === 0 ? -1 : Math.min(Math.max(previous.index, 0), matches.length - 1)
        return index === previous.index ? previous : { ...previous, index }
      })
    }
  }, [matches, query, isCaseSensitive, viewRef, linesRef])

  // 현재 맞은 곳으로 (사용자가 바꾸거나 이동했을 때만)
  const scrolledStampRef = useRef(0)
  useEffect(() => {
    if (scrolledStampRef.current === current.stamp) return
    scrolledStampRef.current = current.stamp
    const view = viewRef.current
    const lineElements = linesRef.current
    const match = matches[current.index]
    if (view && lineElements && match) scrollMatchIntoView(view, lineElements, match)
  }, [current, matches, viewRef, linesRef])

  // 칠하기: 결과·현재·줄 요소가 바뀔 때와 스크롤할 때(한 프레임에 한 번)
  useEffect(() => {
    const view = viewRef.current
    const lineElements = linesRef.current
    if (!view || !lineElements) return
    const paint = () => {
      const [first, last] = visibleLines(view, lineElements)
      const [from, to] = matchIndexesBetween(matches, first - PAINT_MARGIN_LINES, last + PAINT_MARGIN_LINES)
      paintCodeMatches(lineElements, matches, from, to, current.index)
    }
    paint()
    let frame = 0
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }
    view.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      view.removeEventListener('scroll', onScroll)
    }
  }, [matches, current.index, html, viewRef, linesRef])

  useEffect(() => () => clearCodeFindHighlights(), [])

  function go(delta: 1 | -1) {
    if (matches.length === 0) return
    setCurrent((previous) => ({ index: stepIndex(previous.index, delta, matches.length), stamp: previous.stamp + 1 }))
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

  // Esc: 이 막대만 닫는다. 이벤트를 멈춰 패널의 Esc 닫기가 같이 일어나지 않게
  function onBarKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  const countLabel = codeFindCountLabel(query, current.index, matches.length)
  return (
    <div className="chat-search code-find" role="search" onKeyDown={onBarKeyDown}>
      <input
        ref={inputRef}
        type="text"
        value={inputText}
        onChange={(event) => setInputText(event.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Find"
        aria-label="Find in file"
        autoComplete="off"
        spellCheck={false}
      />
      <span className={`chat-search-count${countLabel === 'No results' ? ' empty' : ''}`} role="status">
        {countLabel}
      </span>
      <button
        type="button"
        className={`find-toggle${isCaseSensitive ? ' on' : ''}`}
        aria-pressed={isCaseSensitive}
        onClick={() => setIsCaseSensitive((value) => !value)}
        title="Match case"
        aria-label="Match case"
      >
        Aa
      </button>
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
