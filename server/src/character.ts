import type { SessionCharacter } from '@jk-corp/host/hq'

/** 인물 프리셋 id 꼴 (아틀라스 meta.jkCorp.characters 의 id). 서버는 아틀라스를 읽지 않아 꼴만 본다 */
const CHARACTER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/
const COLOR = /^#[0-9a-f]{6}$/i

/**
 * PUT /api/sessions/:id/character 본문 → 저장할 값 (순수). `{ id: null }` 이면 null (자동으로 복귀).
 * hair·top 은 '#rrggbb'(소문자로 맞춘다) 또는 null·생략(그 인물 기본색). 꼴이 틀리면 undefined (400)
 */
export function parseCharacter(body: unknown): SessionCharacter | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const { id, hair, top } = body as { id?: unknown; hair?: unknown; top?: unknown }
  if (id === null) return null
  if (typeof id !== 'string' || !CHARACTER_ID.test(id)) return undefined
  const color = (value: unknown): string | null | undefined =>
    value === null || value === undefined ? null : typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : undefined
  const hairColor = color(hair)
  const topColor = color(top)
  if (hairColor === undefined || topColor === undefined) return undefined
  return { id, hair: hairColor, top: topColor }
}
