import { memo } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { CopyButton } from './CopyButton'
import { codeBlockText, type HastNode } from './codeText'
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

/** 마크다운 글 (대화 탭의 claude 응답·팀장↔팀원 지시·보고, 작업 파일 미리보기). raw HTML 은 react-markdown 기본값대로 글자로 보인다 (rehype-raw 안 씀).
 *  isChat: 대화(claude 답·작업 묶음 설명 글·지시 말풍선·곁가지 질문 답·설정 창 미리보기)일 때만 숫자·경로 강조. 작업 파일 미리보기는 끈다.
 *  memo: 입력칸에 칠 때마다 대화 전체를 다시 파싱하지 않게 */
export const MarkdownText = memo(function MarkdownText({ text, isChat = false }: { text: string; isChat?: boolean }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={isChat ? REHYPE_CHAT_PLUGINS : REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
})
