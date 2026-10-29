import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 테스트 실행 환경에는 있지만 타입 선언에는 없다
declare function setTimeout(callback: () => void, ms: number): unknown

type Sent = { url: string; body: unknown }

// 엔진 자리: 제안은 isShown 으로 답하고, fetch 는 기록만 한다 (isFetchBroken 이면 서버가 꺼진 것처럼 던진다)
function engine(on: On, isShown: boolean, sent: Sent[], isFetchBroken = false) {
  on('prompt.suggest', () => ({ isShown }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('http.fetch', (_, e) => {
    if (isFetchBroken) throw new Error('ECONNREFUSED')
    sent.push({ url: e.url, body: JSON.parse(e.init?.body ?? 'null') })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
}

// 훅이 기다리지 않고 보낸 fetch 가 끝나도록 잠깐 쉰다
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 100))

// 엔진이 차례 뒤에 내는 제안과 사람이 Enter 로 보낸 프롬프트
const suggest = (text: string) => ({ text, origin: { kind: 'suggestion' } }) as const
const submit = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as const

test('웹 세션: 놓인 제안을 보내고, 제출하면 비운다', async ($, on) => {
  const sent: Sent[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  engine(on, true, sent)

  expect((await $.prompt.suggest(suggest('테스트 돌려줘'))).isShown).toBe(true)
  await settle()
  expect(sent).toEqual([{ url: 'http://127.0.0.1:4710/api/hook/suggestion', body: { sessionId: 'abc', text: '테스트 돌려줘' } }])

  expect((await $.prompt.submit(submit('hello'))).text).toBe('hello')
  await settle()
  expect(sent.map(s => s.body)).toEqual([
    { sessionId: 'abc', text: '테스트 돌려줘' },
    { sessionId: 'abc', text: null },
  ])
})

test('호스트를 재시작하기 전의 웹 세션(옛 이름 JK_CORP_SESSION 만)도 보낸다', async ($, on) => {
  const sent: Sent[] = []
  mock.env(on, { JK_CORP_SESSION: 'old' })
  engine(on, true, sent)

  await $.prompt.suggest(suggest('x'))
  await settle()
  expect(sent.map(s => s.body)).toEqual([{ sessionId: 'old', text: 'x' }])
})

test('두 이름이 다 있으면 PRAY_SESSION 을 쓴다', async ($, on) => {
  const sent: Sent[] = []
  mock.env(on, { PRAY_SESSION: 'new', JK_CORP_SESSION: 'old' })
  engine(on, true, sent)

  await $.prompt.suggest(suggest('x'))
  await settle()
  expect(sent.map(s => s.body)).toEqual([{ sessionId: 'new', text: 'x' }])
})

test('놓이지 않은 제안은 보내지 않는다', async ($, on) => {
  const sent: Sent[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  engine(on, false, sent)

  expect((await $.prompt.suggest(suggest('x'))).isShown).toBe(false)
  await settle()
  expect(sent).toEqual([])
})

test('외부 세션(PRAY_SESSION 없음)은 보내지 않는다', async ($, on) => {
  const sent: Sent[] = []
  mock.env(on, {})
  engine(on, true, sent)

  expect((await $.prompt.suggest(suggest('x'))).isShown).toBe(true)
  await $.prompt.submit(submit('y'))
  await settle()
  expect(sent).toEqual([])
})

test('서버가 꺼져 있어도 제안과 제출은 그대로다', async ($, on) => {
  const sent: Sent[] = []
  mock.env(on, { PRAY_SESSION: 'abc' })
  engine(on, true, sent, true)

  expect((await $.prompt.suggest(suggest('x'))).isShown).toBe(true)
  await settle()
  expect((await $.prompt.submit(submit('y'))).text).toBe('y')
})
