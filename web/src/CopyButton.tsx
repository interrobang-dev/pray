import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { copyText } from './copyText'

export type CopyStatus = 'idle' | 'copied' | 'failed'

/** 성공·실패 표시를 보이는 시간 */
const STATUS_MS = 1500

const TITLES: Record<CopyStatus, string | null> = { idle: null, copied: 'Copied', failed: 'Copy failed' }

/** 복사 버튼 상태: run 에 복사 결과(성공 true)를 넘기면 1.5초 ✓·✕ 를 보인 뒤 idle 로. 언마운트 뒤에는 바꾸지 않는다 */
export function useCopyStatus(): { status: CopyStatus; title: string | null; run: (copy: () => Promise<boolean>) => Promise<void> } {
  const [status, setStatus] = useState<CopyStatus>('idle')
  const timerRef = useRef<number | undefined>(undefined)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      window.clearTimeout(timerRef.current)
    }
  }, [])

  const run = async (copy: () => Promise<boolean>) => {
    const isCopied = await copy()
    if (!isMountedRef.current) return
    setStatus(isCopied ? 'copied' : 'failed')
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setStatus('idle'), STATUS_MS)
  }
  return { status, title: TITLES[status], run }
}

/**
 * 복사 버튼 (아이콘만). 성공하면 1.5초 ✓, 실패하면 ✕. 상태는 버튼 안 state 라 대화 전체를 다시 그리지 않는다.
 * 눌러도 말풍선·details·부모 클릭은 일어나지 않는다. 자리는 부모가 CSS 로 정한다 (`.copy-button` 은 부모 안 직속)
 */
/** text 가 함수면 누를 때 부른다 (편집기에서 고른 줄처럼 그릴 때 정해 둘 수 없는 글) */
export function CopyButton({ text, label = 'Copy' }: { text: string | (() => string); label?: 'Copy' | 'Copy code' | 'Copy command' | 'Copy path' | 'Copy hash' }) {
  const { status, title: statusTitle, run } = useCopyStatus()

  const onClick = (event: MouseEvent) => {
    // summary 안에서 details 를 여닫지 않게, 말풍선·점프 같은 부모 동작도 막는다
    event.preventDefault()
    event.stopPropagation()
    void run(() => copyText(typeof text === 'function' ? text() : text))
  }

  const title = statusTitle ?? label
  return (
    <button type="button" className="copy-button" data-status={status} title={title} aria-label={title} onClick={onClick}>
      <CopyStatusIcon status={status} />
    </button>
  )
}

/** 상태에 맞는 아이콘: 겹친 사각형 · ✓ · ✕ */
export function CopyStatusIcon({ status }: { status: CopyStatus }) {
  return status === 'copied' ? <CheckIcon /> : status === 'failed' ? <FailedIcon /> : <CopyIcon />
}

const ICON_PROPS = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** 겹친 사각형 */
function CopyIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3A1.5 1.5 0 0 0 1.5 3v6A1.5 1.5 0 0 0 3 10.5h.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 8.5l3.2 3.2L13 4.8" />
    </svg>
  )
}

function FailedIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  )
}
