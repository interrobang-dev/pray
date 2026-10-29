/** 앱 안 대화 창(Dialog.tsx)의 대기열. 여러 개를 겹쳐 부르면 부른 차례로 하나씩 보인다 (화면은 맨 앞 것만 그린다) */

export type DialogKind = 'confirm' | 'alert' | 'prompt' | 'choice'

/** 고르기 창(choice)의 버튼 하나. 고르면 value 가 답이다 */
export interface DialogChoice {
  label: string
  value: string
  isDanger?: boolean
}

export interface DialogOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  isDanger?: boolean
  defaultValue?: string
  placeholder?: string
  /** choice 창의 버튼 (취소 오른쪽에 차례로) */
  choices?: DialogChoice[]
}

/** 닫을 때의 답: confirm 은 확인 여부, prompt 는 입력한 글·choice 는 고른 value(취소면 null), alert 는 무시 */
export type DialogAnswer = boolean | string | null

export interface DialogRequest extends DialogOptions {
  id: number
  kind: DialogKind
  message: string
}

interface Entry {
  request: DialogRequest
  resolve: (answer: DialogAnswer) => void
}

export interface DialogQueue {
  open(kind: DialogKind, message: string, options?: DialogOptions): Promise<DialogAnswer>
  /** 지금 보일 것 (없으면 null). 같은 것이면 같은 객체라 useSyncExternalStore 가 다시 그리지 않는다 */
  current(): DialogRequest | null
  /** 맨 앞 것이 그 id 일 때만 닫고 답을 넘긴다 (두 번 눌려도 한 번만) */
  close(id: number, answer: DialogAnswer): void
  subscribe(listener: () => void): () => void
}

export function createDialogQueue(): DialogQueue {
  const entries: Entry[] = []
  const listeners = new Set<() => void>()
  let nextId = 1
  const notify = () => listeners.forEach((listener) => listener())

  return {
    open(kind, message, options = {}) {
      return new Promise((resolve) => {
        entries.push({ request: { ...options, id: nextId++, kind, message }, resolve })
        notify()
      })
    },
    current: () => entries[0]?.request ?? null,
    close(id, answer) {
      if (entries[0]?.request.id !== id) return
      const [entry] = entries.splice(0, 1)
      notify()
      entry.resolve(answer)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** 취소(Esc·바깥 클릭·Cancel)의 답: confirm false, prompt·choice null */
export function cancelAnswer(kind: DialogKind): DialogAnswer {
  return kind === 'confirm' ? false : null
}
