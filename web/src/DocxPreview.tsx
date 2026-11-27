import { useEffect, useState } from 'react'
import { DOCX_PREVIEW_LIMIT_BYTES, docxSrcdoc } from './docxSrcdoc'
import { formatSize } from './Files'

type DocxState = { status: 'loading' } | { status: 'ready'; srcdoc: string } | { status: 'too-large'; size: number } | { status: 'failed' }

/**
 * Files 탭 docx 미리보기. `/file/raw` 로 받은 파일을 mammoth(처음 그릴 때만 동적 import — 메인 번들에 넣지 않는다)로 HTML 로 바꿔
 * `iframe srcdoc` 에 넣는다. sandbox="" (allow-scripts·allow-same-origin 없음): 문서 HTML 이 앱 DOM·출처에 닿지 않는다
 */
export function DocxPreview({ url, title }: { url: string; title: string }) {
  const [state, setState] = useState<DocxState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let isCancelled = false
    setState({ status: 'loading' })
    const show = (next: DocxState) => !isCancelled && setState(next)
    ;(async () => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const announced = Number(response.headers.get('content-length'))
      if (announced > DOCX_PREVIEW_LIMIT_BYTES) {
        show({ status: 'too-large', size: announced })
        controller.abort()
        return
      }
      const [buffer, mammoth] = await Promise.all([response.arrayBuffer(), import('mammoth')])
      if (buffer.byteLength > DOCX_PREVIEW_LIMIT_BYTES) {
        show({ status: 'too-large', size: buffer.byteLength })
        return
      }
      const result = await mammoth.default.convertToHtml({ arrayBuffer: buffer })
      show({ status: 'ready', srcdoc: docxSrcdoc(result.value) })
    })().catch(() => show({ status: 'failed' }))
    return () => {
      isCancelled = true
      controller.abort()
    }
  }, [url])

  if (state.status === 'loading') return <p className="hint">Loading…</p>
  if (state.status === 'failed') return <p className="hint ws-error">Couldn't open the document</p>
  if (state.status === 'too-large') {
    return (
      <p className="hint">
        Too large to preview · {formatSize(state.size)} (limit {DOCX_PREVIEW_LIMIT_BYTES / 1024 ** 2} MB)
      </p>
    )
  }
  return (
    <div className="ws-frame">
      <iframe className="ws-doc-frame" srcDoc={state.srcdoc} sandbox="" title={title} />
    </div>
  )
}
