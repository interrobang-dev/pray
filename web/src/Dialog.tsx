import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { cancelAnswer, createDialogQueue, type DialogAnswer, type DialogChoice, type DialogRequest } from './dialogQueue'

/**
 * 브라우저 기본 confirm·alert·prompt 대신 앱 안에 그리는 대화 창 (트레이 앱 창에서 기본 창은 꾸밀 수 없고 "127.0.0.1:4710 says" 가 붙는다).
 * 어디서든 부르고 Promise 로 답을 받는다. 그리는 곳은 main.tsx 가 한 번 마운트한 DialogHost 하나다
 */
const queue = createDialogQueue()

export function confirmDialog(
  message: string,
  options: { title?: string; confirmLabel?: string; cancelLabel?: string; isDanger?: boolean } = {},
): Promise<boolean> {
  return queue.open('confirm', message, options).then((answer) => answer === true)
}

export function alertDialog(message: string, options: { title?: string } = {}): Promise<void> {
  return queue.open('alert', message, options).then(() => undefined)
}

/** 취소면 null (브라우저 prompt 와 같다) */
export function promptDialog(
  message: string,
  options: { defaultValue?: string; placeholder?: string; confirmLabel?: string } = {},
): Promise<string | null> {
  return queue.open('prompt', message, options).then((answer) => (typeof answer === 'string' ? answer : null))
}

/**
 * 둘보다 많은 길 중 고르기 (예: Overwrite · Reload). 고른 선택지의 value, 취소(Esc·바깥 클릭·Cancel)면 null.
 * 처음 포커스는 Cancel 이다 (Enter 한 번에 덮어쓰기 같은 것이 되지 않게)
 */
export function choiceDialog(message: string, options: { title?: string; choices: DialogChoice[]; cancelLabel?: string }): Promise<string | null> {
  return queue.open('choice', message, options).then((answer) => (typeof answer === 'string' ? answer : null))
}

export function DialogHost() {
  const request = useSyncExternalStore(queue.subscribe, queue.current)
  // key: 차례로 뜨는 다음 창은 새로 마운트해 포커스·입력값을 처음부터 잡는다
  return request ? <DialogBox key={request.id} request={request} /> : null
}

function DialogBox({ request }: { request: DialogRequest }) {
  const { id, kind, message, title, isDanger } = request
  const titleId = useId()
  const messageId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const [value, setValue] = useState(request.defaultValue ?? '')
  // 닫으면 포커스를 돌려줄 곳. 렌더 때 한 번만 잡는다 (StrictMode 가 effect 를 두 번 돌려도 그대로)
  const [returnFocus] = useState(() => document.activeElement)
  const valueRef = useRef(value)
  valueRef.current = value

  const close = (answer: DialogAnswer) => queue.close(id, answer)
  const cancel = () => close(cancelAnswer(kind))
  const accept = () => close(kind === 'prompt' ? valueRef.current : true)

  useLayoutEffect(() => {
    if (kind === 'prompt') {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else (isDanger || kind === 'choice' ? cancelRef : confirmRef).current?.focus()
    return () => {
      if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [kind, isDanger, returnFocus])

  // window 캡처 단계에서 키를 먼저 받아 멈춘다: 밑에 열린 Modal·메뉴·사용량 창의 Esc, 대화 탭 숫자 키 같은 다른 단축키가 반응하지 않게.
  // 막는 것은 전파뿐이라 입력칸 글자 입력·한글 조합은 그대로다
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.isComposing || event.keyCode === 229) return
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        // 포커스가 취소 버튼이면 취소 (isDanger 는 취소 버튼에서 시작해 Enter 한 번에 지워지지 않는다). choice 는 포커스한 선택지
        const active = document.activeElement
        if (active === cancelRef.current) cancel()
        else if (kind === 'choice') {
          if (active instanceof HTMLElement && active.dataset.choice !== undefined) close(active.dataset.choice)
        } else accept()
      } else if (event.key === 'Tab') trapTab(event)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  /** Tab 이 창 밖으로 나가지 않게 처음·끝에서 돈다 */
  function trapTab(event: KeyboardEvent) {
    const focusables = [...(boxRef.current?.querySelectorAll<HTMLElement>('button, input') ?? [])]
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    const isInside = active instanceof Node && Boolean(boxRef.current?.contains(active))
    if (!isInside || (event.shiftKey && active === first)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // 바깥 클릭 = 취소. 창 안팎 모두 mousedown 전파를 멈춰 사용량 창·⋯ 메뉴·Shells 창이 바깥 클릭으로 닫히지 않게 한다.
  // 바깥 클릭은 기본 동작도 막는다 — 안 막으면 돌려준 포커스를 브라우저가 곧바로 body 로 옮긴다
  function onOverlayMouseDown(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    cancel()
  }

  return (
    <div className="modal-overlay dialog-overlay" onMouseDown={onOverlayMouseDown}>
      <div
        ref={boxRef}
        className="modal dialog"
        role={kind === 'prompt' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={title ? titleId : messageId}
        aria-describedby={title ? messageId : undefined}
      >
        {title && (
          <div className="modal-title">
            <b id={titleId}>{title}</b>
          </div>
        )}
        <p id={messageId} className="dialog-message">
          {message}
        </p>
        {kind === 'prompt' && (
          <input
            ref={inputRef}
            value={value}
            placeholder={request.placeholder}
            aria-labelledby={messageId}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <div className="dialog-actions">
          {kind !== 'alert' && (
            <button ref={cancelRef} type="button" onClick={cancel}>
              {request.cancelLabel ?? 'Cancel'}
            </button>
          )}
          {kind === 'choice' ? (
            request.choices?.map((choice) => (
              <button key={choice.value} type="button" data-choice={choice.value} className={choice.isDanger ? 'danger' : 'primary'} onClick={() => close(choice.value)}>
                {choice.label}
              </button>
            ))
          ) : (
            <button ref={confirmRef} type="button" className={isDanger ? 'danger' : 'primary'} onClick={accept}>
              {request.confirmLabel ?? 'OK'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
