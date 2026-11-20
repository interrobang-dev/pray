import { useMemo, useRef, useState, type ReactNode } from 'react'
import { artifactLabel, sessionArtifacts, type ArtifactRef, type SessionArtifact } from './artifacts'
import { useDismiss } from './Shells'
import { formatAgo, formatDateTime, type ChatMessage } from './types'

/** 페이지 그림 (창 틀 + 줄). 카드·목록 버튼이 같이 쓴다 */
function ArtifactIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" />
      <path d="M2 5.5h12M4.5 8.5h7M4.5 11h4.5" />
    </svg>
  )
}

/** 바깥 링크 표시 (새 탭으로 claude.ai) */
function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5" />
    </svg>
  )
}

const STATE_LABEL: Record<ArtifactRef['action'], Record<ArtifactRef['state'], string>> = {
  publish: { running: 'Publishing artifact…', done: 'Published artifact', failed: 'Artifact not published' },
  open: { running: 'Opening artifact…', done: 'Opened artifact', failed: 'Artifact not opened' },
  create: { running: 'Creating doc…', done: 'Created doc', failed: 'Doc not created' },
}

/** 이 세션이 지운 주소의 카드 상태 글 */
const DELETED_LABEL: Record<ArtifactRef['action'], string> = { publish: 'Artifact deleted', open: 'Artifact deleted', create: 'Doc deleted' }

/** 목록 줄의 제목 쪽: 대화에 카드가 있으면 그 카드로 가는 버튼, 없으면(읽고 고치기만 한 문서) 페이지를 여는 링크. 지운 것은 카드가 없으면 누를 수 없는 글 */
function RowMain({ artifact, onGo, children }: { artifact: SessionArtifact; onGo: (toolId: string) => void; children: ReactNode }) {
  const { cardToolId } = artifact
  if (cardToolId === null && artifact.deletedAt !== null) return <span className="marks-go artifacts-go">{children}</span>
  if (cardToolId === null) {
    return (
      <a className="marks-go artifacts-go" href={artifact.url} target="_blank" rel="noreferrer" title={`Open ${artifact.url}`}>
        {children}
      </a>
    )
  }
  return (
    <button type="button" className="marks-go artifacts-go" title="Show in chat" onClick={() => onGo(cardToolId)}>
      {children}
    </button>
  )
}

/**
 * 대화 탭의 Artifact 호출 카드: [그림] 올림·엶 상태 / 제목 / 설명 [Open ↗]. 누르면 claude.ai 페이지를 새 탭(트레이 창이면 기본 브라우저)으로.
 * 주소가 없으면(올리는 중·거절) 버튼 없이 상태만. 원래 도구 블록(children)은 카드 안에 접어 둔다
 */
export function ArtifactCard({ artifact, jumpKey, markClass, children }: { artifact: ArtifactRef; jumpKey: string; markClass: string; children: ReactNode }) {
  const label = artifactLabel(artifact)
  const isDeleted = artifact.isDeleted === true
  return (
    <div className={`msg artifact-card ${artifact.state}${isDeleted ? ' deleted' : ''}${markClass}`} data-jump-key={jumpKey}>
      <div className="artifact-card-main">
        <span className="artifact-card-icon">
          <ArtifactIcon size={18} />
        </span>
        <div className="artifact-card-text">
          <div className="artifact-card-state">{isDeleted ? DELETED_LABEL[artifact.action] : STATE_LABEL[artifact.action][artifact.state]}</div>
          <div className="artifact-card-title" title={artifact.url ?? undefined}>
            {label}
          </div>
          {artifact.description && <div className="artifact-card-description">{artifact.description}</div>}
        </div>
        {artifact.url && !isDeleted && (
          <a className="artifact-card-open" href={artifact.url} target="_blank" rel="noreferrer" title={`Open ${artifact.url}`}>
            Open <ExternalIcon />
          </a>
        )}
      </div>
      {children}
    </div>
  )
}

/**
 * 대화 오른쪽 아래 버튼 묶음의 Artifact 버튼: 이 세션이 올리거나 연 claude.ai 페이지가 있을 때만. 누르면 목록 창
 * (줄 = [제목 · 설명 · 시각] ↗ — 제목을 누르면 대화의 그 카드로, ↗ 은 페이지를 새 탭으로).
 * 이 세션이 지운 것은 줄을 흐리게 남기고 시각 자리에 "Deleted · 시각", ↗ 없음. 버튼 개수는 살아 있는 것만 센다
 */
export function ArtifactsButton({ messages, onGo }: { messages: ChatMessage[]; onGo: (jumpKey: string) => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const artifacts = useMemo(() => sessionArtifacts(messages), [messages])
  const isShown = isOpen && artifacts.length > 0
  useDismiss(isShown, rootRef, toggleRef, setIsOpen)
  if (artifacts.length === 0) return null

  const now = Date.now()
  const liveCount = artifacts.filter((artifact) => artifact.deletedAt === null).length
  const deletedCount = artifacts.length - liveCount
  const label = `${liveCount} artifact${liveCount === 1 ? '' : 's'}${deletedCount > 0 ? ` · ${deletedCount} deleted` : ''}`
  return (
    <div className="marks artifacts" ref={rootRef}>
      {isShown && (
        <div id="artifacts-popover" className="marks-popover" role="dialog" aria-label="Artifacts">
          <div className="marks-head">Artifacts from this session</div>
          {artifacts.map((artifact) => (
            <div key={artifact.url} className={`marks-row${artifact.deletedAt !== null ? ' artifacts-deleted' : ''}`}>
              <RowMain
                artifact={artifact}
                onGo={(toolId) => {
                  setIsOpen(false)
                  onGo(`artifact:${toolId}`)
                }}
              >
                <span className="artifacts-text">
                  <span className="artifacts-title">{artifactLabel(artifact)}</span>
                  {artifact.description && <span className="artifacts-description">{artifact.description}</span>}
                </span>
                {artifact.deletedAt !== null ? (
                  <span className="marks-time" title={`Deleted ${formatDateTime(artifact.deletedAt)}`}>
                    Deleted · {formatAgo(artifact.deletedAt, now)}
                  </span>
                ) : (
                  <span className="marks-time" title={formatDateTime(artifact.at)}>
                    {formatAgo(artifact.at, now)}
                  </span>
                )}
              </RowMain>
              {artifact.deletedAt === null && (
                <a className="marks-remove artifacts-open" href={artifact.url} target="_blank" rel="noreferrer" title={`Open ${artifact.url}`} aria-label={`Open ${artifactLabel(artifact)}`}>
                  <ExternalIcon />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      <button
        ref={toggleRef}
        type="button"
        className="marks-button"
        aria-expanded={isShown}
        aria-controls="artifacts-popover"
        onClick={() => setIsOpen(!isShown)}
        title={label}
        aria-label={label}
      >
        <ArtifactIcon size={18} />
        {liveCount > 0 && (
          <span className="marks-button-count" aria-hidden="true">
            {liveCount}
          </span>
        )}
      </button>
    </div>
  )
}
