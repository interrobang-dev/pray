import { createContext, useContext, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChatImageSession } from './ChatImage'
import { inlineCodeTarget, isOpenablePath } from './chatPathTarget'
import { openInChrome } from './openPath'

/** 이 PC 에서 연 화면인지 (`/api/auth/me` 의 isLocal, main.tsx 가 준다). 대화 속 .html 링크·경로는 이 PC 에서만 Chrome 으로 연다 */
export const IsLocalPage = createContext(false)

/**
 * 대화 속 경로를 누르면 부를 함수 (Chat 이 대화 목록에만 준다). 없으면(곁가지 질문 카드·설정 창 미리보기·세션을 모름) 경로는 눌리지 않는다
 */
export const OpenChatPath = createContext<((path: string) => void) | null>(null)

/** 인라인 코드를 열 수 있는 자리인지 (Markdown.tsx 가 코드 블록 pre·링크 a 안에서 false 로 준다) */
export const IsPlainInlineCode = createContext(true)

/**
 * 누르면 열리는 요소에 붙일 것: 링크 역할·키보드(Enter)·title. 열 수 없으면 null.
 * .html·.htm 경로는 이 PC 화면이면 Chrome 으로 연다 (작업 폴더·임시 폴더 밖이라 서버가 404 면 보통 경로 열기로). 다른 PC 는 보통 경로 열기
 */
export function useOpenPathProps(path: string | null) {
  const open = useContext(OpenChatPath)
  const isLocal = useContext(IsLocalPage)
  const sessionId = useContext(ChatImageSession)
  if (open === null || path === null) return null
  const chromeSession = isLocal && sessionId !== null && /\.html?$/i.test(path) ? sessionId : null
  const run = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault()
    // 말풍선·작업 묶음의 클릭(여닫기·점프)으로 올라가지 않게
    event.stopPropagation()
    if (chromeSession !== null) void openInChrome(chromeSession, path, () => open(path))
    else open(path)
  }
  return {
    role: 'link' as const,
    tabIndex: 0,
    title: chromeSession !== null ? `Open in Chrome · ${path}` : `Open ${path}`,
    onClick: (event: MouseEvent) => {
      // 글자를 끌어 고르는 중이면 열지 않는다 (경로를 복사하려는 것)
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.anchorNode && event.currentTarget.contains(selection.anchorNode)) return
      run(event)
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === 'Enter') run(event)
    },
  }
}

/** 숫자·경로 강조의 `<span class="path">`: 열 수 있는 꼴(드라이브 절대·cwd 상대)이면 눌린다. 색은 경로 색 그대로 */
export function ChatPathSpan({ children }: { children?: ReactNode }) {
  const text = typeof children === 'string' ? children : null
  const props = useOpenPathProps(text !== null && isOpenablePath(text) ? text : null)
  if (!props) return <span className="path">{children}</span>
  return (
    <span className="path is-openable" {...props}>
      {children}
    </span>
  )
}

/** 인라인 코드: 전체가 http(s) URL 이면 새 탭 링크, 전체가 한 경로면 눌러 연다. 코드 칩 모양은 그대로다. 코드 블록·링크 안은 그대로 */
export function ChatInlineCode({ className, children }: { className?: string; children?: ReactNode }) {
  const isPlain = useContext(IsPlainInlineCode)
  const target = isPlain && typeof children === 'string' ? inlineCodeTarget(children) : null
  const props = useOpenPathProps(target?.kind === 'path' ? target.path : null)
  if (target?.kind === 'url') {
    return (
      <a href={target.url} target="_blank" rel="noopener noreferrer" className="code-link">
        <code className={className}>{children}</code>
      </a>
    )
  }
  if (!props) return <code className={className}>{children}</code>
  return (
    <code className={className ? `${className} is-openable` : 'is-openable'} {...props}>
      {children}
    </code>
  )
}
