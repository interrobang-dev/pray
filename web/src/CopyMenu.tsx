import { useEffect, useRef, useState } from 'react'
import { CopyStatusIcon, useCopyStatus } from './CopyButton'

export interface CopyMenuItem {
  label: string
  /** 줄의 툴팁 (무엇이 복사되는지, 막힌 이유) */
  title?: string
  isDisabled?: boolean
  /** 누르면 부른다. 성공하면 true — 버튼에 ✓·✕ 를 보인다 */
  copy: () => Promise<boolean>
}

/**
 * 복사 버튼 + 고르는 메뉴 (Files 탭 위 막대). 버튼은 `CopyButton` 과 같은 `.copy-button` 모양·✓·✕ 이고, 누르면 아래에 메뉴가 뜬다.
 * 바깥 누르기·Esc 로 닫는다. 줄을 누르면 메뉴를 닫고 그 복사를 한다 (클립보드 쓰기가 같은 클릭 안에서 일어나게 바로 부른다)
 */
export function CopyMenu({ label, items }: { label: string; items: CopyMenuItem[] }) {
  const [isOpen, setIsOpen] = useState(false)
  const { status, title: statusTitle, run } = useCopyStatus()
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setIsOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [isOpen])

  const title = statusTitle ?? label
  return (
    <span ref={rootRef} className={isOpen ? 'menu copy-menu open' : 'menu copy-menu'}>
      <button
        type="button"
        className="copy-button"
        data-status={status}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((previous) => !previous)}
      >
        <CopyStatusIcon status={status} />
      </button>
      {isOpen && (
        <div className="menu-list" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.isDisabled}
              title={item.title}
              onClick={() => {
                setIsOpen(false)
                void run(item.copy)
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
