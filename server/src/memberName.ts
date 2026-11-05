import { parsePosition, splitPositionName, type SessionGender } from '@pray/host/hq'

/**
 * 팀원 이름. 역할(FE 등)은 이름에 붙이지 않고 따로 저장한다(hq positions). 한국 이름 로마자와 영미 이름을 섞고, 성별이 이름에서 자연스럽게 읽히는 것만 둔다
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

/** trim 한 역할. 1~12자이고 `[`·`]`·줄바꿈이 없어야 한다. 아니면 null. 규칙은 hq 의 parsePosition (옛 이름 옮기기와 같은 꼴) */
export const parseMemberRole = parsePosition

/** API 로 받은 역할 칸. 빼거나 null·빈 글이면 null(없음·지우기), 꼴이 틀리면 undefined(400) */
export function parsePositionInput(value: unknown): string | null | undefined {
  if (value == null || (typeof value === 'string' && !value.trim())) return null
  return parseMemberRole(value) ?? undefined
}

/** 역할을 앞에 붙인 보이는 이름 "[FE] Jisoo" (claude 의 --name·지시 말풍선의 지시자 이름처럼 글 하나로 보여야 하는 곳). 역할이 없으면 이름 그대로 */
export function withPosition(name: string, position: string | null): string {
  return position ? `[${position}] ${name}` : name
}

/** 'male'·'female' 이면 그대로, 아니면 null */
export function parseGender(gender: unknown): SessionGender | null {
  return gender === 'male' || gender === 'female' ? gender : null
}

/**
 * 이름 비교 키 (trim·소문자). "Minji" → "minji", "Junho 2" → "junho 2".
 * 아직 옮기지 않은 옛 이름 "[FE] Minji" 는 역할을 뗀 "minji" 로 본다
 */
export function givenNameOf(name: string): string {
  const match = /^\[[^\]]*\]\s*(.*)$/s.exec(name.trim())
  return (match ? match[1] : name).trim().toLowerCase()
}

/**
 * 저장할 이름과 역할. 이름이 옛 꼴 "[역할] 이름" 이면 나눈다 (옛 화면·옛 팀장 요청) — 이름에는 역할을 넣지 않는다.
 * 따로 준 역할이 있으면 그것이 이기고 이름에서 뗀 역할은 버린다. 이름이 비면 null (자동 제목)
 */
export function nameAndPosition(name: string | null, position: string | null): { name: string | null; position: string | null } {
  const trimmed = name?.trim() || null
  const split = trimmed ? splitPositionName(trimmed) : null
  if (!split) return { name: trimmed, position }
  return { name: split.name, position: position ?? split.position }
}

/**
 * 이름(역할 없이)과 그 이름의 성별. usedNames(같은 팀 세션 이름)에 쓰인 이름은 역할이 달라도 피한다 (이름이 같으면 헷갈려서).
 * 옛 "[역할] 성" 이름은 겹칠 이름이 없어 그냥 지나간다. 이름이 다 쓰였으면 "Minji 2" 처럼 숫자를 붙인 것 중에서, 그것도 다 쓰였으면 3, 4… 로 고른다.
 * gender 를 주면 그 성별 이름만 (화면의 이름 다시 뽑기가 미리보기 인물의 성별에 맞출 때)
 */
export function pickMemberName(
  usedNames: readonly string[],
  random: () => number = Math.random,
  gender: SessionGender | null = null,
): { name: string; gender: SessionGender } {
  const used = new Set(usedNames.map(givenNameOf))
  const all = [
    ...(gender === 'male' ? [] : FEMALE_NAMES.map((name) => ({ name, gender: 'female' as const }))),
    ...(gender === 'female' ? [] : MALE_NAMES.map((name) => ({ name, gender: 'male' as const }))),
  ]
  for (let suffix = 1; ; suffix++) {
    const candidates = all
      .map(({ name, gender }) => ({ name: suffix === 1 ? name : `${name} ${suffix}`, gender }))
      .filter((candidate) => !used.has(candidate.name.toLowerCase()))
    if (candidates.length > 0) return candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]
  }
}
