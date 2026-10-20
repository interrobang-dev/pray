import { useEffect, type ReactNode } from 'react'

interface Props {
  title: string
  /** 제목 아래 작은 보조 설명 (폴더 경로 등) */
  subtitle?: string
  onClose: () => void
  children: ReactNode
}

/** 오버레이 + 대화상자. Esc 또는 바깥 클릭으로 닫힌다 */
export function Modal({ title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title">
          <b>{title}</b>
          {subtitle && <span className="cwd">{subtitle}</span>}
        </div>
        {children}
      </div>
    </div>
  )
}

interface SegmentedProps<T extends string> {
  value: T
  options: { value: T; label: string; isDisabled?: boolean; hint?: string }[]
  onChange: (value: T) => void
}

/** 세그먼트 컨트롤: 서로 배타적인 선택지 몇 개를 한 줄 버튼 묶음으로 */
export function Segmented<T extends string>({ value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={option.value === value ? 'on' : ''}
          disabled={option.isDisabled}
          title={option.hint}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
