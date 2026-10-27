import { useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type ClipboardEvent, type FormEvent, type KeyboardEvent, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { composerRows, parseBtwCommand, withAttachmentPaths } from './composerText'
import { formatSize } from './Files'

/** 터치 기기(마우스 없음). style.css 의 터치 기기 스타일과 같은 기준. 이 기기에서는 세션을 열 때 입력칸에 포커스하지 않는다 (가상 키보드가 바로 떠 대화를 가린다) */
const TOUCH_QUERY = '(hover: none)'

/** 첨부 한도. 서버 첨부 API(server/src/index.ts MAX_ATTACHMENT_BYTES)와 같다. 넘으면 올리지 않고 칩에 알린다 */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

/** 입력 상자에 붙인 파일. 고르거나 붙여 넣으면 바로 세션 작업 폴더(scratchpad)에 올리고, 보낼 때 그 경로를 글 끝에 붙인다 */
interface Attachment {
  id: number
  file: File
  /** × 로 빼면 올리기를 멈춘다 */
  controller: AbortController
  /** 올라간 곳 (claude 에게 그대로 넘길 Windows 절대 경로). 올리는 중·실패면 null */
  path: string | null
  /** 실패 이유 (서버 message 등). 있으면 실패 */
  error: string | null
}

/** 입력 상자 위쪽의 첨부 칩: (그림이면 작은 미리보기) 파일 이름 · 크기, 올리는 중·실패 이유, × 로 빼기 */
function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const { file, path, error } = attachment
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // 미리보기 URL 은 칩이 사라질 때(× · 보냄 · 세션 바꿈) 놓는다
  useEffect(() => {
    if (!file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const stateClass = error ? ' failed' : path ? '' : ' uploading'
  return (
    <div className={`attachment${stateClass}`} title={error ? `${file.name}\n${error}` : (path ?? file.name)}>
      {previewUrl && <img className="attachment-thumb" src={previewUrl} alt="" />}
      <span className="attachment-name">{file.name}</span>
      <span className="attachment-status" role={error ? 'alert' : undefined}>
        {error ?? (path ? formatSize(file.size) : 'Uploading…')}
      </span>
      <button type="button" className="attachment-remove" onClick={onRemove} title="Remove" aria-label={`Remove ${file.name}`}>
        ×
      </button>
    </div>
  )
}

/** Chat 이 입력 상자에 시키는 것: 제안 버튼을 누르면 입력칸에 채운다, 포커스 */
export interface ComposerHandle {
  fill: (text: string) => void
  /** 입력칸에 포커스한다 (곁가지 질문 카드를 Esc 로 닫았을 때) */
  focus: () => void
}

interface Props {
  ref: Ref<ComposerHandle>
  sessionId: string
  /** 근무 중인 웹 세션만 true. 아니면 아무것도 그리지 않는다 — 쓰던 글·첨부는 남는다 (다시 쓸 수 있게 되면 그대로 보인다) */
  isWritable: boolean
  /** 질문 중에는 입력칸을 막는다. 키 입력이 터미널의 질문 화면에 들어가면 Enter 가 1번 선택지로 답해 버린다. 쓰던 글은 남긴다 */
  isAsking: boolean
  /** 보이는 제안 (빈 입력칸에서 Tab 으로 채운다). 제안 버튼이 안 보이면 null */
  suggestion: string | null
  /** 입력칸이 비었는지 바뀔 때 (제안 표시 조건). 글자마다 부르지 않는다 */
  onEmptyChange: (isEmpty: boolean) => void
  /** 보낼 글 (첨부 경로를 붙인 것). 입력칸·보낸 칩은 이미 비웠다 */
  onSend: (text: string) => void
  /** `/btw 질문` (질문) · `/btw` (null = 카드 다시 열기). claude 에게 보내지 않는다. 입력칸은 이미 비웠고 첨부 칩은 그대로 둔다 */
  onBtw: (question: string | null) => void
  /** 곁가지 질문 버튼: 카드를 열고 카드 입력칸에 포커스한다. 이 입력칸의 글은 건드리지 않는다 */
  onOpenBtw: () => void
}

/**
 * 대화 입력 상자: 여러 줄 입력칸·첨부 칩·보내기. 글자 state 를 여기 두어 칠 때마다 대화(Chat)가 다시 그려지지 않는다.
 * 세션을 바꿔도 쓰던 글은 남고 첨부 칩은 비운다
 */
export function Composer({ ref, sessionId, isWritable, isAsking, suggestion, onEmptyChange, onSend, onBtw, onOpenBtw }: Props) {
  const [draft, setDraft] = useState('')
  /** 입력 상자의 첨부 칩. 세션을 바꾸면 비운다 */
  const [attachments, setAttachments] = useState<Attachment[]>([])
  /** 올리는 중인 첨부가 있으면 보내지 않는다 (경로가 빠진 채 가지 않게) */
  const isUploading = attachments.some((attachment) => !attachment.path && !attachment.error)
  /** 다 올라간 첨부. 보낼 때 경로를 글 끝에 붙인다 (실패한 칩은 붙이지 않고 남겨 둔다) */
  const uploaded = attachments.flatMap((attachment) => (attachment.path ? [{ id: attachment.id, path: attachment.path }] : []))
  const nextAttachmentIdRef = useRef(1)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 글을 바꾼다. 비었는지가 바뀔 때만 Chat 에 알린다 (같은 렌더에 묶인다) */
  function changeDraft(next: string) {
    setDraft(next)
    if ((next === '') !== (draft === '')) onEmptyChange(next === '')
  }

  // 앞 세션으로 올리던 것은 그대로 끝나고(그 세션 scratchpad 에 남는다) 결과는 칩이 없어 버려진다
  useEffect(() => {
    setAttachments([])
  }, [sessionId])

  /** 입력칸에 채우고 커서를 끝에 둔다. 보내지 않는다 (사람이 확인하고 Enter) */
  function fill(text: string) {
    flushSync(() => changeDraft(text))
    const textarea = composerRef.current
    textarea?.focus()
    textarea?.setSelectionRange(text.length, text.length)
  }
  useImperativeHandle(ref, () => ({ fill, focus: () => composerRef.current?.focus() }))

  function submit(event?: FormEvent) {
    event?.preventDefault()
    // 곁가지 질문은 첨부를 붙이지 않는다 (도구 없이 답해 파일을 못 읽는다). 올리는 중이어도 된다
    const btw = parseBtwCommand(draft)
    if (btw && !isAsking) {
      changeDraft('')
      onBtw(btw.question)
      return
    }
    const text = withAttachmentPaths(draft.trim(), uploaded.map((attachment) => attachment.path))
    if (!text || isAsking || isUploading) return
    changeDraft('')
    const sentIds = new Set(uploaded.map((attachment) => attachment.id))
    setAttachments((current) => current.filter((attachment) => !sentIds.has(attachment.id)))
    onSend(text)
  }

  /** 고르거나 붙여 넣은 파일을 칩으로 붙이고 바로 올린다. 20MB 를 넘으면 올리지 않고 칩에 알린다 */
  function attachFiles(files: File[]) {
    if (files.length === 0 || isAsking) return
    const added = files.map(
      (file): Attachment => ({
        id: nextAttachmentIdRef.current++,
        file,
        controller: new AbortController(),
        path: null,
        error: file.size > MAX_ATTACHMENT_BYTES ? 'Over 20MB, not uploaded' : null,
      }),
    )
    setAttachments((current) => [...current, ...added])
    for (const attachment of added) if (!attachment.error) void uploadAttachment(attachment)
  }

  /** 세션 작업 폴더에 올린다. 그 사이 칩이 없어졌으면(× · 세션 바꿈) id 로 못 찾아 결과가 버려진다 */
  async function uploadAttachment(attachment: Attachment) {
    const settle = (result: Pick<Attachment, 'path' | 'error'>) =>
      setAttachments((current) => current.map((item) => (item.id === attachment.id ? { ...item, ...result } : item)))
    const { file } = attachment
    try {
      const response = await fetch(`/api/sessions/${sessionId}/attachments?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
        signal: attachment.controller.signal,
      })
      const body = (await response.json().catch(() => ({}))) as { path?: unknown; message?: unknown }
      if (response.ok && typeof body.path === 'string') settle({ path: body.path, error: null })
      else settle({ path: null, error: typeof body.message === 'string' ? body.message : `HTTP ${response.status}` })
    } catch {
      settle({ path: null, error: 'Network error' })
    }
  }

  function removeAttachment(attachment: Attachment) {
    attachment.controller.abort()
    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
  }

  function onFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    attachFiles(Array.from(event.target.files ?? []))
    // 같은 파일을 다시 고를 수 있게 비운다
    event.target.value = ''
    if (!window.matchMedia(TOUCH_QUERY).matches) composerRef.current?.focus()
  }

  /** 클립보드에 파일·그림만 있으면 첨부로 받는다. 글자가 함께 있으면(엑셀·워드 복사는 글자와 그림을 같이 싣는다) 지금처럼 글자로 붙인다 */
  function onComposerPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0 || event.clipboardData.getData('text/plain')) return
    event.preventDefault()
    attachFiles(files)
  }

  /**
   * Enter = 보내기, Shift+Enter = 줄바꿈. 한글 조합 중 Enter 는 조합 확정이라 보내지 않는다.
   * 제안이 보이면 (= 빈 입력칸) Tab = 제안 채우기. 그 밖의 Tab 은 기본 동작(포커스 이동)
   */
  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const isPlainTab = event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
    if (isPlainTab && suggestion && !event.nativeEvent.isComposing) {
      event.preventDefault()
      fill(suggestion)
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  if (!isWritable) return null
  return (
    <form className="composer" onSubmit={submit}>
      {attachments.length > 0 && (
        <div className="attachments" aria-label="Attachments">
          {attachments.map((attachment) => (
            <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment)} />
          ))}
          {isUploading && <span className="attachments-note">You can send once uploads finish</span>}
        </div>
      )}
      <input ref={fileInputRef} type="file" multiple hidden onChange={onFileInputChange} />
      <button
        type="button"
        className="attach"
        disabled={isAsking}
        onClick={() => fileInputRef.current?.click()}
        aria-label="Attach files"
        title="Attach files"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button type="button" className="btw-open" onClick={onOpenBtw} aria-label="Side question (/btw)" title="Side question (/btw)">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path d="M9.7 8.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.8-1.1 1.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="12" cy="14.6" r="0.9" fill="currentColor" />
        </svg>
      </button>
      <textarea
        ref={composerRef}
        value={draft}
        onChange={(e) => changeDraft(e.target.value)}
        onKeyDown={onComposerKeyDown}
        onPaste={onComposerPaste}
        placeholder={isAsking ? 'Answer the question above first' : 'Type an instruction (Shift+Enter for a new line)'}
        rows={composerRows(draft)}
        disabled={isAsking}
        autoFocus={!window.matchMedia(TOUCH_QUERY).matches}
      />
      <button
        type="submit"
        className="send"
        disabled={(!draft.trim() && uploaded.length === 0) || isAsking || (isUploading && !parseBtwCommand(draft))}
        aria-label="Send"
        title={isUploading ? "Can't send while files are uploading" : 'Send (Enter)'}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M3 3.5 21.5 12 3 20.5 3 13.6 14 12 3 10.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  )
}
