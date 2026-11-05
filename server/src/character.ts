import { readFileSync, statSync } from 'node:fs'
import type { DotCharacter } from '@pray/host/dotCharacter'
import type { SessionCharacter } from '@pray/host/hq'

/** 인물 프리셋 id 꼴 (아틀라스 meta.jkCorp.characters 의 id). 서버는 아틀라스를 읽지 않아 꼴만 본다 */
const CHARACTER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const COLOR = /^#[0-9a-f]{6}$/i

/**
 * PUT /api/sessions/:id/character 본문·POST /api/sessions 의 character → 저장할 값 (순수). `{ id: null }` 이면 null (자동으로 복귀).
 * hair·top 은 '#rrggbb'(소문자로 맞춘다) 또는 null·생략(그 인물 기본색). isAuto: true 면 자동 배정으로 저장한다
 * (화면의 Auto 카드로 뽑은 후보 — 고른 인물과 달리 "Auto" 로 보인다. true 가 아니면 붙이지 않는다). 꼴이 틀리면 undefined (400)
 */
export function parseCharacter(body: unknown): SessionCharacter | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { id, hair, top, isAuto } = body as { id?: unknown; hair?: unknown; top?: unknown; isAuto?: unknown }
  if (id === null) return null
  if (typeof id !== 'string' || !CHARACTER_ID.test(id)) return undefined
  const color = (value: unknown): string | null | undefined =>
    value === null || value === undefined ? null : typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : undefined
  const hairColor = color(hair)
  const topColor = color(top)
  if (hairColor === undefined || topColor === undefined) return undefined
  if (isAuto !== undefined && typeof isAuto !== 'boolean') return undefined
  return isAuto ? { id, hair: hairColor, top: topColor, isAuto: true } : { id, hair: hairColor, top: topColor }
}

/**
 * 인물 아틀라스 json(meta.jkCorp.characters) → 인물 목록 읽기. 수정 시각·크기가 그대로면 앞 결과를 쓴다.
 * 파일이 없거나 해석이 안 되거나 인물이 없으면 null (새 세션에 인물을 배정하지 않는다 — 화면이 해시로 고른다). 로그는 실패·복구로 바뀔 때만
 */
export function makeCharacterSheetReader(path: string): () => DotCharacter[] | null {
  let cached: { key: string; characters: DotCharacter[] | null } | null = null
  let isFailing = false
  return () => {
    let key: string
    try {
      const stat = statSync(path)
      key = `${stat.mtimeMs}|${stat.size}`
    } catch {
      key = 'missing'
    }
    if (cached?.key === key) return cached.characters
    let characters: DotCharacter[] | null = null
    try {
      if (key !== 'missing') characters = charactersOfSheet(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      characters = null
    }
    if (!characters && !isFailing) console.error(`인물 아틀라스를 읽지 못해 자동 배정을 건너뜀: ${path}`)
    if (characters && isFailing) console.log('인물 아틀라스 읽기 복구')
    isFailing = !characters
    cached = { key, characters }
    return characters
  }
}

/** 아틀라스 json → 꼴이 맞는 인물만 (순수). 하나도 없으면 null */
export function charactersOfSheet(sheet: unknown): DotCharacter[] | null {
  const list = (sheet as { meta?: { jkCorp?: { characters?: unknown } } } | null)?.meta?.jkCorp?.characters
  if (!Array.isArray(list)) return null
  const characters = list.flatMap((item): DotCharacter[] => {
    const { id, pool, gender } = (item ?? {}) as { id?: unknown; pool?: unknown; gender?: unknown }
    if (typeof id !== 'string' || !CHARACTER_ID.test(id) || (pool !== 'lead' && pool !== 'member')) return []
    return [gender === 'male' || gender === 'female' ? { id, pool, gender } : { id, pool }]
  })
  return characters.length > 0 ? characters : null
}
