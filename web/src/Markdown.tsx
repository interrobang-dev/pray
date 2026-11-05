import { createContext, memo, useContext, type MouseEvent, type ReactNode } from 'react'
import Markdown, { defaultUrlTransform, type Components, type Options, type UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ChatImage, MarkdownSource } from './ChatImage'
import { ChatLink } from './ChatLink'
import { CopyButton } from './CopyButton'
import { codeBlockText, type HastNode } from './codeText'
import { docLinkKind, headingSlug } from './markdownDoc'
import { rehypeHighlightTokens } from './markdownHighlight'

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm]
// 언어가 표시된 코드 블록만 칠한다. 자동 추측(detect)은 엉뚱한 언어로 칠하기 쉬워 끈다
const REHYPE_PLUGINS: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false }]]
// 대화에서만: 일반 글의 숫자·파일 경로를 span 으로 나눈다 (Chat 탭 Colors 의 Numbers·Paths 스위치는 CSS 가 색을 끄고 켠다 — 플러그인을 끄면 memo 된 모든 말풍선을 다시 파싱해서)
const REHYPE_CHAT_PLUGINS: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false }], rehypeHighlightTokens]
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, title, children }) => (
    <a href={href} title={title} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  // 복사 버튼은 스크롤하는 pre 가 아니라 그것을 감싼 상자에 둔다 — 가로 스크롤 중에도 제자리
  pre: ({ node, children }) => (
    <div className="code-block">
      <CopyButton text={codeBlockText(node as HastNode | undefined)} label="Copy code" />
      <pre>{children}</pre>
    </div>
  ),
}

// 대화에서만: img 는 ChatImage 가 이 PC 파일 경로를 서버 그림 API 로 바꾸고, a 는 ChatLink 가 이 PC 의 .html 링크를 Chrome 으로 연다 (작업 파일 미리보기는 그대로)
const CHAT_MARKDOWN_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  img: ({ node, src, alt }) => (
    <ChatImage start={node?.position?.start.offset} end={node?.position?.end.offset} src={typeof src === 'string' ? src : undefined} alt={alt} />
  ),
  a: ({ node, href, title, children }) => (
    <ChatLink start={node?.position?.start.offset} end={node?.position?.end.offset} href={href} title={title}>
      {children}
    </ChatLink>
  ),
}
// 대화에서만: img src·a href 는 기본 변환이 `C:`·`file:` 을 모르는 프로토콜로 보고 지우므로 그대로 넘긴다 (ChatImage 는 http(s)·data:image·서버 그림 API 밖은 쓰지 않고,
// ChatLink 는 이 PC .html 이 아니면 기본 변환을 해서 쓴다). 나머지는 기본 그대로
const chatUrlTransform: UrlTransform = (url, key, node) =>
  (node.tagName === 'img' && key === 'src') || (node.tagName === 'a' && key === 'href') ? url : defaultUrlTransform(url)

/** 마크다운 글 (대화 탭의 claude 응답·팀장↔팀원 지시·보고, 작업 파일 미리보기). raw HTML 은 react-markdown 기본값대로 글자로 보인다 (rehype-raw 안 씀).
 *  isChat: 대화(claude 답·작업 묶음 설명 글·지시 말풍선·곁가지 질문 답·설정 창 미리보기)일 때만 숫자·경로 강조와 대화 그림(ChatImage). 작업 파일 미리보기는 끈다.
 *  memo: 입력칸에 칠 때마다 대화 전체를 다시 파싱하지 않게 */
export const MarkdownText = memo(function MarkdownText({ text, isChat = false }: { text: string; isChat?: boolean }) {
  if (!isChat) {
    return (
      <div className="markdown">
        <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {text}
        </Markdown>
      </div>
    )
  }
  return (
    <div className="markdown">
      <MarkdownSource.Provider value={text}>
        <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_CHAT_PLUGINS} components={CHAT_MARKDOWN_COMPONENTS} urlTransform={chatUrlTransform}>
          {text}
        </Markdown>
      </MarkdownSource.Provider>
    </div>
  )
})

/** Files 탭 md 미리보기가 주는 것: 그림 주소 바꾸기(그리지 않으면 null)와 세션 폴더 안 파일 링크 열기 */
export interface DocLinks {
  imageUrl: (src: string) => string | null
  openFile: (href: string) => void
}

const DocLinksContext = createContext<DocLinks | null>(null)

/** 문서 그림: 바꾼 주소로 그리고, 그릴 수 없는 주소(이 PC 절대 경로·폴더 밖)는 대체 글만 흐리게 */
function DocImage({ src, alt, title }: { src?: string; alt?: string; title?: string }) {
  const links = useContext(DocLinksContext)
  const url = src && links ? links.imageUrl(src) : null
  if (!url) return <span className="md-doc-no-image" title={src ? `Can't show ${src}` : undefined}>{alt || src}</span>
  return <img src={url} alt={alt} title={title} loading="lazy" />
}

/** 문서 링크: 웹 주소는 새 탭, `#제목` 은 그 제목으로 스크롤, 세션 폴더 안 상대 경로는 Files 에서 연다. 그 밖은 아무것도 하지 않는다 */
function DocLink({ href, title, children }: { href?: string; title?: string; children?: ReactNode }) {
  const links = useContext(DocLinksContext)
  const kind = href ? docLinkKind(href) : 'other'
  if (kind === 'external') {
    return (
      <a href={href} title={title} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    if (!href) return
    if (kind === 'file') links?.openFile(href)
    else if (kind === 'anchor') scrollToHeading(event.currentTarget, decodeURIComponentSafe(href.slice(1)))
  }
  return (
    <a href={kind === 'other' ? undefined : href} title={title ?? (kind === 'file' ? `Open ${href} in Files` : undefined)} onClick={onClick}>
      {children}
    </a>
  )
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** 같은 문서에서 slug 가 맞는 제목으로 문서 칸만 스크롤한다 (scrollIntoView 는 overflow hidden 인 패널까지 움직여서). 같은 제목이 여럿이면 GitHub 처럼 -1, -2 */
function scrollToHeading(from: HTMLElement, slug: string) {
  const scroller = from.closest<HTMLElement>('.md-doc')
  if (!scroller) return
  const counts = new Map<string, number>()
  for (const heading of scroller.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')) {
    const base = headingSlug(heading.textContent ?? '')
    const count = counts.get(base) ?? 0
    counts.set(base, count + 1)
    if ((count === 0 ? base : `${base}-${count}`) !== slug.toLowerCase()) continue
    scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12
    return
  }
}

const DOC_MARKDOWN_COMPONENTS: Components = {
  ...MARKDOWN_COMPONENTS,
  img: ({ src, alt, title }) => <DocImage src={typeof src === 'string' ? src : undefined} alt={alt} title={title} />,
  a: ({ href, title, children }) => (
    <DocLink href={href} title={title}>
      {children}
    </DocLink>
  ),
}

/**
 * Files 탭 md 미리보기 (GitHub README 같은 문서 모양, 스크롤 칸 `.md-doc` 까지 그린다). 대화용 숫자·경로 강조는 없고 코드 블록 강조·복사 버튼은 같다.
 * links 는 그림·링크 처리 — 바뀔 때 글을 다시 파싱하지 않게 context 로 넘긴다 (memo 는 text 기준)
 */
export function MarkdownDocument({ text, links }: { text: string; links: DocLinks }) {
  return (
    <DocLinksContext.Provider value={links}>
      <div className="md-doc">
        <MarkdownDocumentBody text={text} />
      </div>
    </DocLinksContext.Provider>
  )
}

const MarkdownDocumentBody = memo(function MarkdownDocumentBody({ text }: { text: string }) {
  return (
    <div className="markdown md-doc-body">
      <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={DOC_MARKDOWN_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
})
