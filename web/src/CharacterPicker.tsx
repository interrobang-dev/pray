import { useEffect, useState } from 'react'
import { pickDotCharacter, type DotCharacter } from './dotCharacter'

/** 도트 사무실이 읽는 인물 아틀라스 (Office.tsx 의 DOT_SHEET_URL 과 같다) */
const SHEET_URL = '/office/office-v1.json'
const IMAGE_URL = '/office/office-v1.png'
/** 썸네일은 셀(64×128) 위쪽만: 앉은 몸 위 끝(≈16)부터 무릎 근처까지 */
const THUMB_TOP = 12
const THUMB_H = 80

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
 * value = 고른 인물 id, null = 자동
 */
export function CharacterPicker({ sessionId, value, onChange }: { sessionId: string; value: string | null; onChange: (id: string | null) => void }) {
  const [sheet, setSheet] = useState<SheetInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let isCurrent = true
    loadSheet().then(
      (info) => isCurrent && setSheet(info),
      (reason: unknown) => isCurrent && setError(`인물 목록을 읽지 못함 (${reason instanceof Error ? reason.message : String(reason)})`),
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
  return (
    <div className="character-picker" role="radiogroup" aria-label="도트 사무실 인물">
      {options.map((option) => (
        <button
          key={option.id ?? 'auto'}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          className={value === option.id ? 'is-selected' : undefined}
          title={option.id === null ? `자동: 세션마다 정해지는 인물 (${autoId ?? '없음'})` : option.id}
          onClick={() => onChange(option.id)}
        >
          <Thumb frame={option.frameId ? sheet.frames.get(option.frameId) : undefined} />
          <span className="character-name">{option.label}</span>
        </button>
      ))}
    </div>
  )
}
