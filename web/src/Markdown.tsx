import { memo } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { CopyButton } from './CopyButton'
import { codeBlockText, type HastNode } from './codeText'

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm]
// 언어가 표시된 코드 블록만 칠한다. 자동 추측(detect)은 엉뚱한 언어로 칠하기 쉬워 끈다
const REHYPE_PLUGINS: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false }]]
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
 *  memo: 입력칸에 칠 때마다 대화 전체를 다시 파싱하지 않게 */
export const MarkdownText = memo(function MarkdownText({ text }: { text: string }) {
  return (
    <div className="markdown">
      <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MARKDOWN_COMPONENTS}>
        {text}
      </Markdown>
    </div>
  )
})
