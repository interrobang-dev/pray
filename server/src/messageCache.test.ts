import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { firstDifference, InstructionLogCache, messageJsons, MessageVersions, TranscriptMessageCache, versionOf } from './messageCache.js'
import { attachInstructions, parseMessages, withoutQueued, type ChatMessage, type InstructionRecord } from './messages.js'

const line = (record: unknown) => `${JSON.stringify(record)}\n`
const user = (uuid: string, content: unknown) => line({ type: 'user', uuid, timestamp: uuid, message: { role: 'user', content } })
const assistant = (uuid: string, messageId: string, content: unknown[]) => line({ type: 'assistant', uuid, timestamp: uuid, message: { id: messageId, content } })
const toolUse = (id: string, name = 'Bash') => ({ type: 'tool_use', id, name, input: { command: id } })
const toolResult = (uuid: string, toolUseId: string, content: string) => user(uuid, [{ type: 'tool_result', tool_use_id: toolUseId, content }])
const enqueue = (content: string) => line({ type: 'queue-operation', operation: 'enqueue', timestamp: 't', content })
const dequeue = () => line({ type: 'queue-operation', operation: 'dequeue', timestamp: 't' })

describe('TranscriptMessageCache', () => {
  let dir: string
  let path: string
  let cache: TranscriptMessageCache

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jk-corp-message-cache-'))
    path = join(dir, 's.jsonl')
    cache = new TranscriptMessageCache(2)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function read(file = path): Promise<ChatMessage[] | null> {
    const { size, mtimeMs } = statSync(file)
    return cache.read(file, size, mtimeMs)
  }

  /** 읽은 결과가 지금 파일 전체를 parseMessages 한 것과 같은지 */
  async function expectSameAsFull(file = path): Promise<ChatMessage[]> {
    const messages = await read(file)
    expect(messages).toEqual(parseMessages(readFileSync(file, 'utf8')))
    return messages!
  }

  it('reads only what was appended and still matches a full parse when earlier messages change', async () => {
    writeFileSync(path, user('u1', '안녕') + assistant('a1', 'm1', [{ type: 'text', text: '볼게요' }]))
    await expectSameAsFull()
    // 같은 message.id 줄은 앞 메시지에 합쳐지고, 도구 결과는 앞의 도구 호출에 붙는다
    appendFileSync(path, assistant('a2', 'm1', [toolUse('t1')]))
    await expectSameAsFull()
    appendFileSync(path, toolResult('u2', 't1', 'ok'))
    const messages = await expectSameAsFull()
    expect(messages[1].toolUses[0].result).toBe('ok')
    // 대기열: dequeue 의 짝은 그 뒤 줄로 정해진다 (뒤 줄이 없으면 맨 앞, 덧붙은 줄이 오면 그 글)
    appendFileSync(path, enqueue('첫째') + enqueue('둘째') + dequeue())
    expect((await expectSameAsFull()).filter((m) => m.isQueued).map((m) => m.text)).toEqual(['둘째'])
    appendFileSync(path, user('u3', '둘째'))
    expect((await expectSameAsFull()).filter((m) => m.isQueued).map((m) => m.text)).toEqual(['첫째'])
  })

  it('cuts results of tools named in earlier appends the same way as a full parse', async () => {
    writeFileSync(path, assistant('a1', 'm1', [toolUse('jk', 'mcp__jk-corp__jk_wait'), toolUse('b')]))
    await read()
    appendFileSync(path, toolResult('u1', 'jk', 'x'.repeat(3000)) + toolResult('u2', 'b', 'y'.repeat(3000)))
    const [message] = await expectSameAsFull()
    expect(message.toolUses.map((use) => use.result!.length)).toEqual([3000, 2000])
  })

  it('treats an unfinished last line like a full parse does and parses it again once finished', async () => {
    const finished = user('u2', '두 번째')
    writeFileSync(path, user('u1', '첫 번째') + finished.slice(0, 20))
    expect((await expectSameAsFull()).map((m) => m.text)).toEqual(['첫 번째'])
    // 줄바꿈 없이 끝난 완전한 줄도 전체 parse 처럼 보인다
    appendFileSync(path, finished.slice(20, -1))
    expect((await expectSameAsFull()).map((m) => m.text)).toEqual(['첫 번째', '두 번째'])
    appendFileSync(path, `\n${assistant('a1', 'm1', [toolUse('t1')])}`)
    await expectSameAsFull()
    // 덜 쓰인 줄의 도구 호출 이름은 상태에 남지 않고, 다 쓰인 뒤 들어간다
    const call = assistant('a2', 'm2', [toolUse('jk', 'mcp__jk-corp__jk_status')])
    appendFileSync(path, call.slice(0, -1))
    await expectSameAsFull()
    appendFileSync(path, `\n${toolResult('u3', 'jk', 'z'.repeat(2500))}`)
    expect((await expectSameAsFull()).at(-1)!.toolUses[0].result).toHaveLength(2500)
  })

  it('splits UTF-8 at line boundaries only, so multi-byte text across appends stays intact', async () => {
    const text = '한글🙂'.repeat(200)
    // 바이트로 잘라 글자 중간에서 끊긴 채 쓰인 때도 본다
    const full = Buffer.from(user('u1', text) + user('u2', text))
    writeFileSync(path, full.subarray(0, 5))
    await expectSameAsFull()
    for (let end = 5; end < full.length; end += 97) {
      appendFileSync(path, full.subarray(end, end + 97))
      await expectSameAsFull()
    }
    expect((await read())!.map((m) => m.text)).toEqual([text, text])
  })

  it('returns the same objects while size and mtime stay the same', async () => {
    writeFileSync(path, user('u1', '안녕'))
    expect(await read()).toBe(await read())
  })

  it('reads from the start when the file shrank or its bytes before the last end changed', async () => {
    writeFileSync(path, user('u1', '안녕') + user('u2', '두 번째'))
    await read()
    writeFileSync(path, user('u1', '안녕'))
    expect((await expectSameAsFull()).map((m) => m.text)).toEqual(['안녕'])
    // 길이가 같거나 더 긴데 앞이 바뀜
    writeFileSync(path, user('u1', '바꿈') + user('u3', '세 번째 줄입니다'))
    expect((await expectSameAsFull()).map((m) => m.text)).toEqual(['바꿈', '세 번째 줄입니다'])
  })

  it('returns null when the file is gone and keeps only maxEntries files', async () => {
    expect(await cache.read(join(dir, 'none.jsonl'), 10, 0)).toBeNull()
    const files = ['a', 'b', 'c'].map((name) => join(dir, `${name}.jsonl`))
    for (const file of files) writeFileSync(file, user(`u-${file}`, file))
    const first = await read(files[0])
    await read(files[1])
    await read(files[2])
    // 가장 오래 안 쓴 a 는 빠져 다시 해석한다 (새 객체)
    expect(await read(files[0])).not.toBe(first)
    expect(await read(files[0])).toEqual(first)
  })

  it('does not trust a file whose size and mtime are unchanged (documented limit): same stat means cached', async () => {
    writeFileSync(path, user('u1', '하나'))
    const fixed = new Date('2026-01-01T00:00:00Z')
    utimesSync(path, fixed, fixed)
    await read()
    writeFileSync(path, user('u1', '둘둘'))
    utimesSync(path, fixed, fixed)
    expect((await read())!.map((m) => m.text)).toEqual(['하나'])
  })
})

describe('messageJsons·versionOf·firstDifference', () => {
  const message = (id: string, text: string): ChatMessage => ({ id, role: 'user', timestamp: 't', text, toolUses: [] })

  it('joins to the same JSON as JSON.stringify and reuses the string of the same object', () => {
    const messages = [message('a', '하나'), message('b', '"둘"')]
    const jsons = messageJsons(messages)
    expect(`[${jsons.join(',')}]`).toBe(JSON.stringify(messages))
    expect(messageJsons(messages)[0]).toBe(jsons[0])
    expect(messageJsons([])).toEqual([])
  })

  it('versions by content only', () => {
    expect(versionOf(messageJsons([message('a', '하나')]))).toBe(versionOf(messageJsons([message('a', '하나')])))
    expect(versionOf(messageJsons([message('a', '하나')]))).not.toBe(versionOf(messageJsons([message('a', '둘')])))
    expect(versionOf([])).toMatch(/^[0-9a-f]{40}$/)
  })

  it('finds the first changed index, or the shorter length', () => {
    expect(firstDifference(['a', 'b', 'c'], ['a', 'x', 'c'])).toBe(1)
    expect(firstDifference(['a', 'b'], ['a', 'b', 'c'])).toBe(2)
    expect(firstDifference(['a', 'b', 'c'], ['a'])).toBe(1)
    expect(firstDifference(['a'], ['a'])).toBe(1)
    expect(firstDifference([], [])).toBe(0)
  })
})

describe('MessageVersions', () => {
  /** jsonl → 그 목록의 JSON 글 */
  const jsonsOf = (jsonl: string, transform: (messages: ChatMessage[]) => ChatMessage[] = (m) => m) => messageJsons(transform(parseMessages(jsonl)))

  it('sends everything without since or for an unknown version, and from the first changed message otherwise', () => {
    const versions = new MessageVersions(4, 4)
    const base = user('u1', '안녕') + assistant('a1', 'm1', [toolUse('t1')]) + user('u2', '다음')
    const first = versions.update('s', jsonsOf(base), null)
    expect(first.fromIndex).toBe(0)
    expect(versions.update('s', jsonsOf(base), 'f'.repeat(40)).fromIndex).toBe(0)
    // 바뀐 것 없음 → 끝
    expect(versions.update('s', jsonsOf(base), first.version)).toEqual({ version: first.version, fromIndex: 3 })
    // 도구 결과가 앞(1번)의 도구 호출에 붙으면 1번부터
    const withResult = base + toolResult('u3', 't1', 'ok')
    expect(versions.update('s', jsonsOf(withResult), first.version).fromIndex).toBe(1)
  })

  it('starts at a message merged by message.id and at the first queued message that changed', () => {
    const versions = new MessageVersions(4, 4)
    const base = user('u1', '안녕') + assistant('a1', 'm1', [{ type: 'text', text: '하나' }]) + enqueue('대기')
    const { version } = versions.update('s', jsonsOf(base), null)
    expect(versions.update('s', jsonsOf(base + assistant('a2', 'm1', [{ type: 'text', text: '둘' }])), version).fromIndex).toBe(1)
    // 대기 메시지가 받아들여져 isQueued 가 빠지면 (같은 자리, 다른 id·필드) 그 자리부터
    const accepted = base + dequeue() + user('u2', '대기')
    expect(versions.update('s', jsonsOf(accepted), version).fromIndex).toBe(2)
    // 근무가 끝나 대기 메시지가 빠져도 그 자리부터
    expect(versions.update('s', jsonsOf(base, withoutQueued), version).fromIndex).toBe(2)
  })

  it('starts at an earlier user message when an instruction record gets matched later', () => {
    const versions = new MessageVersions(4, 4)
    const jsonl = user('u1', '지시문') + assistant('a1', 'm1', [{ type: 'text', text: '네' }])
    const { version } = versions.update('s', jsonsOf(jsonl), null)
    const record: InstructionRecord = { sessionId: 's', fromSessionId: 'lead', text: '지시문', at: 't' }
    const attached = jsonsOf(jsonl, (messages) => attachInstructions(messages, [record], () => '팀장'))
    expect(versions.update('s', attached, version).fromIndex).toBe(0)
  })

  it('remembers only the last maxVersions versions and maxSessions sessions', () => {
    const versions = new MessageVersions(2, 2)
    /** 둘째 메시지만 다른 목록: 아는 버전이면 1, 모르면 0 */
    const listOf = (text: string) => jsonsOf(user('u0', '고정') + user('u1', text))
    const [first, second, third] = ['하나', '둘', '셋'].map((text) => versions.update('s', listOf(text), null).version)
    const latest = listOf('셋')
    expect(versions.update('s', latest, first).fromIndex).toBe(0)
    expect(versions.update('s', latest, second).fromIndex).toBe(1)
    expect(versions.update('s', latest, third).fromIndex).toBe(2)
    // 같은 내용으로 돌아오면 그 버전을 최근으로 올린다 (그래서 다음 새 버전에 밀려나지 않는다)
    versions.update('s', listOf('둘'), null)
    const fourth = versions.update('s', listOf('넷'), null).version
    expect(versions.update('s', latest, second).fromIndex).toBe(1)
    versions.update('t', latest, null)
    versions.update('u', latest, null)
    expect(versions.update('s', latest, fourth).fromIndex).toBe(0)
  })
})

describe('InstructionLogCache', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jk-corp-instruction-log-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the records of a session, again only when the file changes, and [] without a file', async () => {
    const path = join(dir, 'instructions.jsonl')
    const cache = new InstructionLogCache(path)
    expect(await cache.recordsOf('s1')).toEqual([])
    writeFileSync(path, line({ sessionId: 's1', fromSessionId: null, text: '하나', at: 't1' }))
    const first = await cache.recordsOf('s1')
    expect(first.map((r) => r.text)).toEqual(['하나'])
    expect(await cache.recordsOf('s1')).toBe(first)
    expect(await cache.recordsOf('s2')).toEqual([])
    appendFileSync(path, line({ sessionId: 's1', fromSessionId: 'lead', text: '둘', at: 't2' }))
    expect((await cache.recordsOf('s1')).map((r) => r.text)).toEqual(['하나', '둘'])
    rmSync(path)
    expect(await cache.recordsOf('s1')).toEqual([])
  })
})
