import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CHARACTER_ATLAS, loadCharacterSheet, loadRecolorArt, paintCharacter, type CharacterSheet, type Rect, type RecolorArt } from './characterArt'
import { HAIR_COLORS, TOP_COLORS, type DotCharacter, type DotLook } from '@pray/host/dotCharacter'

/** 도트 사무실이 읽는 정면 인물 아틀라스 그림 */
const IMAGE_URL = `/office/${CHARACTER_ATLAS.down}.png`
/**
 * 썸네일은 정면 셀(80×132) 가운데 64 폭의 위쪽만: 앉은 몸 위 끝(≈20)부터 무릎 근처까지. 셀이 든 손까지 담느라 양옆 8·위 4 넓어 그만큼 안쪽을 자른다
 */
const THUMB_LEFT = 8
const THUMB_W = 64
const THUMB_TOP = 16
const THUMB_H = 80
/** 큰 미리보기: 셀 위쪽 96px 를 2배로 */
const PREVIEW_H = 96
const PREVIEW_SCALE = 2

/**
 * 고른 인물. id null = 지금 자동 인물(부른 쪽이 currentAutoLook 으로 정한다), 색 null = 그 인물 기본색.
 * isAuto = Auto 버튼으로 정해진 인물 (id·색이 정해진 자동 배정. 저장하면 자동 배정으로 남는다). 격자에서 고르거나 색을 바꾸면 빠진다
 */
export interface CharacterChoice {
  id: string | null
  hair: string | null
  top: string | null
  isAuto?: boolean
}

function Preview({ art, character, frame, hair, top }: { art: RecolorArt; character: string; frame: Rect; hair: string | null; top: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const painted = paintCharacter(art, character, [{ x: frame.x + THUMB_LEFT, y: frame.y + THUMB_TOP, w: THUMB_W, h: PREVIEW_H }], hair, top)
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !painted) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(painted, 0, 0)
  }, [art, character, frame, hair, top])
  return <canvas ref={canvasRef} className="character-preview" width={THUMB_W} height={PREVIEW_H} style={{ width: THUMB_W * PREVIEW_SCALE, height: PREVIEW_H * PREVIEW_SCALE }} />
}

function Swatches({ label, base, colors, value, onChange }: { label: string; base: string; colors: string[]; value: string | null; onChange: (color: string | null) => void }) {
  return (
    <div className="character-swatches" role="radiogroup" aria-label={`${label} color`}>
      <span className="character-swatches-label">{label}</span>
      {[null, ...colors].map((color) => (
        <button
          key={color ?? 'base'}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color ?? 'Default color'}
          title={color === null ? `Default (${base})` : color}
          className={`${value === color ? 'is-selected' : ''}${color === null ? ' is-base' : ''}`}
          style={{ background: color ?? base }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

function Thumb({ frame }: { frame: Rect | undefined }) {
  if (!frame) return <span className="character-thumb" />
  return (
    <span
      className="character-thumb"
      style={{ backgroundImage: `url(${IMAGE_URL})`, backgroundPosition: `-${frame.x + THUMB_LEFT}px -${frame.y + THUMB_TOP}px`, width: THUMB_W, height: THUMB_H }}
    />
  )
}

/** Auto 버튼 아이콘: 주사위 */
function DiceIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="5.5" r="1.1" fill="currentColor" />
      <circle cx="10.5" cy="10.5" r="1.1" fill="currentColor" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" />
    </svg>
  )
}

/**
 * 세션 창(세션 추가·이름 바꾸기)의 프로필 카드 + 인물 격자. 위 = [큰 미리보기 | 부른 쪽의 Role·Name 칸(fields) · Auto 버튼 · 머리·윗옷 색 칸], 아래 = 인물 격자(이것만 스크롤).
 * Auto 는 모드가 아니라 버튼이다 — 누르면 부른 쪽(onAuto)이 이름(팀 세션)과 인물을 같이 새로 정해 value 를 바꾸고 pulse 를 올린다.
 * 지금 인물이 자동이면(id null 또는 isAuto) 미리보기에 "Auto" 꼬리표. 격자에서 고르거나 색을 바꾸면 직접 고른 인물이 된다 (인물을 바꾸면 색은 기본색으로)
 */
export function CharacterPicker({
  currentAutoLook,
  value,
  onChange,
  onAuto,
  isAutoBusy = false,
  autoHint,
  pulse,
  fields,
}: {
  /** value.id 가 null 일 때 보일 지금 자동 인물 (아틀라스 인물 목록 → 결과). 사무실과 같은 인물을 보이게 부른 쪽이 정한다 */
  currentAutoLook: (characters: DotCharacter[]) => DotLook | null
  value: CharacterChoice
  onChange: (choice: CharacterChoice) => void
  /** Auto 버튼 */
  onAuto: () => void
  /** Auto 가 이름을 받는 중이면 true (버튼을 잠근다) */
  isAutoBusy?: boolean
  /** Auto 버튼 옆 안내 ("Pick a name and a character for me" 등) */
  autoHint: string
  /** Auto 를 누른 횟수 — 바뀔 때마다 미리보기가 한 번 반짝이고 격자가 고른 칸까지 스크롤한다 */
  pulse: number
  /** 프로필 카드 오른쪽 위에 둘 Role·Name 칸 */
  fields: ReactNode
}) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [art, setArt] = useState<RecolorArt | null>(null)
  const [artError, setArtError] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let isCurrent = true
    const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
    loadCharacterSheet().then(
      (info) => isCurrent && setSheet(info),
      (reason: unknown) => isCurrent && setError(`Couldn't load characters (${message(reason)})`),
    )
    loadRecolorArt().then(
      (loaded) => isCurrent && setArt(loaded),
      (reason: unknown) => isCurrent && setArtError(`Couldn't load recoloring (${message(reason)})`),
    )
    return () => {
      isCurrent = false
    }
  }, [])
  useEffect(() => {
    const grid = gridRef.current
    const cell = grid?.querySelector<HTMLElement>('.is-selected')
    if (pulse === 0 || !grid || !cell) return
    // scrollIntoView 는 창·오버레이까지 움직여서 격자만 스크롤한다 (격자가 position: relative 라 offsetTop 이 격자 기준)
    const isVisible = cell.offsetTop >= grid.scrollTop && cell.offsetTop + cell.offsetHeight <= grid.scrollTop + grid.clientHeight
    if (!isVisible) grid.scrollTo({ top: cell.offsetTop - 8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [pulse])
  const isAuto = value.id === null || value.isAuto === true
  // 미리보기·색 칸·격자 선택에 보일 인물: 정해진 인물(직접 고른 것·Auto 버튼 결과), 아니면 지금 자동 인물
  const shown: DotLook | null = value.id ? { id: value.id, hair: value.hair, top: value.top } : sheet ? currentAutoLook(sheet.characters) : null
  const shownFrame = shown && sheet ? sheet.frames.get(shown.id) : undefined
  const bases = shown ? art?.bases[shown.id] : undefined
  // 직접 고르기: 격자 칸·색 칸. 자동 인물에서 색만 바꿔도 직접 고른 인물이 된다
  const choose = (look: DotLook) => onChange({ id: look.id, hair: look.hair, top: look.top })
  return (
    <div className="character-layout">
      <div className="character-profile">
        <div className="character-preview-box">
          {shown && art && shownFrame ? <Preview art={art} character={shown.id} frame={shownFrame} hair={shown.hair} top={shown.top} /> : <span className="character-preview" />}
          {isAuto && shown && <span className="character-auto-tag">Auto</span>}
          {pulse > 0 && <span key={pulse} className="character-pulse" aria-hidden="true" />}
        </div>
        <div className="character-profile-side">
          {fields}
          <div className="character-auto-row">
            <button type="button" className="character-auto-button" onClick={onAuto} disabled={isAutoBusy || !sheet}>
              <DiceIcon />
              Auto
            </button>
            <span className="form-hint">{autoHint}</span>
          </div>
          {shown && bases && (
            <>
              <Swatches label="Hair" base={bases.hair} colors={HAIR_COLORS} value={shown.hair} onChange={(hair) => choose({ ...shown, hair })} />
              <Swatches label="Top" base={bases.top} colors={TOP_COLORS} value={shown.top} onChange={(top) => choose({ ...shown, top })} />
            </>
          )}
          {artError && <p className="form-hint">{artError}</p>}
        </div>
      </div>
      <span className="form-hint">Office character (shown at the desk, as the list avatar and on the Off Duty street)</span>
      {error ? (
        <p className="form-hint">{error}</p>
      ) : !sheet ? (
        <p className="form-hint">Loading characters…</p>
      ) : (
        <div ref={gridRef} className="character-picker" role="radiogroup" aria-label="Office character">
          {sheet.characters.map((character) => {
            const isSelected = shown?.id === character.id
            return (
              <button
                key={character.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={isSelected ? 'is-selected' : undefined}
                title={character.id}
                // 자동 인물 칸을 누르면 그 인물·색 그대로 직접 고른 것으로, 다른 칸이면 그 인물 기본색
                onClick={() => (isSelected ? isAuto && shown && choose(shown) : choose({ id: character.id, hair: null, top: null }))}
              >
                <Thumb frame={sheet.frames.get(character.id)} />
                <span className="character-name">{character.id}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
