import { useEffect, useRef, useState } from 'react'
import { loadRecolorArt, paintCharacter, type RecolorArt } from './characterArt'
import { pickDotCharacter, type DotCharacter } from './dotCharacter'
import { HAIR_COLORS, TOP_COLORS } from './recolor'

/** 도트 사무실이 읽는 인물 아틀라스 (Office.tsx 의 DOT_SHEET_URL 과 같다) */
const SHEET_URL = '/office/office-v1.json'
const IMAGE_URL = '/office/office-v1.png'
/** 썸네일은 셀(64×128) 위쪽만: 앉은 몸 위 끝(≈16)부터 무릎 근처까지 */
const THUMB_TOP = 12
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

interface Frame {
  x: number
  y: number
  w: number
}

interface SheetInfo {
  characters: DotCharacter[]
  /** 인물 id → idle 첫 칸 (없으면 typing 첫 칸) */
  frames: Map<string, Frame>
}

let sheetPromise: Promise<SheetInfo> | null = null

/** 아틀라스 JSON 을 한 번만 읽는다 (실패하면 다음에 다시) */
function loadSheet(): Promise<SheetInfo> {
  sheetPromise ??= fetch(SHEET_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    })
    .then((data: { frames: Record<string, { frame: Frame }>; meta: { jkCorp: { characters?: DotCharacter[] } } }) => {
      const characters = data.meta.jkCorp.characters ?? []
      const frames = new Map<string, Frame>()
      for (const { id } of characters) {
        const frame = data.frames[`char/${id}/idle/0`] ?? data.frames[`char/${id}/typing/0`]
        if (frame) frames.set(id, frame.frame)
      }
      return { characters, frames }
    })
    .catch((error: unknown) => {
      sheetPromise = null
      throw error
    })
  return sheetPromise
}

function Preview({ art, character, frame, hair, top }: { art: RecolorArt; character: string; frame: Frame; hair: string | null; top: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const painted = paintCharacter(art, character, [{ x: frame.x, y: frame.y + THUMB_TOP, w: frame.w, h: PREVIEW_H }], hair, top)
    const context = canvas?.getContext('2d')
    if (!canvas || !context || !painted) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(painted, 0, 0)
  }, [art, character, frame, hair, top])
  return <canvas ref={canvasRef} className="character-preview" width={frame.w} height={PREVIEW_H} style={{ width: frame.w * PREVIEW_SCALE, height: PREVIEW_H * PREVIEW_SCALE }} />
}

function Swatches({ label, base, colors, value, onChange }: { label: string; base: string; colors: string[]; value: string | null; onChange: (color: string | null) => void }) {
  return (
    <div className="character-swatches" role="radiogroup" aria-label={`${label} 색`}>
      <span className="character-swatches-label">{label}</span>
      {[null, ...colors].map((color) => (
        <button
          key={color ?? 'base'}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color ?? '기본색'}
          title={color === null ? `기본색 (${base})` : color}
          className={`${value === color ? 'is-selected' : ''}${color === null ? ' is-base' : ''}`}
          style={{ background: color ?? base }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

function Thumb({ frame }: { frame: Frame | undefined }) {
  if (!frame) return <span className="character-thumb" />
  return (
    <span
      className="character-thumb"
      style={{ backgroundImage: `url(${IMAGE_URL})`, backgroundPosition: `-${frame.x}px -${frame.y + THUMB_TOP}px`, width: frame.w, height: THUMB_H }}
    />
  )
}

/**
 * 지시자(팀장·파트장)의 도트 사무실 인물 고르기: "자동"(세션 ID 해시로 리더 풀에서 고른 인물) + 인물 프리셋 전부.
 * 인물을 고르면 머리·윗옷 색 칸과 큰 미리보기가 나온다 (인물을 바꾸면 색은 기본색으로)
 */
export function CharacterPicker({ sessionId, value, onChange }: { sessionId: string; value: CharacterChoice; onChange: (choice: CharacterChoice) => void }) {
  const [sheet, setSheet] = useState<SheetInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [art, setArt] = useState<RecolorArt | null>(null)
  const [artError, setArtError] = useState<string | null>(null)
  useEffect(() => {
    let isCurrent = true
    const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
    loadSheet().then(
      (info) => isCurrent && setSheet(info),
      (reason: unknown) => isCurrent && setError(`인물 목록을 읽지 못함 (${message(reason)})`),
    )
    loadRecolorArt().then(
      (loaded) => isCurrent && setArt(loaded),
      (reason: unknown) => isCurrent && setArtError(`색 바꾸기를 읽지 못함 (${message(reason)})`),
    )
    return () => {
      isCurrent = false
    }
  }, [])
  if (error) return <p className="form-hint">{error}</p>
  if (!sheet) return <p className="form-hint">인물 목록을 읽는 중…</p>
  const autoId = pickDotCharacter(sessionId, true, sheet.characters)
  const options: { id: string | null; label: string; frameId: string | null }[] = [
    { id: null, label: '자동', frameId: autoId },
    ...sheet.characters.map((character) => ({ id: character.id, label: character.id, frameId: character.id })),
  ]
  const chosenFrame = value.id ? sheet.frames.get(value.id) : undefined
  const bases = value.id ? art?.bases[value.id] : undefined
  return (
    <>
      <div className="character-picker" role="radiogroup" aria-label="도트 사무실 인물">
        {options.map((option) => (
          <button
            key={option.id ?? 'auto'}
            type="button"
            role="radio"
            aria-checked={value.id === option.id}
            className={value.id === option.id ? 'is-selected' : undefined}
            title={option.id === null ? `자동: 세션마다 정해지는 인물 (${autoId ?? '없음'})` : option.id}
            onClick={() => option.id !== value.id && onChange({ id: option.id, hair: null, top: null })}
          >
            <Thumb frame={option.frameId ? sheet.frames.get(option.frameId) : undefined} />
            <span className="character-name">{option.label}</span>
          </button>
        ))}
      </div>
      {value.id && artError && <p className="form-hint">{artError}</p>}
      {value.id && art && bases && chosenFrame && (
        <div className="character-colors">
          <Preview art={art} character={value.id} frame={chosenFrame} hair={value.hair} top={value.top} />
          <div className="character-color-rows">
            <Swatches label="머리" base={bases.hair} colors={HAIR_COLORS} value={value.hair} onChange={(hair) => onChange({ ...value, hair })} />
            <Swatches label="윗옷" base={bases.top} colors={TOP_COLORS} value={value.top} onChange={(top) => onChange({ ...value, top })} />
          </div>
        </div>
      )}
    </>
  )
}
