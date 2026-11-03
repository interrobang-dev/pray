import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
}

/** Claude Code 입력창의 줄바꿈 키 값. Alt+Enter 와 같고, /terminal-setup 이 VS Code 의 Shift+Enter 에 넣는 값과 같다 */
export const NEWLINE_KEYS = '\x1b\r'

export function Terminal({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new XTerm({ convertEol: false, fontSize: 13, scrollback: 5000 })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    const post = (path: string, body: unknown) =>
      fetch(`/api/sessions/${sessionId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    // 한글 조합 중 Shift+Enter 는 조합 확정 글자(xterm 이 compositionend 뒤 onData 로 보낸다)가 나간 직후에 줄바꿈을 보낸다.
    // 바로 보내면 마지막 글자가 줄바꿈 뒤로 간다
    let isNewlinePending = false
    // 조합을 확정한 Enter 가 아직 눌려 있음. macOS 꼴은 확정 뒤 같은 Enter 의 keydown 이 한 번 더 온다
    let isComposedEnterDown = false
    let newlineFallbackTimer: ReturnType<typeof setTimeout> | undefined
    const flushNewline = () => {
      clearTimeout(newlineFallbackTimer)
      if (!isNewlinePending) return
      isNewlinePending = false
      void post('input', { data: NEWLINE_KEYS, isTerminal: true })
    }
    term.onData((data) => {
      void post('input', { data, isTerminal: true })
      flushNewline()
    })
    // xterm.js 는 Shift+Enter 도 Enter 와 같은 \r 을 보내 Claude Code 가 제출로 받는다. 줄바꿈 값으로 바꿔 보낸다
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.type === 'keyup') isComposedEnterDown = false
      // 실제 Chrome 은 조합 중 Enter keydown 을 key "Process"·code "Enter"·keyCode 229 로 보낸다
      const isShiftEnter = (event.key === 'Enter' || event.code === 'Enter') && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
      if (!isShiftEnter) return true
      // textarea 에 \n 이 들어가면 xterm 이 조합 확정 글자와 같이 "녕\n" 으로 보낸다
      if (event.type === 'keypress') event.preventDefault()
      if (event.type !== 'keydown') return false
      if (event.isComposing || event.keyCode === 229) {
        isNewlinePending = true
        isComposedEnterDown = true
        newlineFallbackTimer = setTimeout(flushNewline, 100)
        return false
      }
      event.preventDefault()
      // 꾹 눌러 반복되는 keydown 은 보낸다
      if (isComposedEnterDown && !event.repeat) return false
      void post('input', { data: NEWLINE_KEYS, isTerminal: true })
      return false
    })
    term.onResize(({ cols, rows }) => void post('resize', { cols, rows }))
    void post('resize', { cols: term.cols, rows: term.rows })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(container)

    const source = new EventSource(`/api/sessions/${sessionId}/stream`)
    const dataOf = (event: Event) => JSON.parse((event as MessageEvent).data) as string
    source.addEventListener('snapshot', (event) => {
      term.reset()
      term.write(dataOf(event))
    })
    source.addEventListener('output', (event) => term.write(dataOf(event)))
    source.addEventListener('exit', (event) => term.write(`\r\n[Session ended: ${dataOf(event)}]\r\n`))
    source.addEventListener('error', (event) => {
      if ((event as MessageEvent).data) term.write(`\r\n[Error: ${dataOf(event)}]\r\n`)
    })

    return () => {
      clearTimeout(newlineFallbackTimer)
      source.close()
      observer.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className="terminal" />
}
