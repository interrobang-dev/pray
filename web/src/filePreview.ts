/**
 * Files 탭 파일 보기의 미리보기 종류 (확장자로 정한다). 서버 `/file/raw` 가 내주는 종류(scratchpad.ts 의 CONTENT_TYPES 중
 * 그림·동영상·소리·PDF)와 맞춘다. 여기 없는 것은 `file?path=` 로 받아 글이면 코드 보기, 아니면 No preview
 */
export type PreviewKind = 'image' | 'svg' | 'pdf' | 'video' | 'audio'

const KINDS: Record<string, PreviewKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  bmp: 'image',
  ico: 'image',
  avif: 'image',
  svg: 'svg',
  pdf: 'pdf',
  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  ogv: 'video',
  mov: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  oga: 'audio',
  m4a: 'audio',
  aac: 'audio',
  flac: 'audio',
  opus: 'audio',
}

export function previewKindOf(path: string | null): PreviewKind | null {
  if (!path) return null
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? (KINDS[name.slice(dot + 1).toLowerCase()] ?? null) : null
}

/** 글을 받지 않고 `/file/raw` 만 보는 종류. SVG 는 원본 코드 보기로 바꿀 수 있어 글도 받는다 */
export function isRawOnlyKind(kind: PreviewKind | null): boolean {
  return kind !== null && kind !== 'svg'
}
