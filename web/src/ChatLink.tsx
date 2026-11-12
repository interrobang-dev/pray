import { createContext, useContext, type KeyboardEvent, type ReactNode } from 'react'
import { defaultUrlTransform } from 'react-markdown'
import { ChatImageSession, MarkdownSource } from './ChatImage'
import { localHtmlPath, localLinkPath, rawLinkUrl } from './chatLinkUrl'
import { useOpenPathProps } from './ChatPath'
import { alertDialog } from './Dialog'

/** 이 PC 에서 연 화면인지 (`/api/auth/me` 의 isLocal, main.tsx 가 준다). 로컬 .html 링크는 이 PC 에서만 Chrome 으로 연다 */
export const IsLocalPage = createContext(false)

interface Props {
  /** 마크다운 원문에서 이 링크 자리 (react-markdown 이 넘긴 hast node 의 position) */
  start?: number
  end?: number
  /** 파서가 준 주소. 대화 urlTransform 이 지우지 않고 넘기므로 보통 링크는 여기서 기본 변환을 한다 */
  href?: string
  title?: string
  children?: ReactNode
}

async function openInChrome(sessionId: string, path: string) {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/open-in-chrome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    if (response.ok) return
    const { message } = (await response.json().catch(() => ({}))) as { message?: string }
    void alertDialog(`Couldn't open in Chrome: ${message ?? `HTTP ${response.status}`}`)
  } catch {
    void alertDialog("Couldn't open in Chrome: Network error")
  }
}

/**
 * 대화 마크다운의 a: 이 PC 의 .html 파일 링크면 누를 때 서버가 이 PC 의 Chrome 으로 연다 (브라우저는 http 페이지에서 로컬 파일을 못 연다).
 * 다른 PC 화면·세션을 모르는 곳은 흐리게 보이고 눌러도 아무것도 안 한다. .html 이 아닌 이 PC 경로 링크는 경로 열기(ChatPath.tsx),
 * 그 밖의 링크는 기본 변환한 주소로 새 탭 (지금까지와 같다).
 * 로컬 링크는 href 가 없는 a 라 키보드는 tabIndex·Enter 로 받는다
 */
export function ChatLink({ start, end, href, title, children }: Props) {
  const sessionId = useContext(ChatImageSession)
  const markdown = useContext(MarkdownSource)
  const isLocal = useContext(IsLocalPage)
  const raw = rawLinkUrl(markdown, start, end, href ?? '')
  const path = localHtmlPath(raw)
  // .html 이 아닌 이 PC 경로 링크: 대화 속 경로처럼 연다 (Files 탭·작업 파일 창·탐색기. 세션을 모르는 곳은 보통 링크로 둔다)
  const openProps = useOpenPathProps(path === null ? localLinkPath(raw) : null)
  if (openProps) {
    return (
      <a className="local-link is-openable" {...openProps}>
        {children}
      </a>
    )
  }
  if (path === null) {
    return (
      <a href={defaultUrlTransform(href ?? '')} title={title} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  if (!isLocal || sessionId === null) {
    return (
      <a className="local-link is-disabled" aria-disabled="true" title={isLocal ? path : 'Opens in Chrome only on this PC'}>
        {children}
      </a>
    )
  }
  const open = () => void openInChrome(sessionId, path)
  const openByKey = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    open()
  }
  return (
    <a className="local-link" role="link" tabIndex={0} title={`Open in Chrome · ${path}`} onClick={open} onKeyDown={openByKey}>
      {children}
    </a>
  )
}
