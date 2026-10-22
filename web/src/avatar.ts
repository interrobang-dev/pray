/** 세션 ID 해시로 고정되는 캐릭터 외형. 사무실 캔버스와 목록의 아바타 칩이 같이 쓴다 */
export interface Avatar {
  hairStyle: number
  hair: number
  skin: number
  shirt: number
}

export const HAIR_STYLE_COUNT = 6
const HAIR_COLORS = [0x2b2b2b, 0x5a3b22, 0xc9a06a, 0x8b4a3b, 0x3b4f8a, 0xd9d9d9, 0x6b3f8a, 0x1f5f6b]
const SKIN_COLORS = [0xf6d5b8, 0xf0c9a6, 0xe3b48f]
const SHIRT_COLORS = [0xfafafa, 0x3b4a73, 0x5c9a5c, 0x8a6a4f, 0x9aa0ad, 0x6b9bd1, 0xd98c8c, 0xe8c76a]

/** 세션 ID → 32비트 해시 (FNV-1a). 도트 인물 고르기(dotCharacter.ts)도 쓴다 */
export function hashOf(id: string): number {
  let hash = 2166136261
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return hash
}

/** 외부(관찰 전용) 세션도 색은 그대로. 구분은 책상 측판 색으로 한다 */
export function avatarOf(id: string): Avatar {
  const hash = hashOf(id)
  const hairStyle = hash % HAIR_STYLE_COUNT
  return {
    hairStyle,
    hair: HAIR_COLORS[(hash >>> 4) % HAIR_COLORS.length],
    skin: SKIN_COLORS[(hash >>> 8) % SKIN_COLORS.length],
    shirt: SHIRT_COLORS[(hash >>> 12) % SHIRT_COLORS.length],
  }
}

export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}
