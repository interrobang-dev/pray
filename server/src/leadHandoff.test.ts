import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { formatHandoff, HANDOFF_ITEM_LIMIT, HandoffCollector, handoffMessage, leadTranscriptPath, projectSlug, readHandoffSource } from './leadHandoff.js'

const human = (text: string, uuid = `h-${text}`) => JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } })
const reply = (text: string, uuid = `a-${text}`, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', uuid, message: { model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn' }, ...extra })
const toolCall = (uuid = 'tool') =>
  JSON.stringify({ type: 'assistant', uuid, message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }], stop_reason: 'tool_use' } })
const toolResult = () => JSON.stringify({ type: 'user', uuid: 'r', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } })
const boundary = (preserved: string[] = []) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', compactMetadata: { preservedMessages: { uuids: preserved } } })
const summaryLine = (text: string) =>
  JSON.stringify({
    type: 'user',
    isCompactSummary: true,
    message: {
      role: 'user',
      content: `This session is being continued from a previous conversation.\n\nSummary:\n${text}\n\nContinue the conversation from where it left off without asking the user any further questions.\n\nThe messages after this summary are …`,
    },
  })

function collect(lines: string[]) {
  const collector = new HandoffCollector()
  for (const line of lines) collector.push(line)
  return collector.result()
}

describe('HandoffCollector', () => {
  it('keeps human instructions and only the last claude text of each turn', () => {
    const source = collect([human('first'), reply('thinking'), toolCall(), toolResult(), reply('done 1'), human('second'), reply('done 2')])
    expect(source.summary).toBeNull()
    expect(source.items.map((item) => [item.role, item.text])).toEqual([
      ['human', 'first'],
      ['lead', 'done 1'],
      ['human', 'second'],
      ['lead', 'done 2'],
    ])
  })

  it('skips sidechain, meta, notifications, slash commands, interrupts and synthetic replies', () => {
    const source = collect([
      human('go'),
      JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'side' } }),
      JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta' } }),
      human('<task-notification>x</task-notification>'),
      human('<command-name>/clear</command-name>'),
      human('[Request interrupted by user]'),
      JSON.stringify({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'No response requested.' }] } }),
      reply('side reply', 'sr', { isSidechain: true }),
      reply('answer'),
    ])
    expect(source.items.map((item) => item.text)).toEqual(['go', 'answer'])
  })

  it('takes queued commands as human instructions and unwraps pasted content', () => {
    const pasted = '\n\n<pasted_content id="1a2b">\nlong text\n</pasted_content id="1a2b">\n\n'
    const source = collect([
      human(`see ${pasted}`),
      JSON.stringify({ type: 'attachment', uuid: 'q', attachment: { type: 'queued_command', prompt: 'queued one' } }),
    ])
    expect(source.items.map((item) => item.text)).toEqual(['see long text', 'queued one'])
  })

  it('starts over at the last compact summary, keeping the messages it preserved and dropping the tail instruction', () => {
    const source = collect([
      human('old'),
      reply('old reply', 'keep-me'),
      boundary(['keep-me']),
      summaryLine('S1'),
      human('mid'),
      reply('mid reply'),
      boundary(),
      summaryLine('S2'),
      human('new'),
      reply('new reply'),
    ])
    expect(source.summary).toContain('Summary:\nS2')
    expect(source.summary).not.toContain('Continue the conversation')
    expect(source.items.map((item) => item.text)).toEqual(['new', 'new reply'])
    const first = collect([human('old'), reply('old reply', 'keep-me'), boundary(['keep-me']), summaryLine('S1'), human('next')])
    expect(first.items.map((item) => item.text)).toEqual(['old reply', 'next'])
  })

  it('uses an earlier handoff message as the summary and drops its acknowledgement', () => {
    const earlier = handoffMessage('lead', 'Pray', '## 압축 요약\n\nOLD')
    const source = collect([human('before'), human(earlier), reply('인계받음'), human('task'), reply('ok')])
    expect(source.summary).toBe(earlier)
    expect(source.items.map((item) => item.text)).toEqual(['task', 'ok'])
  })

  it('ignores broken lines', () => {
    expect(collect(['{"type":"user", broken', '', human('fine')]).items).toHaveLength(1)
  })
})

describe('formatHandoff', () => {
  const items = (count: number, size: number) =>
    Array.from({ length: count }, (_, index) => ({ role: index % 2 === 0 ? ('human' as const) : ('lead' as const), text: `${index}:${'x'.repeat(size)}`, uuid: null }))

  it('returns null when there is nothing to hand over', () => {
    expect(formatHandoff({ summary: null, items: [] }, 1000)).toBeNull()
  })

  it('keeps the summary first and fills the rest with the latest turns', () => {
    const body = formatHandoff({ summary: 'S'.repeat(500), items: items(10, 200) }, 1500)!
    expect(body.length).toBeLessThanOrEqual(1500 + 200)
    expect(body.startsWith('## 압축 요약')).toBe(true)
    expect(body).toContain('9:')
    expect(body).not.toContain('\n0:')
    expect(body).toMatch(/앞 글 \d+개 생략/)
  })

  it('without a summary lists the turns oldest first', () => {
    const body = formatHandoff({ summary: null, items: items(3, 10) }, 10_000)!
    expect(body.startsWith('## 이전 대화')).toBe(true)
    expect(body.indexOf('0:')).toBeLessThan(body.indexOf('2:'))
    expect(body).not.toContain('생략)')
  })

  it('clips a single long item and a summary larger than the limit', () => {
    const body = formatHandoff({ summary: null, items: [{ role: 'human', text: 'y'.repeat(HANDOFF_ITEM_LIMIT + 50), uuid: null }] }, 100_000)!
    expect(body).toContain('…(이하 50자 생략)')
    const huge = formatHandoff({ summary: 'z'.repeat(5000), items: items(2, 10) }, 1000)!
    expect(huge).toContain('…(이하 4000자 생략)')
    expect(huge).not.toContain('## 요약 뒤의 대화')
  })
})

describe('handoffMessage', () => {
  it('names the previous lead or part lead', () => {
    expect(handoffMessage('lead', 'Pray', 'BODY')).toBe("아래는 이전 팀장(Pray) 세션의 요약이다. 숙지하고, 이어받았다는 것을 존댓말 한 문장으로 짧게 답하라 (예: \"Pray 팀장 작업을 이어받았습니다. 다음 지시 주세요.\")\n\nBODY")
    expect(handoffMessage('part-lead', 'Mina', 'B').startsWith('아래는 이전 파트장(Mina)')).toBe(true)
  })
})

describe('projectSlug', () => {
  it('replaces every non alphanumeric character like Claude Code', () => {
    expect(projectSlug('D:\\workspace\\@private\\jk-corp')).toBe('D--workspace--private-jk-corp')
    expect(leadTranscriptPath('P', 'D:/a b', 'id')).toBe(join('P', 'D--a-b', 'id.jsonl'))
  })
})

describe('readHandoffSource', () => {
  const folder = mkdtempSync(join(tmpdir(), 'handoff-'))
  afterAll(() => rmSync(folder, { recursive: true, force: true }))

  it('streams a jsonl file (CRLF too) and returns null for a missing file', async () => {
    const path = join(folder, 'lead.jsonl')
    writeFileSync(path, [human('hello'), reply('hi')].join('\r\n') + '\r\n')
    expect((await readHandoffSource(path))?.items.map((item) => item.text)).toEqual(['hello', 'hi'])
    expect(await readHandoffSource(join(folder, 'missing.jsonl'))).toBeNull()
  })
})
