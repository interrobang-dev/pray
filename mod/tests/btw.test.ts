import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { CommandSpec, ModelForkResult, On } from 'claude-code'

// 테스트 실행 환경에는 있지만 타입 선언에는 없다
declare function setTimeout(callback: () => void, ms: number): unknown

type Sent = { method: string; url: string; body: unknown }
type Response = { status: number; ok: boolean; headers: Record<string, string>; text: string }
/** answer = 바로 답함, late = 답하지 않음(시간 초과), broken = 서버가 꺼짐, missing = 모르는 요청(404) */
type Fetch = 'answer' | 'late' | 'broken' | 'missing'

const REQUEST_ID = '0f8b5c1e-2a3d-4e5f-8a9b-0c1d2e3f4a5b'
const URL = `http://127.0.0.1:4710/api/hook/btw/${REQUEST_ID}?sessionId=abc`
const QUESTION = { question: 'What code word?', history: [{ question: 'First?', answer: 'One.' }] }
const ANSWER: ModelForkResult = {
  isAnswered: true,
  text: 'MANGO',
  usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 },
}

/** 엔진 자리: 등록·fork·fetch 를 기록하고, fetch 는 서버처럼 GET 에 질문을, POST 에 {} 를 답한다 */
function engine(on: On, record: { registered: CommandSpec[]; prompts: string[]; sent: Sent[] }, fetch: Fetch = 'answer') {
  on('command.register', (_, e) => {
    record.registered.push(e)
    return { value: { command: e.name } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.describe', (_, e) => ({ description: e.description, isHidden: e.isHidden }))
  on('model.fork', (_, e) => {
    record.prompts.push(e.prompt)
    return { value: ANSWER }
  })
  on('http.fetch', (_, e) => {
    const method = e.init?.method ?? 'GET'
    record.sent.push({ method, url: e.url, body: e.init?.body === undefined ? null : JSON.parse(e.init.body) })
    if (fetch === 'broken') throw new Error('ECONNREFUSED')
    if (fetch === 'late') return new Promise<{ value: Response }>(() => {})
    if (fetch === 'missing') return { value: { status: 404, ok: false, headers: {}, text: '{"message":"Unknown"}' } }
    const text = method === 'GET' ? JSON.stringify(QUESTION) : '{}'
    return { value: { status: 200, ok: true, headers: {}, text } }
  })
}

const newRecord = () => ({ registered: [] as CommandSpec[], prompts: [] as string[], sent: [] as Sent[] })
/** 사람이 입력칸에서 친 `/jk-btw <args>` */
function run($: Engine, args: string) {
  return $.command.run({ command: 'jk-btw', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
}

// 훅이 기다리지 않고 보낸 fetch·fork 가 끝나도록 잠깐 쉰다
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 100))

test('웹 세션: 시작할 때 /jk-btw 를 숨겨 등록하고, 요청 ID 로 질문을 받아 fork 한 답을 보낸다', async ($, on) => {
  const record = newRecord()
  mock.env(on, { PRAY_SESSION: 'abc' })
  mock.clock(on)
  engine(on, record)

  await $.session.start({ cwd: 'D:/repo', surface: 'terminal', isInteractive: true })
  expect(record.registered).toEqual([
    { name: 'jk-btw', description: expect.stringContaining('side question'), argumentHint: '<request id>', immediate: true },
  ])
  const described = await $.command.describe({
    command: 'jk-btw',
    description: 'x',
    isHidden: false,
    immediate: true,
    provider: { plugin: 'pray', tier: 'user' },
  })
  expect(described.isHidden).toBe(true)

  // 글(text) 없이 바로 끝나 대화에 출력 줄이 안 남는다
  expect(await run($, ` ${REQUEST_ID} `)).toEqual({})
  await settle()
  expect(record.sent).toEqual([
    { method: 'GET', url: URL, body: null },
    { method: 'POST', url: URL, body: ANSWER },
  ])
  expect(record.prompts).toHaveLength(1)
  const prompt = record.prompts[0]!
  expect(prompt).toStartWith('<system-reminder>This is a side question from the user.')
  expect(prompt).toContain('You have NO tools available')
  expect(prompt).toContain('<side_question>\nFirst?\n</side_question>\n<side_answer>\nOne.\n</side_answer>')
  expect(prompt).toEndWith('\n\nWhat code word?')
})

test('사람이 직접 친 /jk-btw (인자 없음·요청 ID 꼴이 아님)는 아무것도 안 한다', async ($, on) => {
  const record = newRecord()
  mock.env(on, { PRAY_SESSION: 'abc' })
  mock.clock(on)
  engine(on, record)

  expect(await run($, '')).toEqual({})
  expect(await run($, 'what is this?')).toEqual({})
  await settle()
  expect(record.sent).toEqual([])
  expect(record.prompts).toEqual([])
})

test('외부 세션(PRAY_SESSION 없음)은 등록하지 않고 실행돼도 아무것도 안 한다', async ($, on) => {
  const record = newRecord()
  mock.env(on, {})
  mock.clock(on)
  engine(on, record)

  await $.session.start({ cwd: 'D:/repo', surface: 'terminal', isInteractive: true })
  expect(record.registered).toEqual([])
  expect(await run($, REQUEST_ID)).toEqual({})
  await settle()
  expect(record.sent).toEqual([])
})

for (const fetch of ['broken', 'missing'] as const) {
  test(`서버가 꺼졌거나 모르는 요청이면 fork 하지 않고 조용하다 (${fetch})`, async ($, on) => {
    const record = newRecord()
    mock.env(on, { PRAY_SESSION: 'abc' })
    mock.clock(on)
    engine(on, record, fetch)

    expect(await run($, REQUEST_ID)).toEqual({})
    await settle()
    expect(record.sent).toHaveLength(1)
    expect(record.prompts).toEqual([])
  })
}

test('서버 답을 5초까지만 기다린다', async ($, on) => {
  const record = newRecord()
  mock.env(on, { PRAY_SESSION: 'abc' })
  const clock = mock.clock(on)
  engine(on, record, 'late')

  expect(await run($, REQUEST_ID)).toEqual({})
  await settle()
  await clock.advance(5000)
  await settle()
  expect(record.sent).toHaveLength(1)
  expect(record.prompts).toEqual([])
})
