import { memo, useMemo, useRef, type CSSProperties } from 'react'
import { diffRowsHtml, diffStats, isOpenable, STATUS_LABELS, STATUS_LETTERS, type DiffRow } from './changes'
import type { LineRange } from './codeSelection'
import { useLineSelection } from './lineSelection'
import type { WorkspaceDiff } from './types'

interface Props {
  diff: WorkspaceDiff
  rows: DiffRow[]
  /** 고른 diff 줄(row) 범위 */
  selection: LineRange | null
  onSelectionChange: (range: LineRange | null) => void
  /** 없으면 Open in Files 를 숨긴다 (지난 커밋의 diff) */
  onOpenInFiles?: () => void
  /** false 면 줄 고르기를 끈다 — 지난 커밋 diff 의 줄 번호는 지금 파일과 달라 위치로 공유하지 않는다 */
  isSelectable?: boolean
}

/**
 * Changes·History 의 diff 보기 (읽기만): 머리줄(상태·옛 이름·+/− 줄 수·Open in Files) + unified diff (옛·새 줄 번호, 추가·삭제 바탕색, hunk 머리).
 * 줄은 CodeView 처럼 innerHTML 한 번이고 줄 고르기도 같다 (번호 칸 = `.diff-gutter`)
 */
export const DiffView = memo(function DiffView({ diff, rows, selection, onSelectionChange, onOpenInFiles, isSelectable = true }: Props) {
  const html = useMemo(() => diffRowsHtml(rows), [rows])
  const digits = useMemo(() => {
    let max = 0
    for (const row of rows) if (row.kind !== 'hunk') max = Math.max(max, row.oldLine ?? 0, row.newLine ?? 0)
    return String(max).length
  }, [rows])
  const linesRef = useRef<HTMLDivElement>(null)
  const onMouseDown = useLineSelection({
    linesRef,
    lineSelector: '.diff-row',
    numberAttribute: 'data-row',
    isGutterHit: (event) => (event.target as Element).closest('.diff-gutter') !== null,
    html,
    selection,
    onSelectionChange,
  })
  const { added, deleted } = diffStats(diff.hunks)

  return (
    <div className="ws-diff">
      <div className="ws-diff-head">
        <span className={`ws-change-letter ${diff.status}`} aria-hidden="true">
          {STATUS_LETTERS[diff.status]}
        </span>
        <span className="ws-diff-status">
          {STATUS_LABELS[diff.status]}
          {diff.oldPath && <span title={diff.oldPath}> from {diff.oldPath}</span>}
        </span>
        {diff.kind === 'diff' && (
          <span className="ws-diff-stats">
            <span className="added">+{added}</span> <span className="deleted">−{deleted}</span>
          </span>
        )}
        {diff.encoding === 'euc-kr' && <span className="ws-diff-note">EUC-KR</span>}
        {onOpenInFiles && isOpenable(diff.status) && (
          <button type="button" className="ws-open-file" onClick={onOpenInFiles} title={`Open ${diff.path} in Files`}>
            Open in Files
          </button>
        )}
      </div>
      {diff.kind === 'diff' ? (
        <div className={`diff-view${isSelectable ? '' : ' is-readonly'}`} style={{ '--diff-digits': digits } as CSSProperties}>
          <div className="diff-lines" ref={linesRef} onMouseDown={isSelectable ? onMouseDown : undefined} dangerouslySetInnerHTML={{ __html: html }} />
          {diff.hasPropertyChanges && <p className="hint">Property changes aren't shown</p>}
        </div>
      ) : (
        <p className="hint">{emptyReason(diff)}</p>
      )}
    </div>
  )
})

function emptyReason(diff: WorkspaceDiff): string {
  if (diff.kind === 'binary') return 'Binary file · No preview'
  if (diff.kind === 'too-large') return 'Diff too large to show (limit 1 MB)'
  if (diff.status === 'missing') return 'The file is missing from the working copy'
  if (diff.status === 'renamed') return 'Renamed without content changes'
  if (diff.hasPropertyChanges) return "Only properties changed (not shown)"
  if (diff.status === 'untracked' || diff.status === 'added') return 'Empty file'
  return 'No content changes'
}
