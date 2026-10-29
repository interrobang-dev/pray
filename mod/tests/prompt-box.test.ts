import { expect, mock, test } from 'claude-code/testing'
import type { On, PromptChangeInput, PromptChangeOrigin } from 'claude-code'

// 테스트 실행 환경에는 있지만 타입 선언에는 없다
declare function setTimeout(callback: () => void, ms: number): unknown

type Sent = { url: string; body: unknown }
type Response = { status: number; ok: boolean; headers: Record<string, string>; text: string }
/** answer = 바로 답함, late = 시험이 answerLate 를 부를 때 답함, broken = 서버가 꺼짐 */
type Fetch = 'answer' | 'late' | 'broken'

/** late 일 때 늦은 답을 보내는 함수 */
let answerLate: (response: Response) => void = () => {}

/**
 * 엔진 자리: fetch 는 기록하고 서버처럼 답한다 (꺼낸 글이면 fill, 아니면 {}).
 * fill 은 기록만 한다 (isFillRefused 면 대화상자가 키를 잡은 것처럼 거절)
 */
function engine(on: On, sent: Sent[], filled: string[], fetch: Fetch = 'answer', isFillRefused = false) {
  on('prompt.change', (_, e) => ({ text: e.text }))
  on('prompt.fill', (_, e) => {
    if (isFillRefused) return { isFilled: false, refusal: 'dialog' }
    filled.push(e.text)
    return { isFilled: true }
  })
  on('http.fetch', (_, e) => {
    const body = JSON.parse(e.init?.body ?? 'null') as { text?: string }
    sent.push({ url: e.url, body })
    if (fetch === 'broken') throw new Error('ECONNREFUSED')
    const response = { status: 200, ok: true, headers: {}, text: body.text === '대기1\n대기2' ? '{"fill":"대기1"}' : '{}' }
    if (fetch === 'late') return new Promise<{ value: Response }>(resolve => (answerLate = late => resolve({ value: late })))
    return { value: response }
  })
}

// prompt.change 는 엔진만 올리는 이벤트라 타입의 EventCalls 에는 없지만 시험 엔진의 $ 에는 있다
function change($: unknown, text: string, origin: PromptChangeOrigin): Promise<unknown> {
  const input: PromptChangeInput = { text, cursor: text.length, origin }
  return ($ as { prompt: { change: (e: PromptChangeInput) => Promise<unknown> } }).prompt.change(input)
}

// 훅이 기다리지 않고 보낸 fetch·fill 이 끝나도록 잠깐 쉰다
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 100))
const BOX = 'http://127.0.0.1:4710/api/hook/prompt-box'

test('웹 세션: 꺼냄·자기 fill·빈 입력칸만 알리고, 서버가 준 fill 만 입력칸에 넣는다', async ($, on) => {
  const sent: Sent[] = []
  const filled: string[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  mock.clock(on)
  engine(on, sent, filled)

  await change($, '대기1\n대기2', { kind: 'engine' })
  await settle()
  expect(sent).toEqual([{ url: BOX, body: { sessionId: 'abc', text: '대기1\n대기2', origin: 'engine' } }])
  expect(filled).toEqual(['대기1'])

  await change($, '대기1', { kind: 'plugin', name: 'pray' })
  await change($, '', { kind: 'clear' })
  await change($, '', { kind: 'undo' })
  // 알리지 않는 것: 기록 불러오기, 다른 플러그인의 fill
  await change($, '예전에 보낸 말', { kind: 'history' })
  await change($, '남의 글', { kind: 'plugin', name: 'other' })
  await settle()
  expect(sent.map(s => s.body)).toEqual([
    { sessionId: 'abc', text: '대기1\n대기2', origin: 'engine' },
    { sessionId: 'abc', text: '대기1', origin: 'plugin' },
    { sessionId: 'abc', text: '', origin: 'clear' },
    { sessionId: 'abc', text: '', origin: 'undo' },
  ])
  // 서버가 {} 로 답한 알림에는 아무것도 하지 않는다
  expect(filled).toEqual(['대기1'])
})

test('외부 세션(PRAY_SESSION 없음)은 알리지 않는다', async ($, on) => {
  const sent: Sent[] = []
  const filled: string[] = []
  mock.env(on, {})
  mock.clock(on)
  engine(on, sent, filled)

  await change($, '대기1\n대기2', { kind: 'engine' })
  await change($, '', { kind: 'clear' })
  await settle()
  expect(sent).toEqual([])
  expect(filled).toEqual([])
})

test('서버 답을 2초까지만 기다린다: 그 뒤에 온 fill 은 넣지 않는다', async ($, on) => {
  const sent: Sent[] = []
  const filled: string[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  const clock = mock.clock(on)
  engine(on, sent, filled, 'late')

  await change($, '대기1\n대기2', { kind: 'engine' })
  await settle()
  await clock.advance(2000)
  answerLate({ status: 200, ok: true, headers: {}, text: '{"fill":"대기1"}' })
  await settle()
  expect(sent).toHaveLength(1)
  expect(filled).toEqual([])

  // 2초 안에 온 답은 넣는다
  await change($, '대기1\n대기2', { kind: 'engine' })
  await settle()
  await clock.advance(1500)
  answerLate({ status: 200, ok: true, headers: {}, text: '{"fill":"대기1"}' })
  await settle()
  expect(filled).toEqual(['대기1'])
})

test('서버가 꺼져 있어도 입력칸 변경은 그대로다', async ($, on) => {
  const sent: Sent[] = []
  const filled: string[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  mock.clock(on)
  engine(on, sent, filled, 'broken')

  expect(await change($, '대기1\n대기2', { kind: 'engine' })).toEqual({ text: '대기1\n대기2' })
  await settle()
  expect(sent).toHaveLength(1)
  expect(filled).toEqual([])
})

test('fill 이 거절돼도(대화상자) 조용하다', async ($, on) => {
  const sent: Sent[] = []
  const filled: string[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  mock.clock(on)
  engine(on, sent, filled, 'answer', true)

  expect(await change($, '대기1\n대기2', { kind: 'engine' })).toEqual({ text: '대기1\n대기2' })
  await settle()
  expect(sent).toHaveLength(1)
  expect(filled).toEqual([])
})
