import { useState, useSyncExternalStore } from 'react'
import { Modal, Segmented } from './Modal'
import { ACCENT_PRESETS, PALETTES } from './palettes'
import { DEFAULT_APPEARANCE, FONT_SIZE_OPTIONS, accentBase, accentSurface, accentVars, normalizeHex, paletteVars, type Appearance, type FontSize, type ThemeChoice } from './appearance'
import { appearance, setAppearance, setThemeChoice, subscribeTheme, themeChoice, themeMode } from './theme'
import { ChatStyleTab } from './ChatStyleTab'

const MODE_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

type Tab = 'app' | 'chat'

/**
 * 화면 스타일 설정 창 (목록 헤더 톱니 버튼). 탭 App(앱 전체) · Chat(대화 모양, ChatStyleTab.tsx). 바꾸면 바로 걸리고 이 브라우저에 저장된다 (theme.ts).
 * 열 때는 늘 App 탭이다
 */
export function AppearanceModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('app')
  return (
    <Modal title="Appearance" onClose={onClose} className="appearance-modal" hasCloseButton>
      <div className="appearance-tabs" role="tablist" aria-label="Appearance">
        {(['app', 'chat'] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>
            {value === 'app' ? 'App' : 'Chat'}
          </button>
        ))}
      </div>
      {tab === 'app' ? <AppTab /> : <ChatStyleTab />}
    </Modal>
  )
}

/**
 * App 탭: 모드·팔레트·강조색·글자 크기.
 * 견본 색은 그 팔레트·강조색의 실제 값(palettes.ts·appearance.ts)을 인라인 style 로 칠한다 — 지금 화면 변수가 아니라 고를 것의 색이라서
 */
function AppTab() {
  const choice = useSyncExternalStore(subscribeTheme, themeChoice)
  const mode = useSyncExternalStore(subscribeTheme, themeMode)
  const current = useSyncExternalStore(subscribeTheme, appearance)
  const vars = paletteVars(current.palette, mode)
  const isCustomAccent = current.accent.startsWith('#')
  const [hexDraft, setHexDraft] = useState(isCustomAccent ? current.accent : '')

  function update(change: Partial<Appearance>) {
    setAppearance({ ...current, ...change })
  }

  /** 프리셋·팔레트 강조색을 고르면 직접 입력 칸은 비운다 (칸의 글이 지금 강조색처럼 보이지 않게) */
  function chooseAccent(accent: string) {
    setHexDraft('')
    update({ accent })
  }

  function applyHex(text: string) {
    setHexDraft(text)
    const hex = normalizeHex(text)
    if (hex) update({ accent: hex })
  }

  /** App 탭 것만 기본으로 (모드는 시스템). 대화 모양은 Chat 탭의 Reset chat style 이 따로 한다 */
  function reset() {
    setAppearance({ ...DEFAULT_APPEARANCE, chat: current.chat })
    setThemeChoice('system')
    setHexDraft('')
  }

  /** 강조색 칩의 색: 지금 팔레트·모드에서 실제로 쓰일 값 (파생 뒤) */
  function chipColor(accent: string): string {
    return accentVars(accentBase(accent, current.palette, mode), mode, accentSurface(vars, mode)).accent
  }

  return (
    <>
      <section className="appearance-section">
        <span className="appearance-label">Mode</span>
        <Segmented value={choice} options={MODE_OPTIONS} onChange={setThemeChoice} />
      </section>
      <section className="appearance-section">
        <span className="appearance-label">Palette</span>
        <div className="palette-grid" role="radiogroup" aria-label="Palette">
          {PALETTES.map((palette) => {
            const swatch = paletteVars(palette.id, mode)
            const isSelected = palette.id === current.palette
            return (
              <button
                key={palette.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`palette-chip${isSelected ? ' is-selected' : ''}`}
                onClick={() => update({ palette: palette.id })}
              >
                <span className="palette-swatch" style={{ background: swatch.bg, borderColor: swatch.line }} aria-hidden="true">
                  <span className="palette-swatch-panel" style={{ background: swatch.panel, borderColor: swatch.line }}>
                    <span className="palette-swatch-text" style={{ background: swatch.text }} />
                    <span className="palette-swatch-muted" style={{ background: swatch.muted }} />
                  </span>
                  <span className="palette-swatch-accent" style={{ background: swatch.accent }} />
                </span>
                <span className="palette-name">{palette.label}</span>
              </button>
            )
          })}
        </div>
      </section>
      <section className="appearance-section">
        <span className="appearance-label">Accent</span>
        <div className="accent-row" role="radiogroup" aria-label="Accent">
          <button
            type="button"
            role="radio"
            aria-checked={current.accent === 'palette'}
            className={`accent-chip accent-chip-palette${current.accent === 'palette' ? ' is-selected' : ''}`}
            title="Palette accent"
            aria-label="Palette accent"
            onClick={() => chooseAccent('palette')}
          >
            <span style={{ background: chipColor('palette') }} />
          </button>
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={current.accent === preset.id}
              className={`accent-chip${current.accent === preset.id ? ' is-selected' : ''}`}
              title={preset.label}
              aria-label={preset.label}
              onClick={() => chooseAccent(preset.id)}
            >
              <span style={{ background: chipColor(preset.id) }} />
            </button>
          ))}
        </div>
        <div className="accent-custom">
          <input
            type="color"
            value={isCustomAccent ? current.accent : chipColor(current.accent)}
            onChange={(event) => applyHex(event.target.value)}
            title="Pick a custom accent"
            aria-label="Pick a custom accent"
          />
          <input
            type="text"
            className={hexDraft && !normalizeHex(hexDraft) ? 'is-invalid' : ''}
            value={hexDraft}
            placeholder="Custom #rrggbb"
            spellCheck={false}
            autoComplete="off"
            maxLength={7}
            onChange={(event) => applyHex(event.target.value)}
            aria-label="Custom accent hex"
          />
        </div>
      </section>
      <section className="appearance-section">
        <span className="appearance-label">Font size</span>
        <Segmented<FontSize>
          value={current.fontSize}
          options={FONT_SIZE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(fontSize) => update({ fontSize })}
        />
      </section>
      <div className="appearance-actions">
        <button type="button" onClick={reset}>
          Reset to defaults
        </button>
      </div>
    </>
  )
}
