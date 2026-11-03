/**
 * 세션이 앉을 도트 인물 고르기 (순수). host/src/dotCharacter.ts(`@pray/host/dotCharacter`, 화면·서버 공용)의 hashOf·candidatesOf·
 * pickDotCharacter·dotLookOf 를 그대로 옮긴 것 — desktop 은 CommonJS 로 빌드해 dist 를 그대로 실행하므로 .ts 를 내보내는 host 패키지를
 * require 할 수 없다. 같은 결과인지 dotCharacter.test.ts 가 host 쪽과 맞춰 본다. 규칙을 고치면 같이 고친다
 */

/** 아틀라스 meta.jkCorp.characters 의 인물 하나. pool: lead = 팀장·파트장, member = 나머지 */
export interface DotCharacter {
  id: string
  pool: 'lead' | 'member'
  gender?: 'male' | 'female'
}

/** 세션이 앉을 인물과 색 ('#rrggbb', null 이면 그 인물 기본색) */
export interface DotLook {
  id: string
  hair: string | null
  top: string | null
}

/** 세션 ID → 32비트 해시 (FNV-1a) */
export function hashOf(id: string): number {
  let hash = 2166136261
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return hash
}

/** 지시자는 리더 풀, 나머지는 팀원 풀(비면 전체). 성별이 있으면 그 풀의 같은 성별 — 없으면 성별 무시 */
export function candidatesOf(isLead: boolean, characters: DotCharacter[], gender: 'male' | 'female' | null = null): DotCharacter[] {
  const pool = characters.filter((character) => character.pool === (isLead ? 'lead' : 'member'))
  const inPool = pool.length > 0 ? pool : characters
  const sameGender = gender ? inPool.filter((character) => character.gender === gender) : []
  return sameGender.length > 0 ? sameGender : inPool
}

export function pickDotCharacter(sessionId: string, isLead: boolean, characters: DotCharacter[], gender: 'male' | 'female' | null = null): string | null {
  const candidates = candidatesOf(isLead, characters, gender)
  if (candidates.length === 0) return null
  return candidates[hashOf(sessionId) % candidates.length].id
}

/** 저장된 인물(아틀라스에 있을 때만)과 그 색 → 없으면 세션 ID 해시로 고른 인물(색 없음). 인물이 없으면 null */
export function dotLookOf(
  session: { id: string; role: string | null; character?: DotLook | null; gender?: 'male' | 'female' | null },
  characters: DotCharacter[],
): DotLook | null {
  const saved = session.character
  if (saved && characters.some((character) => character.id === saved.id)) return { id: saved.id, hair: saved.hair, top: saved.top }
  const id = pickDotCharacter(session.id, session.role === 'lead', characters, session.gender ?? null)
  return id ? { id, hair: null, top: null } : null
}
