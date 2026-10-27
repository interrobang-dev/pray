/** 대화 탭 검색의 순수 함수 (화면 그리기·DOM 은 ChatSearch.tsx·chatSearchPaint.ts) */

/** 검색 대상 하나 = 화면의 대상 하나 (메시지 말풍선·한 줄 또는 명령 도구 줄) */
export interface SearchTarget {
  /** 화면 요소의 `data-jump-key` */
  key: string
  /** 찾을 글 */
  text: string
  /** 접혀 있으면 이 대상을 감추는 작업 묶음의 키 (`Work.key`). 펼쳐야 그려진다. 감추는 묶음이 없으면 null */
  workKey: string | null
}

/** 대소문자 무시 비교용으로 바꾼 글. 길이가 달라질 수 있는 글자(예: 터키어 İ)는 map 으로 원래 위치를 되돌린다 */
function fold(text: string): { folded: string; map: number[] | null } {
  const folded = text.toLocaleLowerCase()
  if (folded.length === text.length) return { folded, map: null }
  let result = ''
  const map: number[] = []
  for (let index = 0; index < text.length; ) {
    const character = String.fromCodePoint(text.codePointAt(index) ?? 0)
    const lowered = character.toLocaleLowerCase()
    for (let offset = 0; offset < lowered.length; offset++) map.push(index)
    result += lowered
    index += character.length
  }
  return { folded: result, map }
}

/** 공백뿐인 검색어는 검색어가 없는 것으로 본다 */
export function isBlankQuery(query: string): boolean {
  return query.trim() === ''
}

/** query 가 글에 들어 있는 곳들의 [시작, 끝) 위치 (원래 글 기준, 겹치지 않게 앞에서부터) */
export function findTextRanges(text: string, query: string): [number, number][] {
  if (isBlankQuery(query)) return []
  const needle = query.toLocaleLowerCase()
  const { folded, map } = fold(text)
  const ranges: [number, number][] = []
  for (let from = folded.indexOf(needle); from !== -1; from = folded.indexOf(needle, from + needle.length)) {
    const foldedEnd = from + needle.length
    if (!map) {
      ranges.push([from, foldedEnd])
      continue
    }
    // 한 글자가 여러 글자로 바뀐 경우 그 글자 끝까지 칠한다
    let next = foldedEnd
    while (next < folded.length && map[next] === map[foldedEnd - 1]) next++
    ranges.push([map[from], next < folded.length ? map[next] : text.length])
  }
  return ranges
}

/** query 가 글에 들어 있는 대상들. 순서는 targets 그대로 (대화 순서) */
export function findMatchingTargets(targets: SearchTarget[], query: string): SearchTarget[] {
  if (isBlankQuery(query)) return []
  const needle = query.toLocaleLowerCase()
  return targets.filter((target) => target.text.toLocaleLowerCase().includes(needle))
}

/** 다음(+1)·이전(-1) 결과 번호. 끝에서 처음으로, 처음에서 끝으로 돈다 */
export function stepIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  return (((current + delta) % count) + count) % count
}

/**
 * 결과가 다시 계산된 뒤 현재 위치. 같은 대상(키)이 남아 있으면 그 번호, 없어졌으면 이전 번호에 가장 가까운 번호.
 * 결과가 없으면 -1
 */
export function resolveCurrentIndex(items: { key: string }[], currentKey: string | null, fallbackIndex: number): number {
  if (items.length === 0) return -1
  const index = currentKey === null ? -1 : items.findIndex((item) => item.key === currentKey)
  if (index !== -1) return index
  return Math.min(Math.max(fallbackIndex, 0), items.length - 1)
}

/** 검색 막대의 개수 글자. 검색어가 없으면 빈 글, 결과가 없으면 "No results", 있으면 "3/12" (index 는 0부터) */
export function searchCountLabel(query: string, index: number, count: number): string {
  if (isBlankQuery(query)) return ''
  if (count === 0) return 'No results'
  return `${index + 1}/${count}`
}

/** 글자 조각(텍스트 노드)들의 글자 수로 글 전체의 [start, end) 를 조각 번호와 조각 안 위치로 바꾼 것 */
export interface PieceRange {
  startIndex: number
  startOffset: number
  endIndex: number
  endOffset: number
}

/**
 * 조각 경계에 걸치면 시작은 뒤 조각의 0, 끝은 앞 조각의 끝으로 잡는다 (끝나는 조각이 빈 범위로 늘어나지 않게).
 * 범위가 조각들 밖이면 null
 */
export function locatePieceRange(lengths: number[], start: number, end: number): PieceRange | null {
  if (start >= end) return null
  let passed = 0
  let startIndex = -1
  let startOffset = 0
  for (let index = 0; index < lengths.length; index++) {
    const pieceEnd = passed + lengths[index]
    if (startIndex === -1 && start < pieceEnd) {
      startIndex = index
      startOffset = start - passed
    }
    if (startIndex !== -1 && end <= pieceEnd) return { startIndex, startOffset, endIndex: index, endOffset: end - passed }
    passed = pieceEnd
  }
  return null
}
