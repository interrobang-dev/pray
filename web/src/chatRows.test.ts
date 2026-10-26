import { describe, expect, it } from 'vitest'
import { buildChatRows, hidingWorkKey, type ChatRow, type Work } from './chatRows'
import type { ChatMessage, ToolUse } from './types'

let nextId = 0
const tool = (name: string, result: string | null = '결과'): ToolUse => ({ id: `t${nextId++}`, name, input: {}, result })
const message = (role: ChatMessage['role'], text = '', toolUses: ToolUse[] = [], patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${nextId++}`,
  role,
  timestamp: new Date(Date.UTC(2026, 9, 24, 1, 0, nextId)).toISOString(),
  text,
  toolUses,
  ...patch,
})

/** relay 대역: 이름이 Relay 인 도구만 묶지 않는다 */
const classify = (toolUse: ToolUse) => (toolUse.name === 'Relay' ? 'relay' : null)
const build = (messages: ChatMessage[], isTurnInProgress: boolean) => buildChatRows(messages, classify, isTurnInProgress)

const works = (rows: ChatRow<string>[]): Work[] => rows.flatMap((row) => (row.kind === 'work' ? [row.work] : []))
/** 줄 모양을 짧게: message·text 는 메시지 글, work 는 "work:<키>", special 은 도구 이름 */
const shape = (rows: ChatRow<string>[]) =>
  rows.map((row) =>
    row.kind === 'work' ? `work:${row.work.key}` : row.kind === 'special' ? `special:${row.toolUse.name}` : `${row.kind}:${row.message.text}`,
  )

describe('buildChatRows', () => {
  it('끝난 차례: 중간 설명 글·도구는 묶음 하나, 마지막 글은 그 아래 답변', () => {
    const first = message('assistant', '찾아본다', [tool('Read')])
    const messages = [message('user', '고쳐 줘'), first, message('assistant', '', [tool('Bash')]), message('assistant', '고쳤다')]
    const rows = build(messages, false)
    expect(shape(rows)).toEqual(['message:고쳐 줘', `work:${first.id}`, 'text:고쳤다'])
    const [work] = works(rows)
    expect(work.isInProgress).toBe(false)
    expect(work.parts.map((part) => part.text)).toEqual(['찾아본다', null])
    expect(work.toolCount).toBe(2)
  })

  it('진행 중: 맨 끝 묶음은 진행 중이고 가장 최근 글도 parts 의 제자리에 든다', () => {
    const first = message('assistant', '찾아본다', [tool('Read')])
    const messages = [message('user', '고쳐 줘'), first, message('assistant', '', [tool('Bash')]), message('assistant', '이제 고친다', [tool('Edit', null)])]
    const rows = build(messages, true)
    expect(shape(rows)).toEqual(['message:고쳐 줘', `work:${first.id}`])
    const [work] = works(rows)
    expect(work.isInProgress).toBe(true)
    expect(work.parts.map((part) => part.text)).toEqual(['찾아본다', null, '이제 고친다'])
  })

  it('진행 중 개수에서 실행 중인(결과 없는) 도구는 빠지고, 끝나 결과가 들어오면 든다', () => {
    const running = tool('Read', null)
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Bash'), tool('Bash'), tool('Bash', null), running])]
    const [work] = works(build(messages, true))
    expect(work.toolCount).toBe(2)
    expect(work.toolCounts).toEqual([{ name: 'Bash', count: 2 }])
    const [finished] = works(build(messages.map((item) => ({ ...item, toolUses: item.toolUses.map((use) => (use === running ? { ...use, result: '결과' } : use)) })), true))
    expect(finished.toolCount).toBe(3)
    expect(finished.toolCounts).toEqual([
      { name: 'Bash', count: 2 },
      { name: 'Read', count: 1 },
    ])
  })

  it('진행 중 묶음에 끝난 도구가 없으면 toolCount 0 (줄 없음), 묶음 키·설명 글은 그대로', () => {
    const first = message('assistant', '찾아본다', [tool('Read', null)])
    const [work] = works(build([message('user', '고쳐 줘'), first], true))
    expect(work.toolCount).toBe(0)
    expect(work.key).toBe(first.id)
    expect(work.parts.map((part) => part.text)).toEqual(['찾아본다'])
  })

  it('진행 중 펼친 parts 에서도 도는 도구는 빠진다', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Read')]), message('assistant', '쓴다', [tool('Write', null)])]
    const [work] = works(build(messages, true))
    expect(work.parts.map((part) => part.toolUses.map((use) => use.name))).toEqual([['Read'], []])
    expect(work.parts[1].text).toBe('쓴다')
  })

  it('끝난 묶음은 결과 없는 도구도 센다', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Bash'), tool('Read', null)]), message('assistant', '끝')]
    const [work] = works(build(messages, false))
    expect(work.isInProgress).toBe(false)
    expect(work.toolCount).toBe(2)
    expect(work.parts[0].toolUses).toHaveLength(2)
  })

  it('도구만 있고 글이 없는 진행 중 묶음', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Read')]), message('assistant', '', [tool('Bash', null)])]
    const [work] = works(build(messages, true))
    expect(work.isInProgress).toBe(true)
    expect(work.parts.every((part) => part.text === null)).toBe(true)
  })

  it('키는 차례가 끝나 답변이 빠져도 그대로 (답변이 묶음 첫 메시지여도)', () => {
    // 글만 있는 첫 메시지가 끝내 답변이 되면 끝난 묶음 parts 에서 빠진다
    const first = message('assistant', '살펴본다')
    const messages = [message('user', '봐 줘'), first, message('assistant', '', [tool('Read')])]
    const live = works(build(messages, true))[0]
    const done = works(build(messages, false))[0]
    expect(live.key).toBe(first.id)
    expect(done.key).toBe(first.id)
    expect(done.parts.map((part) => part.message)).toEqual([messages[2]])
    expect(shape(build(messages, false))).toEqual(['message:봐 줘', `work:${first.id}`, 'text:살펴본다'])
  })

  it('진행 중 시간은 지금까지 (줄에는 안 보이지만 끝나면 쓴다)', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Read')]), message('assistant', '', [tool('Bash', null)])]
    const [work] = works(build(messages, true))
    expect(work.durationMs).toBe(Date.parse(messages[2].timestamp) - Date.parse(messages[1].timestamp))
  })

  it('도구가 하나도 없는 구간은 진행 중이어도 글 말풍선 그대로', () => {
    const messages = [message('user', '설명해 줘'), message('assistant', '먼저'), message('assistant', '그다음')]
    expect(shape(build(messages, true))).toEqual(['message:설명해 줘', 'text:먼저', 'text:그다음'])
    expect(shape(build(messages, false))).toEqual(['message:설명해 줘', 'text:먼저', 'text:그다음'])
  })

  it('relay 가 끼면 그 앞 묶음은 끝난 것, 뒤 묶음만 진행 중', () => {
    const before = message('assistant', '맡긴다', [tool('Read'), tool('Relay')])
    const after = message('assistant', '기다린다', [tool('Bash', null)])
    const rows = build([message('user', '나눠서 해'), before, after], true)
    expect(shape(rows)).toEqual(['message:나눠서 해', `work:${before.id}`, 'special:Relay', `work:${after.id}`])
    expect(works(rows).map((work) => work.isInProgress)).toEqual([false, true])
    // 앞 묶음의 글은 이 구간의 답변이 아니라 설명 글이다
    expect(works(rows)[0].parts[0].text).toBe('맡긴다')
  })

  it('맨 끝이 대기 중 메시지여도 그 앞 claude 묶음이 진행 중', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Bash', null)]), message('user', '이것도', [], { isQueued: true })]
    expect(works(build(messages, true))[0].isInProgress).toBe(true)
  })

  it('맨 끝이 사람 쪽·system 메시지면 진행 중 묶음이 없다', () => {
    const messages = [message('user', '고쳐 줘'), message('assistant', '', [tool('Bash')]), message('system', '알림')]
    expect(works(build(messages, true))[0].isInProgress).toBe(false)
  })
})

describe('hidingWorkKey', () => {
  it('끝난 묶음 안 설명 글이면 그 묶음 키, 답변·글 없는 메시지면 null', () => {
    const explain = message('assistant', '찾아본다', [tool('Read')])
    const toolOnly = message('assistant', '', [tool('Bash')])
    const answer = message('assistant', '고쳤다')
    const rows = build([message('user', '고쳐 줘'), explain, toolOnly, answer], false)
    expect(hidingWorkKey(rows, explain)).toBe(explain.id)
    expect(hidingWorkKey(rows, toolOnly)).toBeNull()
    expect(hidingWorkKey(rows, answer)).toBeNull()
  })

  it('진행 중 묶음의 설명 글은 접혀 있어도 보이므로 null', () => {
    const explain = message('assistant', '찾아본다', [tool('Read')])
    const rows = build([message('user', '고쳐 줘'), explain, message('assistant', '', [tool('Bash', null)])], true)
    expect(hidingWorkKey(rows, explain)).toBeNull()
  })
})
