import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Modal, Segmented } from './Modal'
import {
  blockReason,
  EFFORT_OPTIONS,
  initialChoice,
  isChanged,
  MODEL_OPTIONS,
  noticeLines,
  type EffortChoice,
  type ModelAlias,
} from './modelSetting'
import type { Session } from './types'

/** 다시 띄운다는 응답을 받은 뒤 "Restarting…" 을 보이는 시간. 호스트는 새 프로세스를 먼저 넣고 옛 프로세스를 내보내 세션이 휴식으로 보이지 않으므로, 상태를 따라가지 않고 claude 가 다시 뜨는 시간만큼만 보인다 */
const RESTARTING_DISPLAY_MS = 5_000

/** 모델·effort 를 바꿔 다시 띄우는 중인 세션 ID 모음 (칩 자리에 "Restarting…"). beginRestart 뒤 RESTARTING_DISPLAY_MS 가 지나면 빠진다 */
export function useRestartingSessions(): { restartingIds: ReadonlySet<string>; beginRestart: (sessionId: string) => void } {
  const [restartingIds, setRestartingIds] = useState<ReadonlySet<string>>(new Set())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const beginRestart = useCallback((sessionId: string) => {
    const previousTimer = timers.current.get(sessionId)
    if (previousTimer) clearTimeout(previousTimer)
    timers.current.set(
      sessionId,
      setTimeout(() => {
        timers.current.delete(sessionId)
        setRestartingIds((previous) => new Set([...previous].filter((id) => id !== sessionId)))
      }, RESTARTING_DISPLAY_MS),
    )
    setRestartingIds((previous) => new Set(previous).add(sessionId))
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  return { restartingIds, beginRestart }
}

interface Props {
  session: Session
  /** 대화 맨 끝에 대기 중인 메시지가 있는지 (Chat 이 알려 준다. 터미널 탭이면 모르므로 false — 서버가 다시 확인한다) */
  hasQueuedMessage: boolean
  onClose: () => void
  /** 200 이면 부른다. isRestarted 가 true 면 다시 뜨는 중 */
  onApplied: (isRestarted: boolean) => void
}

/** 웹 세션의 모델·effort 바꾸기 창: 고르고 [Apply] → PUT /api/sessions/:id/model */
export function ModelSettingModal({ session, hasQueuedMessage, onClose, onApplied }: Props) {
  const [initial] = useState(() => initialChoice(session))
  const [model, setModel] = useState<ModelAlias | null>(initial.model)
  const [effort, setEffort] = useState<EffortChoice>(initial.effort)
  const [isApplying, setIsApplying] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [now] = useState(() => Date.now())

  const choice = { model, effort }
  const reason = blockReason(session, hasQueuedMessage)
  const canApply = model !== null && isChanged(initial, choice) && reason === null && !isApplying

  const apply = async (event: FormEvent) => {
    event.preventDefault()
    if (!canApply || model === null) return
    setIsApplying(true)
    setErrorMessage(null)
    try {
      const response = await fetch(`/api/sessions/${session.id}/model`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, effort: effort === 'auto' ? null : effort }),
      })
      const body = (await response.json().catch(() => null)) as { isRestarted?: boolean; message?: string } | null
      if (!response.ok) {
        setErrorMessage(body?.message ?? `Failed (HTTP ${response.status})`)
        setIsApplying(false)
        return
      }
      onApplied(body?.isRestarted === true)
    } catch {
      setErrorMessage('Network error')
      setIsApplying(false)
    }
  }

  return (
    <Modal title="Model & effort" onClose={isApplying ? () => undefined : onClose} className="model-modal">
      <form className="create" onSubmit={apply}>
        <span className="form-hint">Model</span>
        <Segmented
          value={model ?? ('' as ModelAlias)}
          options={MODEL_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={setModel}
        />
        <span className="form-hint">Effort</span>
        <Segmented value={effort} options={EFFORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={setEffort} />
        {model !== null && isChanged(initial, choice) && (
          <ul className="model-notes">
            {noticeLines(session, initial, choice, now).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {reason && <p className="model-block">{reason}</p>}
        {errorMessage && <p className="model-error">{errorMessage}</p>}
        <div className="actions">
          <button type="submit" className="primary" disabled={!canApply}>
            {isApplying ? '…' : 'Apply'}
          </button>
          <button type="button" onClick={onClose} disabled={isApplying}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
