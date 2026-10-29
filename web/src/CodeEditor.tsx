import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import type { LineRange } from './codeSelection'
import type { EditorHandle } from './codeMirrorEditor'

/** FilesTab 이 편집기에 시키는 것 (편집기를 받는 중이면 아무것도 안 한다) */
export interface CodeEditorHandle {
  getText(): string | null
  setText(text: string): void
  markSaved(text: string): void
  selectionLines(): LineRange | null
  /** 고른 글자 (편집기를 받는 중이면 빈 글) */
  selectedText(): string
  openSearch(): void
  revealLine(line: number): void
  focus(): void
}

interface Props {
  ref: Ref<CodeEditorHandle>
  text: string
  path: string
  onDirtyChange: (isDirty: boolean) => void
  onSave: () => void
}

/**
 * Files 탭 편집 모드의 편집기 자리. CodeMirror(`codeMirrorEditor.ts`)는 처음 그릴 때 동적 import 로 받는다 — 보기만 하는 사람은 받지 않는다.
 * 처음 글(text)은 마운트 때만 쓴다 (FilesTab 이 경로를 key 로 준다). 다시 받은 글은 handle.setText 로 넣는다
 */
export function CodeEditor({ ref, text, path, onDirtyChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  const callbacksRef = useRef({ onDirtyChange, onSave })
  callbacksRef.current = { onDirtyChange, onSave }
  const initialRef = useRef({ text, path })

  useEffect(() => {
    let isCancelled = false
    import('./codeMirrorEditor').then(
      ({ createEditor }) => {
        if (isCancelled || !hostRef.current) return
        editorRef.current = createEditor(hostRef.current, {
          ...initialRef.current,
          onDirtyChange: (isDirty) => callbacksRef.current.onDirtyChange(isDirty),
          onSave: () => callbacksRef.current.onSave(),
        })
        setStatus('ready')
        editorRef.current.focus()
      },
      () => !isCancelled && setStatus('failed'),
    )
    return () => {
      isCancelled = true
      editorRef.current?.destroy()
      editorRef.current = null
    }
  }, [])

  useImperativeHandle(ref, () => ({
    getText: () => editorRef.current?.getText() ?? null,
    setText: (next) => editorRef.current?.setText(next),
    markSaved: (next) => editorRef.current?.markSaved(next),
    selectionLines: () => editorRef.current?.selectionLines() ?? null,
    selectedText: () => editorRef.current?.selectedText() ?? '',
    openSearch: () => editorRef.current?.openSearch(),
    revealLine: (line) => editorRef.current?.revealLine(line),
    focus: () => editorRef.current?.focus(),
  }))

  return (
    <div className="ws-editor">
      {status !== 'ready' && <p className="hint">{status === 'loading' ? 'Loading editor…' : "Couldn't load the editor"}</p>}
      <div className="ws-editor-host" ref={hostRef} />
    </div>
  )
}
