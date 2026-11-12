import { useState, type FormEvent } from 'react'
import { tokenLabel } from './accountLabels'
import { initialRows, leadBlockReason, leadPlaceOf, leadSessions, modelRequestBody, modelSwitchImpact, rowsToApply, type LeadRow } from './leadModels'
import { Modal } from './Modal'
import { EFFORT_OPTIONS, modelLabel, MODEL_OPTIONS, type EffortChoice, type ModelAlias } from './modelSetting'
import { PositionChip } from './PositionChip'
import { nameOf, positionOf } from './sessionPosition'
import type { Session, Team } from './types'

/** 툴바 Lead models 아이콘: 가로 슬라이더 셋 */
function LeadModelsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
      <circle cx="5.5" cy="4" r="1.5" fill="var(--bg)" />
      <circle cx="10.5" cy="8" r="1.5" fill="var(--bg)" />
      <circle cx="7" cy="12" r="1.5" fill="var(--bg)" />
    </svg>
  )
}

/** 목록 툴바의 Lead models 버튼. 근무 중인 팀장·파트장이 없으면 흐린 비활성 */
export function LeadModelsButton({ sessions, onOpen }: { sessions: Session[]; onOpen: () => void }) {
  const count = leadSessions(sessions).length
  return (
    <button className="lead-models-toggle" onClick={onOpen} disabled={count === 0} title="Lead models" aria-label="Lead models">
      <LeadModelsIcon />
    </button>
  )
}

/** 한 줄의 보낸 결과 */
type RowResult = { kind: 'restarting' } | { kind: 'unchanged' } | { kind: 'error'; message: string }

interface Props {
  sessions: Session[]
  teams: Team[]
  onClose: () => void
  /** 다시 띄운다는 응답을 받은 세션 (입력 상자 아래 "Restarting…") */
  onRestarted: (sessionId: string) => void
}

/**
 * 근무 중인 팀장·파트장의 모델·effort 를 한 창에서 바꾼다. 줄마다 체크·모델·effort, 맨 위 Set all 은 체크된 줄 전체에 넣는다.
 * Apply 는 기존 PUT /api/sessions/:id/model 을 한 세션씩 차례로 부른다 (막는 조건·재시작 방식은 세션 하나 바꿀 때와 같다)
 */
export function LeadModelsModal({ sessions, teams, onClose, onRestarted }: Props) {
  const [rows, setRows] = useState<LeadRow[]>(() => initialRows(leadSessions(sessions)))
  const [results, setResults] = useState<ReadonlyMap<string, RowResult>>(new Map())
  const [isApplying, setIsApplying] = useState(false)
  const [allModel, setAllModel] = useState<ModelAlias | ''>('')
  const [allEffort, setAllEffort] = useState<EffortChoice | ''>('')

  const byId = new Map(sessions.map((session) => [session.id, session]))
  const toApply = rowsToApply(rows)
  const impact = modelSwitchImpact(rows, sessions)
  const hasEffortOnlyChange = toApply.some((row) => row.choice.model === row.initial.model)

  const updateRow = (sessionId: string, change: Partial<LeadRow>) =>
    setRows((previous) => previous.map((row) => (row.sessionId === sessionId ? { ...row, ...change } : row)))
  const updateChoice = (sessionId: string, change: Partial<LeadRow['choice']>) =>
    setRows((previous) => previous.map((row) => (row.sessionId === sessionId ? { ...row, choice: { ...row.choice, ...change } } : row)))
  const setAll = (change: Partial<LeadRow['choice']>) =>
    setRows((previous) => previous.map((row) => (row.isChecked ? { ...row, choice: { ...row.choice, ...change } } : row)))

  const apply = async (event: FormEvent) => {
    event.preventDefault()
    if (isApplying || toApply.length === 0) return
    setIsApplying(true)
    // 한 세션씩: 호스트가 claude 를 끄고 다시 띄우는 일이라 한꺼번에 몰리지 않게
    for (const row of toApply) {
      const body = modelRequestBody(row.choice)
      if (!body) continue
      let result: RowResult
      try {
        const response = await fetch(`/api/sessions/${row.sessionId}/model`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const answer = (await response.json().catch(() => null)) as { isRestarted?: boolean; message?: string } | null
        if (!response.ok) result = { kind: 'error', message: answer?.message ?? `Failed (HTTP ${response.status})` }
        else result = answer?.isRestarted === true ? { kind: 'restarting' } : { kind: 'unchanged' }
      } catch {
        result = { kind: 'error', message: 'Network error' }
      }
      setResults((previous) => new Map(previous).set(row.sessionId, result))
      if (result.kind === 'error') continue
      if (result.kind === 'restarting') onRestarted(row.sessionId)
      // 적용된 줄은 그 값이 새 기준이 되고 체크를 푼다. 실패한 줄만 체크된 채 남아 다시 Apply 할 수 있다
      updateRow(row.sessionId, { initial: row.choice, isChecked: false })
    }
    setIsApplying(false)
  }

  const visibleRows = rows.filter((row) => byId.has(row.sessionId))
  const checkedCount = visibleRows.filter((row) => row.isChecked).length

  return (
    <Modal title="Lead models" onClose={isApplying ? () => undefined : onClose} className="lead-models-modal" hasCloseButton>
      <form className="create lead-models" onSubmit={apply}>
        <div className="lead-models-all">
          <span className="lead-models-all-label">Set all checked</span>
          <select
            value={allModel}
            disabled={isApplying || checkedCount === 0}
            aria-label="Model for all checked"
            onChange={(event) => {
              const value = event.target.value as ModelAlias
              setAllModel(value)
              setAll({ model: value })
            }}
          >
            <option value="" disabled>
              Model
            </option>
            {MODEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={allEffort}
            disabled={isApplying || checkedCount === 0}
            aria-label="Effort for all checked"
            onChange={(event) => {
              const value = event.target.value as EffortChoice
              setAllEffort(value)
              setAll({ effort: value })
            }}
          >
            <option value="" disabled>
              Effort
            </option>
            {EFFORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <ul className="lead-models-list">
          {visibleRows.map((row) => {
            const session = byId.get(row.sessionId)!
            const result = results.get(row.sessionId)
            const reason = leadBlockReason(session)
            const current = [modelLabel(session), typeof session.contextTokens === 'number' ? tokenLabel(session.contextTokens) : null].filter(Boolean).join(' · ')
            const checkboxId = `lead-model-${row.sessionId}`
            return (
              <li key={row.sessionId} className="lead-models-row">
                <input
                  id={checkboxId}
                  type="checkbox"
                  checked={row.isChecked}
                  disabled={isApplying}
                  onChange={(event) => updateRow(row.sessionId, { isChecked: event.target.checked })}
                />
                <label className="lead-models-who" htmlFor={checkboxId}>
                  <span className="lead-models-name">
                    <PositionChip position={positionOf(session)} />
                    {nameOf(session)}
                  </span>
                  <span className="lead-models-meta">
                    {leadPlaceOf(session, teams)}
                    {current && ` · ${current}`}
                  </span>
                </label>
                <select
                  value={row.choice.model ?? ''}
                  disabled={isApplying}
                  aria-label={`Model for ${nameOf(session)}`}
                  onChange={(event) => updateChoice(row.sessionId, { model: event.target.value as ModelAlias })}
                >
                  {row.choice.model === null && (
                    <option value="" disabled>
                      Model
                    </option>
                  )}
                  {MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  value={row.choice.effort}
                  disabled={isApplying}
                  aria-label={`Effort for ${nameOf(session)}`}
                  onChange={(event) => updateChoice(row.sessionId, { effort: event.target.value as EffortChoice })}
                >
                  {EFFORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {result ? (
                  <span className={result.kind === 'error' ? 'lead-models-status is-error' : 'lead-models-status'}>
                    {result.kind === 'error' ? result.message : result.kind === 'restarting' ? 'Restarting…' : 'Already set'}
                  </span>
                ) : (
                  reason && <span className="lead-models-status">{reason}</span>
                )}
              </li>
            )
          })}
          {visibleRows.length === 0 && <li className="lead-models-empty">No leads on duty</li>}
        </ul>
        {toApply.length > 0 && (
          <ul className="model-notes">
            {impact.count > 0 && (
              <li>
                Switching model re-reads the context of {impact.count} {impact.count === 1 ? 'lead' : 'leads'}
                {impact.tokens > 0 && ` (~${tokenLabel(impact.tokens)} tokens)`}.
              </li>
            )}
            {hasEffortOnlyChange && <li>Effort changes keep the prompt cache.</li>}
            <li>Each session restarts for a few seconds; a background wait stops and has to be called again.</li>
          </ul>
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={isApplying || toApply.length === 0}>
            {isApplying ? 'Applying…' : toApply.length > 0 ? `Apply to ${toApply.length}` : 'Apply'}
          </button>
          <button type="button" onClick={onClose} disabled={isApplying}>
            {results.size > 0 ? 'Close' : 'Cancel'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
