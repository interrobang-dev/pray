/** 팀 만들기 창의 폴더 고르기·git init 칸 순수 함수 (서버 `GET /api/fs/dirs` 응답을 다룬다) */

export interface FolderEntry {
  name: string
  /** Windows 절대 경로 (드라이브는 `D:\`) */
  path: string
  /** 그 폴더 바로 안의 `.git`·`.svn` 만 본 것 */
  vcs: 'git' | 'svn' | null
  teamName: string | null
}

export interface FolderVcs {
  kind: 'git' | 'svn'
  root: string
}

/** `GET /api/fs/dirs` 응답. path null = 드라이브 목록, parent '' = 드라이브 목록으로, null = 위가 없다 */
export interface FolderListing {
  path: string | null
  parent: string | null
  entries: FolderEntry[]
  isTruncated: boolean
  hiddenCount: number
  /** 이 폴더나 그 위의 저장소 */
  vcsAbove: FolderVcs | null
  /** 이 폴더가 이미 팀 폴더면 그 팀 이름 */
  teamName: string | null
}

/** 경로의 마지막 폴더 이름 (팀 이름 칸 채우기). 드라이브 루트·빈 글이면 '' */
export function folderNameOf(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  if (/^[A-Za-z]:$/.test(trimmed)) return ''
  return trimmed.split(/[\\/]/).pop() ?? ''
}

/** 고른 폴더의 판정: 목록의 폴더 자체를 고르면 그 줄(바로 안의 저장소) + 지금 폴더의 vcsAbove(그 위), 지금 폴더를 고르면 vcsAbove */
export function chosenFolderInfo(listing: FolderListing, entry: FolderEntry | null): { path: string; vcs: FolderVcs | null; teamName: string | null } | null {
  if (entry) {
    const vcs = entry.vcs ? { kind: entry.vcs, root: entry.path } : listing.vcsAbove
    return { path: entry.path, vcs, teamName: entry.teamName }
  }
  if (listing.path === null) return null
  return { path: listing.path, vcs: listing.vcsAbove, teamName: listing.teamName }
}

/** git init 칸의 판정. checking = 서버에 묻는 중 */
export type GitInitCheck =
  | { kind: 'empty' }
  | { kind: 'checking'; path: string }
  | { kind: 'folder'; path: string; vcs: FolderVcs | null; teamName: string | null }
  | { kind: 'error'; path: string; message: string }

/** git init 칸을 끌 이유 (title 로 보인다). 켤 수 있으면 null */
export function gitInitBlockReason(check: GitInitCheck): string | null {
  if (check.kind === 'empty') return 'Choose a work folder first'
  if (check.kind === 'checking') return 'Checking the folder…'
  if (check.kind === 'error') return check.message
  if (check.vcs) return `Already inside ${check.vcs.kind === 'git' ? 'a git' : 'an SVN'} repository: ${check.vcs.root}`
  return null
}

/** 경로 칸 두 값이 같은 폴더인지 (대소문자·구분자·끝 구분자 무시. 서버 normalizeCwd 와 같은 비교) */
export function isSameFolder(a: string, b: string): boolean {
  const normalize = (path: string) => path.trim().replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return normalize(a) === normalize(b)
}
