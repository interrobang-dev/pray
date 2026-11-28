import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { contextMenuPosition } from './treeMenu'

/** 항목. 'separator' 는 구분선, isDisabled 는 흐리게 두고 누를 수 없다 (이유는 title) */
export type ContextMenuItem = { label: string; onSelect: () => void; isDisabled?: boolean; title?: string } | 'separator'

/** 길게 누른 손가락을 떼며 메뉴 첫 줄이 눌리지 않게, 연 뒤 이만큼은 누르기를 무시한다 */
const OPEN_CLICK_GUARD_MS = 300

/**
 * 마우스 자리(x, y)에 뜨는 `.menu-list` 메뉴 (Files 탭 트리 우클릭). body 에 portal 로 그려 Files 탭의 overflow·container 에 안 갇히고,
 * 화면 밖으로 넘치지 않게 그린 뒤 크기를 재 자리를 맞춘다. 바깥 mousedown·Esc(캡처 단계, 전파를 멈춘다)·스크롤·창 크기 변경으로 닫힌다.
 * 줄을 누르면 메뉴를 닫고 그 클릭 안에서 바로 onSelect 를 부른다 (복사가 사용자 동작 안이어야 해서 — CopyMenu 와 같다)
 */
export function ContextMenu({ x, y, label, items, onClose }: { x: number; y: number; label: string; items: ContextMenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement>(null)
  const openedAt = useRef(performance.now())
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { left, top } = contextMenuPosition({ x, y }, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight })
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    menu.style.visibility = 'visible'
  }, [x, y])

  useEffect(() => {
    const close = () => onCloseRef.current()
    const onDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [])

  return createPortal(
    <div
      ref={menuRef}
      className="menu-list context-menu"
      role="menu"
      aria-label={label}
      style={{ visibility: 'hidden' }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item === 'separator' ? (
          <hr key={`separator-${index}`} className="menu-separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.isDisabled}
            title={item.title}
            onClick={() => {
              if (performance.now() - openedAt.current < OPEN_CLICK_GUARD_MS) return
              onCloseRef.current()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  )
}
