/**
 * 도트 사무실 인물 고르기 규칙 (순수). 화면(목록 머리·사무실·퇴근 거리·인물 고르기)과 서버(새 세션 자동 배정)가 같이 쓴다.
 * node 모듈을 import 하지 않는다 — 화면 번들에도 들어간다
 */

/** 정면 인물 아틀라스 판 이름. 인물 목록은 이 판 json 의 meta.jkCorp.characters (서버는 web/public/office/ 에서 읽는다) */
export const CHARACTER_SHEET = 'office-v5-down'

/** 머리 고르기 칸 (기본색 다음) */
export const HAIR_COLORS = ['#2a2522', '#4a3226', '#7b4a2a', '#e3b860', '#b4462a', '#a9a9ad', '#e27aa4', '#4a6ad2']
/** 윗옷 고르기 칸 (기본색 다음) */
export const TOP_COLORS = ['#f2f2f0', '#2f2f34', '#2e3a66', '#4a7ad2', '#9cc8f0', '#3c8a4a', '#f2c230', '#e8782a', '#c83a3a', '#8a5ac8']

/** 세션 ID → 32비트 해시 (FNV-1a). 같은 세션은 늘 같은 인물 */
export function hashOf(id: string): number {
  let hash = 2166136261
  for (const ch of id) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0
  return hash
}

/** 아틀라스 meta.jkCorp.characters 의 인물 하나. pool 은 아틀라스에 남은 옛 구분(lead·member)이고 고를 때 보지 않는다. gender 가 없는 아틀라스도 있다 */
export interface DotCharacter {
  id: string
  pool: 'lead' | 'member'
  gender?: 'male' | 'female'
}

/**
 * 세션이 앉을 수 있는 인물 (아틀라스 순서). 역할(팀장·파트장·팀원)과 상관없이 전체다.
 * 성별(서버가 이름을 지을 때 정한 것)이 있으면 같은 성별 인물 — 없거나 그 성별 인물이 없으면 성별을 무시한다
 */
export function candidatesOf(characters: DotCharacter[], gender: 'male' | 'female' | null = null): DotCharacter[] {
  const sameGender = gender ? characters.filter((character) => character.gender === gender) : []
  return sameGender.length > 0 ? sameGender : characters
}

/** 고른 것도 배정도 없는 세션의 인물: 후보 중 세션 ID 해시로. 인물이 없으면 null */
export function pickDotCharacter(sessionId: string, characters: DotCharacter[], gender: 'male' | 'female' | null = null): string | null {
  const candidates = candidatesOf(characters, gender)
  if (candidates.length === 0) return null
  return candidates[hashOf(sessionId) % candidates.length].id
}

/** 세션이 앉을 인물과 색 (책상·목록 머리·Off Duty 거리가 같이 쓴다) */
export interface DotLook {
  id: string
  hair: string | null
  top: string | null
}

/**
 * hq.json characters 의 값. isAuto 가 있으면 서버가 새 세션에 배정한 것이고(인물 고르기 창에서 "Auto"), 없으면 사용자가 고른 것.
 * 옛 코드는 isAuto 를 모르고 그대로 인물·색으로 쓴다
 */
export interface SavedCharacter extends DotLook {
  isAuto?: boolean
}

/**
 * 저장된 인물(고른 것·자동 배정, 아틀라스에 있을 때만)과 그 색 → 없으면 세션 ID 해시로 고른 프리셋(색 없음. 세션 성별이 있으면 그 성별 인물). 인물이 하나도 없으면 null
 */
export function dotLookOf(
  session: {
    id: string
    role: string | null
    character?: SavedCharacter | null
    gender?: 'male' | 'female' | null
  },
  characters: DotCharacter[],
): DotLook | null {
  const saved = session.character
  if (saved && characters.some((character) => character.id === saved.id)) return { id: saved.id, hair: saved.hair, top: saved.top }
  const id = pickDotCharacter(session.id, characters, session.gender ?? null)
  return id ? { id, hair: null, top: null } : null
}

/** 지금 사무실에 보이는 인물 하나 (근무·휴식 세션. 자동 배정이 피할 대상) */
export interface CharacterInUse {
  sessionId: string
  teamId: string | null
  look: DotLook
}

/**
 * 세션들이 지금 보이는 인물 (dotLookOf: 고른 것·자동 배정·없으면 해시). 퇴근 세션은 부른 쪽이 빼고 넘긴다 (외부 세션은 넣는다).
 * 인물이 없어 보이는 것이 없으면 뺀다
 */
export function charactersInUse(
  sessions: { id: string; role: string | null; teamId: string | null; character?: SavedCharacter | null; gender?: 'male' | 'female' | null }[],
  characters: DotCharacter[],
): CharacterInUse[] {
  return sessions.flatMap((session) => {
    const look = dotLookOf(session, characters)
    return look ? [{ sessionId: session.id, teamId: session.teamId, look }] : []
  })
}

/** 겹친 인물에 줄 색 조합: 기본색(null·null) 다음 HAIR_COLORS × TOP_COLORS */
const COLOR_COMBOS: { hair: string; top: string }[] = HAIR_COLORS.flatMap((hair) => TOP_COLORS.map((top) => ({ hair, top })))

/** 시드 난수 (mulberry32, 0 이상 1 미만). 같은 시드면 늘 같은 수열 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** 색 조합을 random 으로 섞은 순서 (Fisher–Yates). 차례대로 돌면 머리색은 그대로이고 윗옷만 한 칸씩 바뀌어 비슷해 보였다 */
function shuffledCombos(random: () => number): { hair: string; top: string }[] {
  const combos = [...COLOR_COMBOS]
  for (let index = combos.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(random() * (index + 1)))
    ;[combos[index], combos[other]] = [combos[other], combos[index]]
  }
  return combos
}

/**
 * 새 세션에 줄 인물과 색 (자동 배정). 후보(candidatesOf) 중
 * ① 지금 보이는 인물(inUse) 중 가장 적게 쓰인 것 ② 같으면 같은 팀에서 안 쓰는 것 ③ 그래도 같으면 세션 ID 해시.
 * 고른 인물을 이미 누가 쓰면 그 세션들의 (머리, 윗옷) 과 다른 조합: 기본색이 비었으면 기본색, 아니면 섞은 순서(shuffledCombos)에서 처음 빈 것 (다 차면 그 순서의 첫 것).
 * random 을 주면(화면 Auto 버튼) ③ 의 동점 고르기와 색 순서가 그 난수라 누를 때마다 달라진다. 안 주면(서버 자동 배정) 결정적 — 동점은 세션 ID 해시,
 * 색 순서는 "세션 ID + 인물" 해시 시드 (세션 하나로만 섞으면 어느 인물이든 두 번째 색이 같아 고정된 느낌이었다)
 * inUse 에 같은 세션이 있으면 뺀다 ("Auto" 로 다시 배정할 때). 인물이 없으면 null
 */
export function assignCharacter(
  session: { id: string; gender: 'male' | 'female' | null; teamId: string | null },
  characters: DotCharacter[],
  inUse: CharacterInUse[],
  random?: () => number,
): DotLook | null {
  const candidates = candidatesOf(characters, session.gender)
  if (candidates.length === 0) return null
  const others = inUse.filter((use) => use.sessionId !== session.id)
  const countOf = (id: string) => others.filter((use) => use.look.id === id).length
  const fewest = Math.min(...candidates.map((character) => countOf(character.id)))
  const leastUsed = candidates.filter((character) => countOf(character.id) === fewest)
  const notInTeam = session.teamId
    ? leastUsed.filter((character) => !others.some((use) => use.teamId === session.teamId && use.look.id === character.id))
    : []
  const finalists = notInTeam.length > 0 ? notInTeam : leastUsed
  const index = random ? Math.min(finalists.length - 1, Math.floor(random() * finalists.length)) : hashOf(session.id) % finalists.length
  const id = finalists[index].id
  const usedCombos = new Set(others.filter((use) => use.look.id === id).map((use) => `${use.look.hair}|${use.look.top}`))
  if (!usedCombos.has('null|null')) return { id, hair: null, top: null }
  const combos = shuffledCombos(random ?? seededRandom(hashOf(`${session.id}:${id}`)))
  const free = combos.find((combo) => !usedCombos.has(`${combo.hair}|${combo.top}`))
  return { id, ...(free ?? combos[0]) }
}
