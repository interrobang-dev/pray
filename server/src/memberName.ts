/** 팀원 이름 "[역할] 성" 의 성. 한국 성 로마자와 영미 성을 섞는다. LLM 이 고르면 흔한 성이 반복돼 서버가 뽑는다 */
export const SURNAMES = [
  'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim',
  'Han', 'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Hong', 'Yoo',
  'Jeon', 'Ko', 'Moon', 'Yang', 'Bae', 'Baek',
  'Smith', 'Johnson', 'Brown', 'Miller', 'Davis', 'Wilson', 'Taylor', 'Clark', 'Lewis', 'Walker',
  'Young', 'King', 'Moore', 'Hall', 'Allen', 'Wright', 'Scott', 'Green', 'Baker', 'Adams',
]

const MAX_ROLE_LENGTH = 12

/** trim 한 역할. 1~12자이고 `[`·`]`·줄바꿈이 없어야 한다. 아니면 null */
export function parseMemberRole(role: unknown): string | null {
  if (typeof role !== 'string') return null
  const trimmed = role.trim()
  if (trimmed.length < 1 || trimmed.length > MAX_ROLE_LENGTH || /[[\]\r\n]/.test(trimmed)) return null
  return trimmed
}

/** 이름의 성 부분 (소문자). "[FE] Hong" → "hong", "[BE] Kim 2" → "kim 2". "[역할]" 꼴이 아니면 이름 전체 */
export function surnameOf(name: string): string {
  const match = /^\[[^\]]*\]\s*(.*)$/.exec(name.trim())
  return (match ? match[1] : name).trim().toLowerCase()
}

/**
 * "[역할] 성". usedNames(같은 팀 세션 이름)에 쓰인 성은 역할이 달라도 피한다 (성이 같으면 헷갈려서).
 * 성이 다 쓰였으면 "Kim 2" 처럼 숫자를 붙인 것 중에서, 그것도 다 쓰였으면 3, 4… 로 고른다
 */
export function pickMemberName(role: string, usedNames: readonly string[], random: () => number = Math.random): string {
  const used = new Set(usedNames.map(surnameOf))
  for (let suffix = 1; ; suffix++) {
    const candidates = SURNAMES.map((surname) => (suffix === 1 ? surname : `${surname} ${suffix}`)).filter(
      (candidate) => !used.has(candidate.toLowerCase()),
    )
    if (candidates.length > 0) {
      const index = Math.min(candidates.length - 1, Math.floor(random() * candidates.length))
      return `[${role}] ${candidates[index]}`
    }
  }
}
