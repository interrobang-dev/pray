import { useEffect, useRef, useState } from 'react'
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
 * 고른 인물. id null = 자동(부른 쪽이 정한 지금 자동 인물), 색 null = 그 인물 기본색.
 * isAuto = Auto 카드를 눌러 뽑은 후보 (id·색이 정해진 자동 배정. 저장하면 자동 배정으로 남는다)
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

function Swatches({
  label,
  base,
  colors,
  value,
  isDisabled = false,
  onChange,
}: {
  label: string
  base: string
  colors: string[]
  value: string | null
  isDisabled?: boolean
  onChange: (color: string | null) => void
}) {
  return (
    <div className={isDisabled ? 'character-swatches is-disabled' : 'character-swatches'} role="radiogroup" aria-label={`${label} color`} aria-disabled={isDisabled}>
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
          disabled={isDisabled}
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

/** Auto 카드 실루엣으로 쓸 인물 — 자동 인물이 바뀌어도 모양은 같게 늘 이 인물의 윤곽 */
const SILHOUETTE_CHARACTER = 'member'

/** Auto 카드의 그림: 인물 윤곽만 회색으로(아틀라스를 CSS mask 로, 썸네일과 같은 자리·크기) + 상자 정가운데 "?" 배지 */
function AutoSilhouette({ frame }: { frame: Rect | undefined }) {
  const position = frame ? `-${frame.x + THUMB_LEFT}px -${frame.y + THUMB_TOP}px` : ''
  const mask = frame ? { maskImage: `url(${IMAGE_URL})`, WebkitMaskImage: `url(${IMAGE_URL})`, maskPosition: position, WebkitMaskPosition: position } : undefined
  return (
    <span className="character-thumb character-auto-art" style={{ width: THUMB_W, height: THUMB_H }}>
      {mask && <span className="character-silhouette" style={mask} />}
      <span className="character-auto-mark" aria-hidden="true">
        ?
      </span>
    </span>
  )
}

/**
 * 세션(역할 무관)의 도트 사무실 인물 고르기. 왼쪽 = 고르기 목록 [Auto 카드 위 · 인물 격자 아래], 오른쪽 = 큰 미리보기·머리·윗옷 색 칸 (폰은 미리보기가 위).
 * Auto(서버의 자동 배정, 없으면 세션 ID 해시): 그 자동 인물의 격자 칸에 점선 테두리 + "Auto" 꼬리표, 미리보기는 그 인물·색, 색 칸은 잠근다.
 * Auto 카드를 누를 때마다 다음 자동 후보로 바뀐다 (그동안 보인 후보를 쓰는 중으로 쳐서 autoLook 이 다시 고른다) — 그 칸이 한 번 반짝이고 격자가 그 칸까지 스크롤한다.
 * 직접 고른 상태에서 누르면 먼저 지금 자동 인물로 돌아간다. 인물 칸을 누르면 직접 고르기 (인물을 바꾸면 색은 기본색으로)
 */
export function CharacterPicker({
  autoLook,
  value,
  onChange,
}: {
  /**
   * "Auto" 일 때 보일 인물과 색. skip 이 비면 지금 자동 인물(사무실과 같은 인물을 보이게 부른 쪽이 정한다),
   * 아니면 skip(그동안 보인 후보)도 쓰는 중으로 치고 자동 배정 규칙으로 고른 다음 후보
   */
  autoLook: (characters: DotCharacter[], skip: DotLook[]) => DotLook | null
  value: CharacterChoice
  onChange: (choice: CharacterChoice) => void
}) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [art, setArt] = useState<RecolorArt | null>(null)
  const [artError, setArtError] = useState<string | null>(null)
  /** Auto 카드를 누른 횟수 — 바뀔 때마다 자동 인물 칸이 한 번 반짝이고(key 로 애니메이션 다시 시작) 그 칸까지 스크롤한다 */
  const [pulse, setPulse] = useState(0)
  /** Auto 카드로 지금까지 보인 후보 (다음 후보가 겹치지 않게). 직접 고르면 비운다 */
  const [rolls, setRolls] = useState<DotLook[]>([])
  const gridRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const grid = gridRef.current
    const cell = grid?.querySelector<HTMLElement>('.is-auto-pick')
    if (pulse === 0 || !grid || !cell) return
    // scrollIntoView 는 창·오버레이까지 움직여서 격자만 스크롤한다 (격자가 position: relative 라 offsetTop 이 격자 기준)
    const isVisible = cell.offsetTop >= grid.scrollTop && cell.offsetTop + cell.offsetHeight <= grid.scrollTop + grid.clientHeight
    if (!isVisible) grid.scrollTo({ top: cell.offsetTop - 8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [pulse])
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
  if (error) return <p className="form-hint">{error}</p>
  if (!sheet) return <p className="form-hint">Loading characters…</p>
  const isAuto = value.id === null || value.isAuto === true
  // 지금 보이는 자동 인물: 뽑은 후보면 그것, 아니면 부른 쪽이 정한 지금 자동 인물
  const auto: DotLook | null = value.isAuto && value.id ? { id: value.id, hair: value.hair, top: value.top } : autoLook(sheet.characters, [])
  // 미리보기·색 칸이 보일 인물: Auto 면 자동 인물(그 색), 아니면 고른 인물
  const shown = isAuto ? auto : { id: value.id!, hair: value.hair, top: value.top }
  const shownFrame = shown ? sheet.frames.get(shown.id) : undefined
  const bases = shown ? art?.bases[shown.id] : undefined
  function pressAuto() {
    if (!isAuto) {
      onChange({ id: null, hair: null, top: null })
    } else {
      const skip = auto ? [...rolls, auto] : rolls
      const next = autoLook(sheet!.characters, skip)
      if (next) onChange({ ...next, isAuto: true })
      setRolls(skip)
    }
    setPulse((count) => count + 1)
  }
  function choose(id: string) {
    setRolls([])
    onChange({ id, hair: null, top: null })
  }
  // 고른 인물의 큰 미리보기(+ 색 칸)는 오른쪽(폰은 위). 왼쪽 목록은 Auto 카드 고정, 격자만 스크롤한다 (style.css .character-layout)
  return (
    <div className="character-layout">
      <div className="character-choices">
        <button type="button" role="radio" aria-checked={isAuto} className={isAuto ? 'character-auto-card is-selected' : 'character-auto-card'} onClick={pressAuto}>
          <AutoSilhouette frame={sheet.frames.get(SILHOUETTE_CHARACTER) ?? (auto ? sheet.frames.get(auto.id) : undefined)} />
          <span className="character-auto-text">
            <b>Auto</b>
            <span>Picked automatically so look-alikes are rare{auto ? ` · now ${auto.id}` : ''}</span>
          </span>
        </button>
        <div ref={gridRef} className="character-picker" role="radiogroup" aria-label="Office character">
          {sheet.characters.map((character) => {
            const isAutoPick = isAuto && auto?.id === character.id
            const isChosen = !isAuto && value.id === character.id
            const className = [isChosen && 'is-selected', isAutoPick && 'is-auto-pick'].filter(Boolean).join(' ')
            return (
              <button
                key={character.id}
                type="button"
                role="radio"
                aria-checked={isChosen}
                data-character={character.id}
                className={className || undefined}
                title={isAutoPick ? `${character.id} · picked automatically` : character.id}
                onClick={() => !isChosen && choose(character.id)}
              >
                <Thumb frame={sheet.frames.get(character.id)} />
                <span className="character-name">{character.id}</span>
                {isAutoPick && <span className="character-auto-tag">Auto</span>}
                {isAutoPick && pulse > 0 && <span key={pulse} className="character-pulse" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </div>
      <div className="character-selected">
        {shown && art && bases && shownFrame && (
          <div className="character-colors">
            <Preview art={art} character={shown.id} frame={shownFrame} hair={shown.hair} top={shown.top} />
            <div className="character-color-rows">
              <Swatches label="Hair" base={bases.hair} colors={HAIR_COLORS} value={shown.hair} isDisabled={isAuto} onChange={(hair) => onChange({ ...value, hair })} />
              <Swatches label="Top" base={bases.top} colors={TOP_COLORS} value={shown.top} isDisabled={isAuto} onChange={(top) => onChange({ ...value, top })} />
              {isAuto && <p className="form-hint">Choose a character to set colors</p>}
            </div>
          </div>
        )}
        {artError && <p className="form-hint">{artError}</p>}
      </div>
    </div>
  )
}
