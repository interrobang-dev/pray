/**
 * Files 탭 트리 줄 우클릭(폰은 길게 누르기) 메뉴의 순수 판정: 그 줄에서 되는 항목 목록과 메뉴 자리.
 * 동작은 위 막대와 같은 것을 FilesTab 이 붙인다
 */

export type TreeMenuEntry =
  | 'open'
  | 'add-to-chat'
  | 'copy-path'
  | 'copy-full-path'
  | 'copy-file'
  | 'download'
  | 'share'
  | 'open-in-chrome'
  | 'history'
  | 'reveal'
  | 'separator'

export interface TreeMenuTarget {
  kind: 'file' | 'dir'
  path: string
  /** 이 PC 에서 연 화면 — Copy file·Open in Chrome·Show in folder 는 이때만 (서버가 이 PC 클립보드·창을 쓴다) */
  isLocal: boolean
  /** 안드로이드 앱 브리지가 있다 — Share… */
  hasShareBridge: boolean
}

/** .html·.htm (위 막대 Open in Chrome 과 같은 종류) */
export function isHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path)
}

/**
 * 그 줄에서 되는 항목 (순서·구분선 포함). 폴더는 Add to chat·Copy path·Copy full path 만 —
 * 서버 Show in folder(`file/reveal`)·Copy file·Download 는 파일만 받는다
 */
export function treeMenuEntries({ kind, path, isLocal, hasShareBridge }: TreeMenuTarget): TreeMenuEntry[] {
  if (kind === 'dir') return ['add-to-chat', 'separator', 'copy-path', 'copy-full-path']
  return [
    'open',
    'add-to-chat',
    'separator',
    'copy-path',
    'copy-full-path',
    ...(isLocal ? (['copy-file'] as const) : []),
    'separator',
    'download',
    ...(hasShareBridge ? (['share'] as const) : []),
    ...(isLocal && isHtmlPath(path) ? (['open-in-chrome'] as const) : []),
    'history',
    ...(isLocal ? (['reveal'] as const) : []),
  ]
}

/**
 * 마우스 자리에 띄울 메뉴의 왼쪽 위. 오른쪽·아래로 넘치면 그 점의 반대쪽으로 뒤집고, 그래도 넘치면 화면 안 margin 에 붙인다
 */
export function contextMenuPosition(
  point: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { left: number; top: number } {
  const fit = (start: number, size: number, limit: number) => {
    if (start + size <= limit - margin) return start
    const flipped = start - size
    return Math.max(margin, flipped >= margin ? flipped : limit - margin - size)
  }
  return { left: fit(point.x, menu.width, viewport.width), top: fit(point.y, menu.height, viewport.height) }
}
