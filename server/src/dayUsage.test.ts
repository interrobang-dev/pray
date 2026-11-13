import { appendFileSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { dayUsageOfDirs, makeDayUsageReader, parseUsageLine } from './dayUsage.js'

const root = mkdtempSync(join(tmpdir(), 'pray-day-usage-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const FROM = new Date(2026, 10, 13).getTime()
const TO = new Date(2026, 10, 14).getTime()
const at = (hour: number, day = 13) => new Date(2026, 10, day, hour).toISOString()

function response(when: string, id: string | null, output: number, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: when,
    ...extra,
    message: { ...(id ? { id } : {}), model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: output, cache_creation_input_tokens: 10, cache_read_input_tokens: 100 } },
  })
}
const user = (when: string) => JSON.stringify({ type: 'user', timestamp: when, message: { role: 'user', content: 'assistant 라는 낱말' } })

describe('parseUsageLine', () => {
  it('응답 줄만, 범위 앞·뒤를 알린다', () => {
    expect(parseUsageLine(user(at(9)), FROM, TO)).toEqual({ kind: 'skip' })
    expect(parseUsageLine(response(at(9, 12), 'a', 1), FROM, TO)).toEqual({ kind: 'before' })
    expect(parseUsageLine(response(at(1, 14), 'a', 1), FROM, TO)).toEqual({ kind: 'after' })
    expect(parseUsageLine('{"type":"assistant", broken', FROM, TO)).toEqual({ kind: 'skip' })
    const synthetic = JSON.stringify({ type: 'assistant', timestamp: at(9), message: { model: '<synthetic>', usage: { output_tokens: 1 } } })
    expect(parseUsageLine(synthetic, FROM, TO)).toEqual({ kind: 'skip' })
    expect(parseUsageLine(Buffer.from(response(at(9), 'a', 7)), FROM, TO)).toMatchObject({ kind: 'response', id: 'a', tokens: { outputTokens: 7, cacheReadTokens: 100 } })
  })
})

describe('makeDayUsageReader', () => {
  it('그날 응답만, 같은 id 는 마지막 줄, 늘어난 바이트만 읽는다', async () => {
    const path = join(root, 'a.jsonl')
    const lines = [
      response(at(22, 12), 'old', 1000),
      user(at(9)),
      response(at(9), 'r1', 5),
      response(at(9), 'r1', 50),
      response(at(10), null, 3, { isSidechain: true }),
    ]
    writeFileSync(path, `${lines.join('\n')}\n${response(at(11), 'partial', 9).slice(0, 30)}`)
    const read = makeDayUsageReader()
    const size = () => statSync(path).size
    const first = await read(path, size(), FROM, TO)
    expect(first).toEqual({ usage: { inputTokens: 2, outputTokens: 53, cacheCreationTokens: 20, cacheReadTokens: 200, turns: 2 }, model: 'claude-opus-5-5' })
    // 덜 쓰인 끝 줄을 마저 쓰고, 같은 id 의 뒤 조각과 새 응답을 덧붙인다
    writeFileSync(path, `${lines.join('\n')}\n${response(at(11), 'partial', 9)}\n${response(at(12), 'r1', 70)}\n`)
    const second = await read(path, size(), FROM, TO)
    expect(second.usage).toEqual({ inputTokens: 3, outputTokens: 82, cacheCreationTokens: 30, cacheReadTokens: 300, turns: 3 })
    appendFileSync(path, `${response(at(1, 14), 'tomorrow', 1)}\n`)
    expect((await read(path, size(), FROM, TO)).usage?.outputTokens).toBe(82)
    // 파일이 줄면 처음부터
    writeFileSync(path, `${response(at(9), 'x', 4)}\n`)
    expect((await read(path, size(), FROM, TO)).usage).toEqual({ inputTokens: 1, outputTokens: 4, cacheCreationTokens: 10, cacheReadTokens: 100, turns: 1 })
  })

  it('1MB 덩어리를 넘는 큰 파일도 거꾸로 읽어 맞게 센다', async () => {
    const path = join(root, 'big.jsonl')
    const filler = JSON.stringify({ type: 'user', timestamp: at(8), toolUseResult: 'x'.repeat(300_000) })
    const lines = [response(at(23, 12), 'y', 999)]
    for (let index = 0; index < 12; index++) lines.push(filler, response(at(9), `r${index}`, 1))
    writeFileSync(path, `${lines.join('\n')}\n`)
    const result = await makeDayUsageReader()(path, statSync(path).size, FROM, TO)
    expect(result.usage?.turns).toBe(12)
    expect(result.usage?.outputTokens).toBe(12)
  })

  it('응답이 없으면 null', async () => {
    const path = join(root, 'empty.jsonl')
    writeFileSync(path, `${user(at(9))}\n`)
    expect(await makeDayUsageReader()(path, statSync(path).size, FROM, TO)).toEqual({ usage: null, model: null })
  })
})

describe('dayUsageOfDirs', () => {
  it('세션 jsonl 과 서브에이전트 파일을 세션마다 더하고, 바뀌지 않은 파일·없는 폴더는 건너뛴다', async () => {
    const dir = join(root, 'project')
    mkdirSync(join(dir, 's1', 'subagents'), { recursive: true })
    writeFileSync(join(dir, 's1.jsonl'), `${response(at(9), 'a', 5)}\n`)
    writeFileSync(join(dir, 's1', 'subagents', 'agent-x.jsonl'), `${JSON.stringify({ type: 'assistant', timestamp: at(9), isSidechain: true, message: { id: 'b', model: 'claude-haiku-5-5', usage: { output_tokens: 7 } } })}\n`)
    writeFileSync(join(dir, 's2.jsonl'), `${response(at(9), 'c', 1)}\n`)
    const old = join(dir, 'old.jsonl')
    writeFileSync(old, `${response(at(9), 'd', 1)}\n`)
    utimesSync(old, new Date(2026, 10, 1), new Date(2026, 10, 1))
    // 그날 바뀐 파일로 (테스트를 도는 실제 날짜와 무관하게)
    const noon = new Date(2026, 10, 13, 12)
    for (const file of [join(dir, 's1.jsonl'), join(dir, 's1', 'subagents', 'agent-x.jsonl'), join(dir, 's2.jsonl')]) utimesSync(file, noon, noon)
    const result = await dayUsageOfDirs([dir, dir, join(root, 'missing')], FROM, TO, makeDayUsageReader())
    expect([...result.keys()].sort()).toEqual(['s1', 's2'])
    expect(result.get('s1')).toEqual({ usage: { inputTokens: 1, outputTokens: 12, cacheCreationTokens: 10, cacheReadTokens: 100, turns: 2 }, model: 'claude-opus-5-5' })
  })
})
