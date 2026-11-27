import { useCallback, useEffect, useState } from 'react'
import { formatSize } from './Files'
import type { HwpDocument } from './hwpDocument'
import { PagedView, type DrawPage, type PageSize } from './PagedView'
import { HWP_PREVIEW_LIMIT_BYTES } from './pageLayout'

type HwpState =
  | { status: 'loading' }
  | { status: 'ready'; doc: HwpDocument; pageCount: number; firstSize: PageSize }
  | { status: 'too-large'; size: number }
  | { status: 'password' }
  | { status: 'failed' }

/** 첫 쪽 크기를 모를 때 자리 (A4 세로, 96dpi px) */
const A4_SIZE: PageSize = { width: 793.7, height: 1122.5 }

/**
 * Files 탭 hwp·hwpx 미리보기 (폰·데스크톱 같다). `/file/raw` 로 받아 rhwp(처음 그릴 때만 동적 import, wasm 은 같은 출처)로
 * 쪽마다 SVG 를 만들어 `<img>`(blob 주소)로 보인다 — SVG 안 스크립트가 돌지 않고 바깥 주소를 부르지 않는다. 앱 DOM 에 innerHTML 로 넣지 않는다
 */
export function HwpPreview({ url }: { url: string }) {
  const [state, setState] = useState<HwpState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    let isCancelled = false
    // 보이는 문서는 이 effect 가 끝날 때(다른 파일·↻·닫기) 놓는다. 그 뒤 미뤄 둔 쪽 그리기가 불러도 drawPage 의 try 가 받는다
    let shownDoc: HwpDocument | null = null
    setState({ status: 'loading' })
    const show = (next: HwpState) => !isCancelled && setState(next)
    ;(async () => {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const announced = Number(response.headers.get('content-length'))
      if (announced > HWP_PREVIEW_LIMIT_BYTES) {
        show({ status: 'too-large', size: announced })
        controller.abort()
        return
      }
      const [buffer, hwp] = await Promise.all([response.arrayBuffer(), import('./hwpDocument')])
      if (buffer.byteLength > HWP_PREVIEW_LIMIT_BYTES) {
        show({ status: 'too-large', size: buffer.byteLength })
        return
      }
      if (isCancelled) return
      const doc = await hwp.openHwp(new Uint8Array(buffer))
      const pageCount = doc.pageCount()
      // 이미 다른 파일로 넘어갔으면 바로 놓는다
      if (isCancelled || pageCount < 1) {
        doc.free()
        if (pageCount < 1) throw new Error('No pages')
        return
      }
      shownDoc = doc
      show({ status: 'ready', doc, pageCount, firstSize: hwp.pageSizeOf(doc, 0) ?? A4_SIZE })
    })()
      // rhwp 는 암호 문서를 "비밀번호가 필요한 암호 문서입니다 …" 오류로 알린다 (0.9.1 실측. 암호를 묻지 않는다)
      .catch((error: unknown) => show(/비밀번호|password/i.test(String(error instanceof Error ? error.message : error)) ? { status: 'password' } : { status: 'failed' }))
    return () => {
      isCancelled = true
      controller.abort()
      shownDoc?.free()
    }
  }, [url])

  if (state.status === 'loading') return <p className="hint">Loading…</p>
  if (state.status === 'failed') return <p className="hint ws-error">Couldn't open the document</p>
  if (state.status === 'password') return <p className="hint">Password-protected document · No preview</p>
  if (state.status === 'too-large') {
    return (
      <p className="hint">
        Too large to preview · {formatSize(state.size)} (limit {HWP_PREVIEW_LIMIT_BYTES / 1024 ** 2} MB)
      </p>
    )
  }
  return <HwpPages doc={state.doc} pageCount={state.pageCount} firstSize={state.firstSize} />
}

function HwpPages({ doc, pageCount, firstSize }: { doc: HwpDocument; pageCount: number; firstSize: PageSize }) {
  // SVG 는 늘려도 선명해 확대·폭이 바뀌어도 다시 만들지 않는다. 쪽마다 따로 미뤄 만들어 한 번에 화면을 오래 잡지 않는다
  const drawPage = useCallback<DrawPage>(
    ({ pageNumber, holder, onSize }) => {
      let isCancelled = false
      let blobUrl: string | null = null
      const timer = window.setTimeout(() => {
        try {
          const svg = doc.renderPageSvg(pageNumber - 1)
          blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        } catch {
          return
        }
        const image = new Image()
        image.alt = ''
        image.draggable = false
        image.src = blobUrl
        image
          .decode()
          .then(() => {
            if (isCancelled) return
            if (image.naturalWidth > 0 && image.naturalHeight > 0) onSize({ width: image.naturalWidth, height: image.naturalHeight })
            holder.replaceChildren(image)
          })
          .catch(() => {})
          .finally(() => {
            // 읽어 들인 그림은 주소를 놓아도 남는다 (확대해도 다시 받지 않는다)
            if (blobUrl) URL.revokeObjectURL(blobUrl)
          })
      }, 0)
      return () => {
        isCancelled = true
        window.clearTimeout(timer)
      }
    },
    [doc],
  )
  return <PagedView pageCount={pageCount} firstSize={firstSize} drawPage={drawPage} isScalable />
}
