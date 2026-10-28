import type { WorkspaceEntry, WorkspaceFolder } from './types'

/** Files 탭 트리의 순수 함수. 경로는 세션 cwd 기준 상대 경로(구분자 `/`, 기준 폴더는 빈 글) */

/** 폴더 하나를 받은 상태 */
export type FolderState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ok'; listing: WorkspaceFolder }

export type TreeRow =
  | { kind: 'entry'; path: string; entry: WorkspaceEntry; depth: number; isExpanded: boolean }
  /** 펼친 폴더 아래의 받는 중·실패·비었음·잘림·숨김 한 줄 */
  | { kind: 'note'; key: string; depth: number; note: 'loading' | 'error' | 'empty' | 'truncated' | 'hidden'; text: string }

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

/** 'a/b/c.ts' → ['a', 'a/b'] (펼쳐야 보이는 조상 폴더) */
export function ancestorFolders(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** 펼친 폴더만 따라 내려가며 화면 줄로 편다 (기준 폴더는 늘 펼친 것으로 본다) */
export function treeRows(folders: Record<string, FolderState>, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const walk = (folder: string, depth: number) => {
    const state = folders[folder]
    const key = (note: string) => `${folder}\0${note}`
    if (!state || state.status === 'loading') {
      rows.push({ kind: 'note', key: key('loading'), depth, note: 'loading', text: 'Loading…' })
      return
    }
    if (state.status === 'error') {
      rows.push({ kind: 'note', key: key('error'), depth, note: 'error', text: state.message })
      return
    }
    const { entries, hiddenCount, isTruncated } = state.listing
    for (const entry of entries) {
      const path = joinPath(folder, entry.name)
      const isExpanded = entry.kind === 'dir' && expanded.has(path)
      rows.push({ kind: 'entry', path, entry, depth, isExpanded })
      if (isExpanded) walk(path, depth + 1)
    }
    if (entries.length === 0 && hiddenCount === 0) rows.push({ kind: 'note', key: key('empty'), depth, note: 'empty', text: 'Empty folder' })
    if (isTruncated) rows.push({ kind: 'note', key: key('truncated'), depth, note: 'truncated', text: `Showing the first ${entries.length.toLocaleString('en')} items` })
    if (hiddenCount > 0) rows.push({ kind: 'note', key: key('hidden'), depth, note: 'hidden', text: `${hiddenCount} hidden` })
  }
  walk('', 0)
  return rows
}
