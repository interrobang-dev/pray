import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface Props {
  sessionId: string
}

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

    term.onData((data) => void post('input', { data }))
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
    source.addEventListener('exit', (event) => term.write(`\r\n[세션 종료: ${dataOf(event)}]\r\n`))
    source.addEventListener('error', (event) => {
      if ((event as MessageEvent).data) term.write(`\r\n[오류: ${dataOf(event)}]\r\n`)
    })

    return () => {
      source.close()
      observer.disconnect()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className="terminal" />
}
