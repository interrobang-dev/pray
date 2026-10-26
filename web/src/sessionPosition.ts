/** 세션 역할(position)과 이름을 따로 다루는 순수 함수. 역할은 칩으로, 이름은 글자로 보인다 */

import type { Session } from './types'

/** 세션 추가 모달 Role 칸의 미리 채운 값 (사용자 확정). 팀장·파트장 모두 Lead */
export const MEMBER_POSITION = 'Dev'
export const LEAD_POSITION = 'Lead'

/** 옛 꼴 이름 "[FE] Park" 을 역할과 이름으로 가른다. 대괄호가 없으면 역할 없이 그대로 */
export function splitLegacyName(name: string): { position: string | null; name: string } {
  const match = name.match(/^\[([^\]]*)\]\s*(.*)$/)
  if (!match) return { position: null, name }
  const position = match[1].trim()
  return { position: position || null, name: match[2] }
}

/** 빈 값(공백뿐인 것 포함)은 null */
export function cleanPosition(position: string | null | undefined): string | null {
  const trimmed = position?.trim()
  return trimmed ? trimmed : null
}

/** 세션의 화면용 역할. 서버가 준 position 이 먼저고, 없으면(옛 서버·옛 이름) 이름 앞 "[역할]" 에서 읽는다 */
export function positionOf(session: Pick<Session, 'name' | 'position'>): string | null {
  const own = cleanPosition(session.position)
  if (own) return own
  return session.name ? splitLegacyName(session.name).position : null
}

/** 세션의 화면용 이름: 사용자 지정 → 자동 제목 → ID 앞 8자리. 옛 꼴 "[역할] 이름" 이면 역할을 뗀 이름 */
export function nameOf(session: Pick<Session, 'id' | 'name' | 'title' | 'position'>): string {
  if (session.name) {
    // position 이 있는 새 응답의 이름은 이미 이름만이다. 없으면(옛 서버·옛 기록) 이름 앞 "[역할]" 을 뗀다
    if (cleanPosition(session.position)) return session.name
    const split = splitLegacyName(session.name)
    return split.position && split.name ? split.name : session.name
  }
  return session.title ?? session.id.slice(0, 8)
}

/** 이름 바꾸기 창의 Name 칸 값: 사용자가 붙인 이름만 (자동 제목은 넣지 않는다). 옛 꼴이면 역할을 뗀다 */
export function editableNameOf(session: Pick<Session, 'name' | 'position'>): string {
  if (!session.name) return ''
  if (cleanPosition(session.position)) return session.name
  const split = splitLegacyName(session.name)
  return split.position ? split.name : session.name
}

/** 지시·보고 한 줄에 쓸 팀원: 새 꼴(position 따로)과 옛 꼴(이름에 "[역할]") 둘 다 받는다 */
export function memberOf(name: string, position?: string | null): { name: string; position: string | null } {
  const own = cleanPosition(position)
  if (own) return { name, position: own }
  const split = splitLegacyName(name)
  return split.position ? { name: split.name, position: split.position } : { name, position: null }
}

/** 세션 추가 모달의 Role 칸 값. 사용자가 Role 칸을 직접 고쳤으면(typedPosition 이 null 이 아니면) 그것이 이긴다 */
export function modalPosition(typedPosition: string | null, role: 'member' | 'lead', hasTeam: boolean): string {
  if (typedPosition !== null) return typedPosition
  if (!hasTeam) return ''
  return role === 'lead' ? LEAD_POSITION : MEMBER_POSITION
}

/** 세션 추가 모달의 Name 칸 값. 직접 고쳤으면 그것, 아니면 팀·파트 모달의 추천 이름(없으면 빈 칸) */
export function modalName(typedName: string | null, suggestedName: string | null, hasTeam: boolean): string {
  if (typedName !== null) return typedName
  return hasTeam && suggestedName ? suggestedName : ''
}

/**
 * 이름 바꾸기 PATCH 본문. 바뀐 것만 보낸다 (이름만 고쳤는데 역할이 지워지지 않게).
 * 역할은 옛 꼴 이름 "[FE] Park" 의 역할을 지금 값으로 보므로, 그 세션의 이름만 새 꼴로 바꾸고 싶으면 역할도 같이 보낸다
 */
export function renamePatch(
  session: Pick<Session, 'name' | 'position'>,
  nextName: string,
  nextPosition: string,
): { name?: string; position?: string } {
  const patch: { name?: string; position?: string } = {}
  const currentPosition = positionOf(session) ?? ''
  const isLegacy = !cleanPosition(session.position) && Boolean(session.name && splitLegacyName(session.name).position)
  const currentName = editableNameOf(session)
  if (nextName.trim() !== currentName || isLegacy) patch.name = nextName.trim()
  if (nextPosition.trim() !== currentPosition || isLegacy) patch.position = nextPosition.trim()
  return patch
}
