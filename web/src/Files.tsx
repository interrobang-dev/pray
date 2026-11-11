import { useContext, useEffect, useMemo, useState } from 'react'
import { IsLocalPage } from './ChatLink'
import { alertDialog } from './Dialog'
import { MarkdownText } from './Markdown'
import { Modal, Segmented } from './Modal'
import { formatDateTime, type ScratchpadFile, type ScratchpadListing } from './types'

/** 글자 미리보기는 앞부분만 받는다 (Range). 이보다 큰 파일은 "앞부분만" 으로 표시 */
const TEXT_PREVIEW_BYTES = 256 * 1024
const EMPTY_LISTING: ScratchpadListing = { files: [], isTruncated: false }

type Kind = 'image' | 'markdown' | 'json' | 'code' | 'html' | 'pdf' | 'video' | 'audio' | 'other'

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'])
/** 글자로 보이되 문법 강조는 하지 않는 것 (highlight.js common 에 없는 언어 포함) */
const PLAIN_TEXT_EXTENSIONS = new Set(['txt', 'log', 'csv', 'tsv', 'jsonl', 'ndjson', 'ps1', 'psm1', 'bat', 'cmd', 'vbs', 'env'])
/** 확장자 → 문법 강조 언어 (rehype-highlight 가 기본으로 싣는 highlight.js common 안에서) */
const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  diff: 'diff',
  patch: 'diff',
  css: 'css',
  scss: 'scss',
  less: 'less',
  xml: 'xml',
  xsl: 'xml',
  xhtml: 'xml',
}
const KIND_ICONS: Record<Kind | 'folder', string> = {
  folder: '📁',
  image: '🖼️',
  markdown: '📝',
  json: '🧾',
  code: '📄',
  html: '🌐',
  pdf: '📕',
  video: '🎬',
  audio: '🎵',
  other: '📦',
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function extensionOf(path: string): string {
  const name = nameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function kindOf(path: string): Kind {
  const extension = extensionOf(path)
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  if (extension === 'md' || extension === 'markdown') return 'markdown'
  if (extension === 'json') return 'json'
  if (extension === 'html' || extension === 'htm') return 'html'
  if (extension === 'pdf') return 'pdf'
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (extension in LANGUAGES || PLAIN_TEXT_EXTENSIONS.has(extension)) return 'code'
  return 'other'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

/** "10-21 18:30" */
function formatTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 코드 블록 마크다운. 글 안의 가장 긴 백틱 줄보다 긴 울타리를 써서 글이 블록을 닫지 못하게 */
function fenced(text: string, language: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language}\n${text}\n${fence}`
}

const rawUrl = (sessionId: string, path: string, isDownload = false) =>
  `/api/sessions/${sessionId}/files/raw?path=${encodeURIComponent(path)}${isDownload ? '&download=1' : ''}`

async function fetchListing(sessionId: string): Promise<ScratchpadListing> {
  try {
    const response = await fetch(`/api/sessions/${sessionId}/files`)
    return response.ok ? ((await response.json()) as ScratchpadListing) : EMPTY_LISTING
  } catch {
    return EMPTY_LISTING
  }
}

interface Folder {
  name: string
  path: string
  fileCount: number
  /** 안에 든 파일 중 가장 최근 */
  modifiedAt: string
}

/** 평평한 파일 목록에서 한 폴더의 바로 아래 폴더·파일 */
function folderContents(files: ScratchpadFile[], folder: string): { folders: Folder[]; files: ScratchpadFile[] } {
  const prefix = folder ? `${folder}/` : ''
  const folders = new Map<string, Folder>()
  const direct: ScratchpadFile[] = []
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue
    const rest = file.path.slice(prefix.length)
    const slash = rest.indexOf('/')
    if (slash < 0) {
      direct.push(file)
      continue
    }
    const name = rest.slice(0, slash)
    const existing = folders.get(name)
    if (existing) {
      existing.fileCount++
      if (file.modifiedAt > existing.modifiedAt) existing.modifiedAt = file.modifiedAt
    } else {
      folders.set(name, { name, path: `${prefix}${name}`, fileCount: 1, modifiedAt: file.modifiedAt })
    }
  }
  return { folders: [...folders.values()], files: direct }
}

type SortOrder = 'recent' | 'name'
const compareName = (a: string, b: string) => a.localeCompare(b, 'ko', { numeric: true })

/**
 * 대화 오른쪽 아래 버튼 묶음의 동그란 폴더 버튼 (제안이 있으면 그 위, "↓" 는 이 위에 쌓인다). 세션 작업 폴더(scratchpad)에 파일이 있을 때만 보인다.
 * 세션을 열 때와 대화가 갱신될 때 확인하고, 파일이 있는 것을 본 뒤로는 모달을 열 때·새로고침 때만 다시 받는다 (일하는 동안 갱신이 잦아서).
 * 세션이 바뀌면 Chat 이 key 로 새로 만든다
 */
export function FilesButton({ sessionId, version }: { sessionId: string; version: number }) {
  const [listing, setListing] = useState<ScratchpadListing>(EMPTY_LISTING)
  const [isOpen, setIsOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasFiles = listing.files.length > 0

  useEffect(() => {
    if (hasFiles) return
    let isCancelled = false
    void fetchListing(sessionId).then((data) => {
      if (!isCancelled) setListing(data)
    })
    return () => {
      isCancelled = true
    }
  }, [sessionId, version, hasFiles])

  async function refresh() {
    setIsRefreshing(true)
    setListing(await fetchListing(sessionId))
    setIsRefreshing(false)
  }

  function open() {
    setIsOpen(true)
    void refresh()
  }

  if (!hasFiles) return null
  return (
    <>
      <button type="button" className="files-button" onClick={open} title="Work files" aria-label="Work files">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <FilesModal sessionId={sessionId} listing={listing} isRefreshing={isRefreshing} onRefresh={() => void refresh()} onClose={() => setIsOpen(false)} />
      )}
    </>
  )
}

interface FilesModalProps {
  sessionId: string
  listing: ScratchpadListing
  isRefreshing: boolean
  onRefresh: () => void
  onClose: () => void
}

/** 폴더 탐색기 느낌의 모달: 왼쪽 목록(경로 표시줄·폴더·파일), 오른쪽 미리보기. 폰은 화면 전체를 쓰고 목록 → 미리보기 → ← 로 오간다 */
function FilesModal({ sessionId, listing, isRefreshing, onRefresh, onClose }: FilesModalProps) {
  const [folder, setFolder] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const selected = listing.files.find((file) => file.path === selectedPath) ?? null
  const isLocal = useContext(IsLocalPage)

  /** 경로 표시줄의 지금 폴더를 이 PC 의 탐색기로 연다 (서버가 연다. 이 PC 에서 연 화면에만 버튼이 있다) */
  async function openFolder() {
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folder }),
      })
      if (response.ok) return
      const { message } = (await response.json().catch(() => ({}))) as { message?: string }
      void alertDialog(`Couldn't open folder: ${message ?? `HTTP ${response.status}`}`)
    } catch {
      void alertDialog("Couldn't open folder: Network error")
    }
  }

  const contents = useMemo(() => {
    const { folders, files } = folderContents(listing.files, folder)
    if (sortOrder === 'name') {
      folders.sort((a, b) => compareName(a.name, b.name))
      files.sort((a, b) => compareName(nameOf(a.path), nameOf(b.path)))
    } else {
      folders.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
      files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    }
    return { folders, files }
  }, [listing, folder, sortOrder])

  const crumbs = folder ? folder.split('/') : []

  return (
    <Modal title="Work files" onClose={onClose} className={`files-modal${selected ? ' has-preview' : ''}`}>
      <div className="files-toolbar">
        <nav className="files-crumbs" aria-label="Path">
          <button type="button" onClick={() => setFolder('')} className={crumbs.length === 0 ? 'on' : ''}>
            scratchpad
          </button>
          {crumbs.map((name, i) => (
            <span key={i} className="files-crumb">
              <span aria-hidden="true">/</span>
              <button type="button" onClick={() => setFolder(crumbs.slice(0, i + 1).join('/'))} className={i === crumbs.length - 1 ? 'on' : ''}>
                {name}
              </button>
            </span>
          ))}
        </nav>
        <Segmented
          value={sortOrder}
          onChange={setSortOrder}
          options={[
            { value: 'recent', label: 'Recent' },
            { value: 'name', label: 'Name' },
          ]}
        />
        {isLocal && (
          <button type="button" className="files-icon-button" onClick={() => void openFolder()} title="Open folder" aria-label="Open folder">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <button type="button" className="files-icon-button" onClick={onRefresh} disabled={isRefreshing} title="Reload" aria-label="Reload">
          ↻
        </button>
        <button type="button" className="files-icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close">
          ×
        </button>
      </div>
      <div className="files-body">
        <div className="files-list">
          {contents.folders.map((item) => (
            <button key={item.path} type="button" className="files-item" onClick={() => setFolder(item.path)}>
              <span className="files-item-icon" aria-hidden="true">
                {KIND_ICONS.folder}
              </span>
              <span className="files-item-name">{item.name}</span>
              <span className="files-item-meta" title={formatDateTime(item.modifiedAt)}>
                {item.fileCount} {item.fileCount === 1 ? 'file' : 'files'} · {formatTime(item.modifiedAt)}
              </span>
            </button>
          ))}
          {contents.files.map((file) => (
            <button
              key={file.path}
              type="button"
              className={`files-item${file.path === selectedPath ? ' selected' : ''}`}
              onClick={() => setSelectedPath(file.path)}
            >
              <span className="files-item-icon" aria-hidden="true">
                {KIND_ICONS[kindOf(file.path)]}
              </span>
              <span className="files-item-name">{nameOf(file.path)}</span>
              <span className="files-item-meta" title={formatDateTime(file.modifiedAt)}>
                {formatSize(file.size)} · {formatTime(file.modifiedAt)}
              </span>
            </button>
          ))}
          {contents.folders.length === 0 && contents.files.length === 0 && <p className="hint">No files</p>}
          {listing.isTruncated && <p className="files-note">Too many files: showing the first {listing.files.length} (shallow folders first)</p>}
        </div>
        <div className="files-preview">
          {selected ? (
            <FilePreview key={`${selected.path}:${selected.modifiedAt}`} sessionId={sessionId} file={selected} onBack={() => setSelectedPath(null)} />
          ) : (
            <p className="hint">Select a file to preview it</p>
          )}
        </div>
      </div>
    </Modal>
  )
}

function FilePreview({ sessionId, file, onBack }: { sessionId: string; file: ScratchpadFile; onBack: () => void }) {
  const kind = kindOf(file.path)
  const url = rawUrl(sessionId, file.path)
  const name = nameOf(file.path)
  return (
    <>
      <div className="files-preview-head">
        <button type="button" className="files-back" onClick={onBack} title="Back to list" aria-label="Back to list">
          ←
        </button>
        <div className="files-preview-title">
          <b title={file.path}>{name}</b>
          <span className="files-item-meta">
            {formatSize(file.size)} · {formatDateTime(file.modifiedAt)}
          </span>
        </div>
        <a className="files-action" href={url} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
        <a className="files-action" href={rawUrl(sessionId, file.path, true)}>
          Download
        </a>
      </div>
      <div className={`files-preview-body ${kind}`}>
        {kind === 'image' && <img src={url} alt={name} />}
        {/* allow-scripts 를 넣지 않는다 (서버도 CSP sandbox 로 내보낸다). 로컬 접속은 무인증이라 스크립트가 API 를 부를 수 있게 되면 안 된다 */}
        {kind === 'html' && <iframe src={url} sandbox="" title={name} />}
        {kind === 'pdf' && <iframe src={url} title={name} />}
        {kind === 'video' && <video src={url} controls />}
        {kind === 'audio' && <audio src={url} controls />}
        {(kind === 'markdown' || kind === 'json' || kind === 'code') && <TextPreview url={url} file={file} kind={kind} />}
        {kind === 'other' && (
          <div className="files-other">
            <p className="hint">No preview for this file type</p>
            <a className="files-action primary" href={rawUrl(sessionId, file.path, true)}>
              Download
            </a>
          </div>
        )}
      </div>
    </>
  )
}

/** 마크다운은 대화와 같은 렌더러로, JSON 은 정리해서, 코드·텍스트는 문법 강조 코드 블록으로. 큰 파일은 앞부분만 받는다 */
function TextPreview({ url, file, kind }: { url: string; file: ScratchpadFile; kind: 'markdown' | 'json' | 'code' }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isCut = file.size > TEXT_PREVIEW_BYTES

  useEffect(() => {
    let isCancelled = false
    // 빈 파일에 Range 를 보내면 416 이라 넘칠 때만 보낸다. no-store: 일하는 중 바뀌는 파일이고,
    // Range 요청이 HTTP 캐시에 남은 항목과 엮이면 다시 열 때 ERR_CACHE_OPERATION_NOT_SUPPORTED 로 실패했다
    fetch(url, { cache: 'no-store', headers: isCut ? { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } : undefined })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return new TextDecoder().decode(await response.arrayBuffer())
      })
      .then(
        (decoded) => !isCancelled && setText(decoded),
        (reason: Error) => !isCancelled && setError(reason.message),
      )
    return () => {
      isCancelled = true
    }
  }, [url, isCut])

  const markdown = useMemo(() => {
    if (text === null) return null
    if (kind === 'markdown') return text
    if (kind === 'json' && !isCut) {
      try {
        return fenced(JSON.stringify(JSON.parse(text), null, 2), 'json')
      } catch {
        // 해석이 안 되면 받은 그대로
      }
    }
    return fenced(text, kind === 'json' ? 'json' : (LANGUAGES[extensionOf(file.path)] ?? ''))
  }, [text, kind, isCut, file.path])

  if (error) return <p className="hint">Couldn't read the file ({error})</p>
  if (markdown === null) return <p className="hint">Loading…</p>
  return (
    <>
      {isCut && <p className="files-note">Large file: showing the first {formatSize(TEXT_PREVIEW_BYTES)}. Open in a new tab or download for the rest</p>}
      <MarkdownText text={markdown} />
    </>
  )
}
