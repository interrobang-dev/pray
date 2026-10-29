/**
 * Files 탭 History(git 커밋 히스토리) 순수 함수: 목록 이어 붙이기, 브랜치·태그 칩, 안내 문구, 대화에 넣을 글
 */
import type { CommitDetail, HistoryCommit, WorkspaceHistory } from './types'

/** 브랜치·태그 칩 하나. isCurrent = HEAD 가 가리키는 브랜치(또는 detached HEAD) */
export interface RefChip {
  text: string
  isTag: boolean
  isCurrent: boolean
}

/** 서버 refs(`tag: v1`·HEAD 브랜치가 맨 앞) → 칩 */
export function refChips(commit: Pick<HistoryCommit, 'refs' | 'isHead'>): RefChip[] {
  return commit.refs.map((ref, index) =>
    ref.startsWith('tag: ') ? { text: ref.slice('tag: '.length), isTag: true, isCurrent: false } : { text: ref, isTag: false, isCurrent: commit.isHead && index === 0 },
  )
}

/** 다음 쪽을 이어 붙인다. 그 사이 새 커밋이 생겨 밀린 것(이미 있는 해시)은 빼고 */
export function appendCommits(previous: HistoryCommit[], next: HistoryCommit[]): HistoryCommit[] {
  const seen = new Set(previous.map((commit) => commit.hash))
  return [...previous, ...next.filter((commit) => !seen.has(commit.hash))]
}

/** 대화 입력칸에 넣을 글: `` `abc1234` 제목 `` */
export function commitChatText(commit: Pick<HistoryCommit, 'shortHash' | 'subject'>): string {
  return `\`${commit.shortHash}\` ${commit.subject}`.trim()
}

/** 목록 끝 안내 한 줄 (없으면 null). isError 면 빨강 */
export function historyNote(history: WorkspaceHistory, isFiltered: boolean): { text: string; isError: boolean } | null {
  if (history.kind === 'svn') return { text: 'Commit history is available for git only', isError: false }
  if (history.kind === 'none') return { text: 'Not a git repository', isError: false }
  if (history.error) return { text: history.error, isError: true }
  if (history.commits.length === 0) return { text: isFiltered ? 'No commits for this file' : 'No commits yet', isError: false }
  return null
}

/** 커밋 상세의 부모 안내 (첫 커밋·머지만, 그 밖은 null) */
export function parentNote(detail: Pick<CommitDetail, 'parents'>): string | null {
  if (detail.parents.length === 0) return 'Initial commit'
  if (detail.parents.length > 1) return `Merge commit · changes against the first parent ${detail.parents[0].slice(0, 7)}`
  return null
}

/** 상세 파일 목록 끝 안내 (cwd 밖 파일 수·잘림·바뀐 파일 없음) */
export function commitFileNotes(detail: Pick<CommitDetail, 'files' | 'outsideCount' | 'isTruncated'>): string[] {
  const notes: string[] = []
  if (detail.files.length === 0) notes.push(detail.outsideCount > 0 ? 'No changes in this folder' : 'No file changes')
  if (detail.isTruncated) notes.push('Showing the first 2,000 files')
  if (detail.outsideCount > 0) notes.push(`${detail.outsideCount.toLocaleString('en')} ${detail.outsideCount === 1 ? 'file' : 'files'} outside this folder not shown`)
  return notes
}
