import type { SessionGender } from '@jk-corp/host/hq'

/**
 * 팀원 이름 "[역할] 이름" 의 이름. 한국 이름 로마자와 영미 이름을 섞고, 성별이 이름에서 자연스럽게 읽히는 것만 둔다
 * (도트 사무실이 그 성별 인물을 고른다). LLM 이 고르면 흔한 이름이 반복돼 서버가 뽑는다
 */
export const FEMALE_NAMES = [
  'Minji', 'Jisoo', 'Seoyeon', 'Soyeon', 'Yuna', 'Haeun', 'Eunji', 'Sujin', 'Hyejin', 'Yejin', 'Dahye', 'Seulgi', 'Jieun',
  'Emma', 'Olivia', 'Sophia', 'Emily', 'Grace', 'Chloe', 'Hannah', 'Lily', 'Sarah', 'Mia', 'Anna', 'Ella',
]
export const MALE_NAMES = [
  'Junho', 'Minjun', 'Seojun', 'Dohyun', 'Jihoon', 'Hyunwoo', 'Donghyun', 'Jaewon', 'Minho', 'Taehyun', 'Sangwoo', 'Joonyoung', 'Kyungsoo',
  'Daniel', 'James', 'Ethan', 'Noah', 'Liam', 'Lucas', 'Henry', 'Oliver', 'Jacob', 'Ryan', 'Samuel', 'Owen',
]

const MAX_ROLE_LENGTH = 12

/** trim 한 역할. 1~12자이고 `[`·`]`·줄바꿈이 없어야 한다. 아니면 null */
export function parseMemberRole(role: unknown): string | null {
  if (typeof role !== 'string') return null
  const trimmed = role.trim()
  if (trimmed.length < 1 || trimmed.length > MAX_ROLE_LENGTH || /[[\]\r\n]/.test(trimmed)) return null
  return trimmed
}

/** 'male'·'female' 이면 그대로, 아니면 null */
export function parseGender(gender: unknown): SessionGender | null {
  return gender === 'male' || gender === 'female' ? gender : null
}

/** 이름의 역할 뒤 부분 (소문자). "[FE] Minji" → "minji", "[BE] Junho 2" → "junho 2". "[역할]" 꼴이 아니면 이름 전체 */
export function givenNameOf(name: string): string {
  const match = /^\[[^\]]*\]\s*(.*)$/.exec(name.trim())
  return (match ? match[1] : name).trim().toLowerCase()
}

/**
 * "[역할] 이름" 과 그 이름의 성별. usedNames(같은 팀 세션 이름)에 쓰인 이름은 역할이 달라도 피한다 (이름이 같으면 헷갈려서).
 * 옛 "[역할] 성" 이름은 겹칠 이름이 없어 그냥 지나간다. 이름이 다 쓰였으면 "Minji 2" 처럼 숫자를 붙인 것 중에서, 그것도 다 쓰였으면 3, 4… 로 고른다
 */
export function pickMemberName(
  role: string,
  usedNames: readonly string[],
  random: () => number = Math.random,
): { name: string; gender: SessionGender } {
  const used = new Set(usedNames.map(givenNameOf))
  const all = [
    ...FEMALE_NAMES.map((name) => ({ name, gender: 'female' as const })),
    ...MALE_NAMES.map((name) => ({ name, gender: 'male' as const })),
  ]
  for (let suffix = 1; ; suffix++) {
    const candidates = all
      .map(({ name, gender }) => ({ name: suffix === 1 ? name : `${name} ${suffix}`, gender }))
      .filter((candidate) => !used.has(candidate.name.toLowerCase()))
    if (candidates.length > 0) {
      const { name, gender } = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]
      return { name: `[${role}] ${name}`, gender }
    }
  }
}
