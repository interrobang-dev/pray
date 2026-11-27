/**
 * Files 탭 파일 보기의 미리보기 종류 (확장자로 정한다). 서버 `/file/raw`·`/raw/<경로>` 가 내주는 종류(scratchpad.ts 의 CONTENT_TYPES 중
 * HTML·그림·동영상·소리·PDF·docx·xlsx·xls)와 맞춘다. csv·tsv 는 글로 받아 표로 그린다. 여기 없는 것은 `file?path=` 로 받아 글이면 코드 보기, 아니면 No preview.
 * `unsupported` 는 미리보기가 없다고 알기만 하는 문서(pptx·hwp·hwpx) — 글로 받지 않고 "No preview for this file type"
 */
export type PreviewKind = 'image' | 'svg' | 'html' | 'pdf' | 'docx' | 'sheet' | 'csv' | 'video' | 'audio' | 'unsupported'
/** 미리보기 ↔ 원본 코드 보기를 바꿀 수 있는 종류 (md 는 markdownDoc.ts 로 따로 본다) */
export type SourceViewKind = 'svg' | 'html' | 'csv'

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
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'sheet',
  xls: 'sheet',
  csv: 'csv',
  tsv: 'csv',
  pptx: 'unsupported',
  hwp: 'unsupported',
  hwpx: 'unsupported',
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

export function hasSourceView(kind: PreviewKind | null): kind is SourceViewKind {
  return kind === 'svg' || kind === 'html' || kind === 'csv'
}

/** 글을 받지 않고 raw 주소만 보는 종류. SVG·HTML·csv 는 원본 코드 보기로 바꿀 수 있어 글도 받는다 */
export function isRawOnlyKind(kind: PreviewKind | null): boolean {
  return kind !== null && !hasSourceView(kind)
}

/**
 * 경로가 주소에 그대로 든 raw 주소 (`/api/sessions/<id>/raw/<경로>`). HTML 미리보기 iframe 이 이것을 열어 문서 안 상대 경로(`css/site.css`)가
 * 같은 꼴 주소로 풀린다. 칸마다 encodeURIComponent 라 `#`·`?`·`%`·공백·한글이 든 이름도 된다
 */
export function rawPathUrl(sessionId: string, path: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/raw/${path.split('/').map(encodeURIComponent).join('/')}`
}
