import { useEffect, useRef, useState } from 'react'
import { CHARACTER_ATLAS, loadCharacterSheet, loadRecolorArt, paintCharacter, type CharacterSheet, type Rect, type RecolorArt } from './characterArt'
import { HAIR_COLORS, TOP_COLORS, type DotCharacter, type DotLook } from '@jk-corp/host/dotCharacter'

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

/** 고른 인물. id null = 자동(색 없음), 색 null = 그 인물 기본색 */
export interface CharacterChoice {
  id: string | null
  hair: string | null
  top: string | null
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

/**
 * 지시자(팀장·파트장)의 도트 사무실 인물 고르기: "Auto"(서버의 자동 배정, 없으면 세션 ID 해시) + 인물 프리셋 전부.
 * 인물을 고르면 머리·윗옷 색 칸과 큰 미리보기가 나온다 (인물을 바꾸면 색은 기본색으로). Auto 는 그 인물·색의 미리보기만
 */
export function CharacterPicker({
  autoLook,
  value,
  onChange,
}: {
  /** "Auto" 일 때 보일 인물과 색 (아틀라스 인물 목록 → 결과). 사무실과 같은 인물을 보이게 부른 쪽이 정한다 */
  autoLook: (characters: DotCharacter[]) => DotLook | null
  value: CharacterChoice
  onChange: (choice: CharacterChoice) => void
}) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [art, setArt] = useState<RecolorArt | null>(null)
  const [artError, setArtError] = useState<string | null>(null)
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
  const auto = autoLook(sheet.characters)
  const autoId = auto?.id ?? null
  const options: { id: string | null; label: string; frameId: string | null }[] = [
    { id: null, label: 'Auto', frameId: autoId },
    ...sheet.characters.map((character) => ({ id: character.id, label: character.id, frameId: character.id })),
  ]
  const chosenFrame = value.id ? sheet.frames.get(value.id) : undefined
  const bases = value.id ? art?.bases[value.id] : undefined
  return (
    <>
      <div className="character-picker" role="radiogroup" aria-label="Office character">
        {options.map((option) => (
          <button
            key={option.id ?? 'auto'}
            type="button"
            role="radio"
            aria-checked={value.id === option.id}
            className={value.id === option.id ? 'is-selected' : undefined}
            title={option.id === null ? `Auto: picked so look-alikes are rare (${autoId ?? 'none'})` : option.id}
            onClick={() => option.id !== value.id && onChange({ id: option.id, hair: null, top: null })}
          >
            <Thumb frame={option.frameId ? sheet.frames.get(option.frameId) : undefined} />
            <span className="character-name">{option.label}</span>
          </button>
        ))}
      </div>
      {artError && <p className="form-hint">{artError}</p>}
      {!value.id && art && auto && sheet.frames.get(auto.id) && (
        <div className="character-colors">
          <Preview art={art} character={auto.id} frame={sheet.frames.get(auto.id)!} hair={auto.hair} top={auto.top} />
          <p className="form-hint">Picked automatically so look-alikes are rare. Choose a character to set colors yourself.</p>
        </div>
      )}
      {value.id && art && bases && chosenFrame && (
        <div className="character-colors">
          <Preview art={art} character={value.id} frame={chosenFrame} hair={value.hair} top={value.top} />
          <div className="character-color-rows">
            <Swatches label="Hair" base={bases.hair} colors={HAIR_COLORS} value={value.hair} onChange={(hair) => onChange({ ...value, hair })} />
            <Swatches label="Top" base={bases.top} colors={TOP_COLORS} value={value.top} onChange={(top) => onChange({ ...value, top })} />
          </div>
        </div>
      )}
    </>
  )
}
