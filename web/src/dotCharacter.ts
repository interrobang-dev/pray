import { hashOf } from './avatar'

/** 아틀라스 meta.jkCorp.characters 의 인물 하나. pool: lead = 팀장·파트장, member = 나머지 */
export interface DotCharacter {
  id: string
  pool: 'lead' | 'member'
}

/**
 * 도트 사무실에서 세션이 앉을 인물. 같은 세션은 늘 같은 인물 (세션 ID 해시).
 * 지시자(팀장·파트장)는 리더 풀, 나머지는 팀원 풀에서 고르고, 풀이 비면 전체에서 고른다. 인물이 없으면 null
 */
export function pickDotCharacter(sessionId: string, isLead: boolean, characters: DotCharacter[]): string | null {
  const pool = characters.filter((character) => character.pool === (isLead ? 'lead' : 'member'))
  const candidates = pool.length > 0 ? pool : characters
  if (candidates.length === 0) return null
  return candidates[hashOf(sessionId) % candidates.length].id
}

/** 세션이 앉을 인물과 색 (책상·목록 머리·Off Duty 머리가 같이 쓴다) */
export interface DotLook {
  id: string
  hair: string | null
  top: string | null
}

/**
 * 사용자가 고른 인물(아틀라스에 있을 때만)과 그 색 → 없으면 세션 ID 해시로 고른 프리셋(색 없음). 인물이 하나도 없으면 null
 */
export function dotLookOf(
  session: { id: string; role: string | null; character?: { id: string; hair: string | null; top: string | null } | null },
  characters: DotCharacter[],
): DotLook | null {
  const chosen = session.character
  if (chosen && characters.some((character) => character.id === chosen.id)) return { id: chosen.id, hair: chosen.hair, top: chosen.top }
  const id = pickDotCharacter(session.id, session.role === 'lead', characters)
  return id ? { id, hair: null, top: null } : null
}
