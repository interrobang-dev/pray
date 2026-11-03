import { createContext, useContext, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { chatImageTarget, imageFileName, rawImageUrl } from './chatImageUrl'
import { Modal } from './Modal'

/** 대화 속 그림·로컬 .html 링크(ChatLink)가 서버에 물을 세션 ID (Chat 이 대화 목록·곁가지 질문 카드에 준다). 없으면 이 PC 파일 그림은 실패 카드, 링크는 흐림 */
export const ChatImageSession = createContext<string | null>(null)
/** 지금 그리는 마크다운 원문 (MarkdownText 가 준다). 그림 주소를 원문 그대로 꺼내려고 — 파서는 `\@` 같은 경로 글자를 이스케이프로 먹는다 */
export const MarkdownSource = createContext<string | null>(null)

interface Props {
  /** 마크다운 원문에서 이 그림 자리 (react-markdown 이 넘긴 hast node 의 position) */
  start?: number
  end?: number
  /** 파서가 준 주소 (원문에서 못 꺼낼 때만 쓴다) */
  src?: string
  alt?: string
}

/**
 * 대화 마크다운의 img: 말풍선 폭에 맞춘 그림 + 아래 작은 설명(alt, 없으면 파일 이름).
 * 불러오는 중엔 자리 잡힌 회색 칸, 실패하면 "Image not available · a.png" 카드, 누르면 크게 보기.
 * 요소는 모두 span·button 이다 — 마크다운 그림은 <p> 안에 들어가서 div 를 쓰면 HTML 구조가 틀린다
 */
export function ChatImage({ start, end, src, alt }: Props) {
  const sessionId = useContext(ChatImageSession)
  const markdown = useContext(MarkdownSource)
  const raw = rawImageUrl(markdown, start, end, src ?? '')
  const target = chatImageTarget(raw, sessionId)
  const name = imageFileName(raw)
  const caption = alt?.trim() || name
  // 주소별로 기억해 그림이 바뀌면 다시 "불러오는 중" 이다
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const fullName = target.path ?? raw

  if (!target.src || failedSrc === target.src) {
    return (
      <span className="chat-image-missing" title={fullName}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" />
          <path d="M3.5 11.5l3-3.5 2.5 2.5 1.5-1.5 2 2.5" fill="none" stroke="currentColor" strokeLinejoin="round" />
          <path d="M2 14L14 2" stroke="currentColor" />
        </svg>
        <span>
          Image not available · <span className="chat-image-name">{name}</span>
        </span>
      </span>
    )
  }

  const isLoaded = loadedSrc === target.src
  const open = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsOpen(true)
  }
  return (
    <span className={`chat-image${isLoaded ? '' : ' is-loading'}`}>
      <button type="button" className="chat-image-frame" onClick={open} title={fullName} aria-label={`View image: ${caption}`}>
        <img src={target.src} alt={caption} onLoad={() => setLoadedSrc(target.src)} onError={() => setFailedSrc(target.src)} />
      </button>
      <span className="chat-image-caption">{caption}</span>
      {isOpen &&
        createPortal(
          // React 이벤트는 portal 에서도 React 트리를 따라 올라가 말풍선·묶음의 클릭으로 가지 않게 막는다
          <div className="image-viewer-root" onClick={(event) => event.stopPropagation()}>
            <Modal title={caption} subtitle={fullName} onClose={() => setIsOpen(false)} className="image-viewer" hasCloseButton>
              <div className="image-viewer-body">
                <img src={target.src} alt={caption} />
              </div>
              <div className="image-viewer-foot">
                <a href={target.src} target="_blank" rel="noreferrer">
                  Open original
                </a>
              </div>
            </Modal>
          </div>,
          document.body,
        )}
    </span>
  )
}
