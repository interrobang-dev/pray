import { useState, useSyncExternalStore } from 'react'
import { Segmented } from './Modal'
import { MarkdownText } from './Markdown'
import {
  CHAT_CHOICE_KEYS,
  CHAT_COLOR_OPTIONS,
  CHAT_OPTIONS,
  DEFAULT_CHAT_STYLE,
  chatColorWarnings,
  normalizeHex,
  paletteVars,
  type ChatColors,
  type ChatStyle,
} from './appearance'
import { appearance, setAppearance, subscribeTheme, themeMode } from './theme'

/** 미리보기 답: 대화 모양이 바꾸는 것(제목·인라인 코드·링크·인용·표·코드 블록)을 다 넣는다 */
const PREVIEW_REPLY = [
  '### Release check',
  'Run `npm test` first, then read the [release notes](https://example.com).',
  '',
  '> Ship only after the tests pass.',
  '',
  '| Step | Status |',
  '| --- | --- |',
  '| Tests | Passed |',
  '| Build | Pending |',
  '',
  '```ts',
  'const isReady = await runTests()',
  '```',
].join('\n')

/** 색을 고르기 전 색 고르기 칸에 보일 값 (지금 팔레트에서 그 글자가 쓰는 색) */
const PALETTE_COLOR: Record<keyof ChatColors, 'text' | 'link' | 'muted'> = { code: 'text', link: 'link', heading: 'text', quote: 'muted' }

/**
 * 설정 창 Chat 탭: 대화 모양(appearance.ts 의 ChatStyle). 맨 위 미리보기는 대화 목록과 같은 .chat-scope 라 고른 모양이 그대로 보인다
 * (Chat width 는 사무실을 숨긴 넓은 화면에서만 보여 미리보기에 없다)
 */
export function ChatStyleTab() {
  const current = useSyncExternalStore(subscribeTheme, appearance)
  const mode = useSyncExternalStore(subscribeTheme, themeMode)
  const { chat } = current
  const vars = paletteVars(current.palette, mode)
  const warnings = chatColorWarnings(chat.colors, current.palette)
  /** Reset 뒤 색 입력 칸의 글을 비우려고 행을 새로 만든다 */
  const [resetCount, setResetCount] = useState(0)

  function update(change: Partial<ChatStyle>) {
    setAppearance({ ...current, chat: { ...chat, ...change } })
  }

  function reset() {
    setAppearance({ ...current, chat: DEFAULT_CHAT_STYLE })
    setResetCount((count) => count + 1)
  }

  return (
    <>
      <ChatPreview isWorkOpen={chat.workBundles === 'expanded'} />
      <section className="appearance-section">
        {CHAT_CHOICE_KEYS.map((key) => {
          const { label, options } = CHAT_OPTIONS[key]
          return (
            <div key={key} className="appearance-row">
              <span className="appearance-label">{label}</span>
              <Segmented<string> value={chat[key]} options={options} onChange={(value) => update({ [key]: value } as Partial<ChatStyle>)} />
              {key === 'width' && <span className="appearance-hint">Used when the office is hidden</span>}
            </div>
          )
        })}
      </section>
      <section className="appearance-section">
        <span className="appearance-label">Colors · empty uses the palette</span>
        {CHAT_COLOR_OPTIONS.map(({ key, label }) => (
          <ChatColorRow
            key={`${key}-${resetCount}`}
            label={label}
            value={chat.colors[key]}
            paletteColor={vars[PALETTE_COLOR[key]]}
            warnings={warnings.filter((warning) => warning.key === key)}
            onChange={(color) => update({ colors: { ...chat.colors, [key]: color } })}
          />
        ))}
      </section>
      <div className="appearance-actions">
        <button type="button" onClick={reset}>
          Reset chat style
        </button>
      </div>
    </>
  )
}

/** 글자 색 한 줄: 색 고르기 · #rrggbb 칸(맞는 값이 될 때마다 건다) · Clear, 대비가 3 아래인 모드가 있으면 경고 한 줄 */
function ChatColorRow({
  label,
  value,
  paletteColor,
  warnings,
  onChange,
}: {
  label: string
  value: string | null
  paletteColor: string
  warnings: { mode: string; ratio: number }[]
  onChange: (color: string | null) => void
}) {
  const [draft, setDraft] = useState(value ?? '')

  function applyText(text: string) {
    setDraft(text)
    const hex = normalizeHex(text)
    if (hex) onChange(hex)
    else if (text.trim() === '') onChange(null)
  }

  function clear() {
    setDraft('')
    onChange(null)
  }

  return (
    <div className="appearance-row">
      <span className="appearance-label">{label}</span>
      <div className="chat-color">
        <input type="color" value={value ?? paletteColor} onChange={(event) => applyText(event.target.value)} title={`Pick a color for ${label.toLowerCase()}`} aria-label={`${label} color`} />
        <input
          type="text"
          className={draft && !normalizeHex(draft) ? 'is-invalid' : ''}
          value={draft}
          placeholder="Palette"
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          onChange={(event) => applyText(event.target.value)}
          aria-label={`${label} hex`}
        />
        <button type="button" className="chat-color-clear" onClick={clear} disabled={value === null}>
          Clear
        </button>
      </div>
      {warnings.length > 0 && (
        <span className="chat-color-warning" role="status">
          Low contrast in {warnings.map((warning) => `${warning.mode} mode (${warning.ratio.toFixed(1)}:1)`).join(' and ')}
        </span>
      )}
    </div>
  )
}

/** 대화 미리보기: 내 말 · 작업 묶음 한 줄(Expanded 면 펼친 안쪽) · 답. 대화 탭과 같은 클래스라 같은 규칙이 걸린다 */
function ChatPreview({ isWorkOpen }: { isWorkOpen: boolean }) {
  return (
    <div className="chat-preview chat-scope" aria-hidden="true">
      <div className="msg user">
        <div className="text">Can you check the release before we ship?</div>
      </div>
      <div className="work">
        <button type="button" className="work-summary" aria-expanded={isWorkOpen} tabIndex={-1}>
          3 steps · Read 2 · Bash 1 · 12s
        </button>
        {isWorkOpen && (
          <div className="work-items">
            <div className="msg assistant">
              <MarkdownText text="Reading the release notes first." />
            </div>
          </div>
        )}
      </div>
      <div className="msg assistant">
        <MarkdownText text={PREVIEW_REPLY} />
      </div>
    </div>
  )
}
