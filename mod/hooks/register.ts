import type { EngineInterface, Register } from 'claude-code'

// Pray 서버. 같은 PC 라 loopback 이고 인증이 필요 없다. localhost 는 IPv6(::1)로 갈 수 있어 IP 로 쓴다
const ENDPOINT = 'http://127.0.0.1:4710/api/hook/suggestion'
const BOX_ENDPOINT = 'http://127.0.0.1:4710/api/hook/prompt-box'
/** 입력칸 알림에 대한 서버 답을 기다리는 시간. 넘으면 아무것도 안 한다 */
const BOX_TIMEOUT_MS = 2000
/** plugin.json 의 name. 자기 fill 이 만든 입력칸 변경을 알아보는 데 쓴다 */
const PLUGIN_NAME = 'pray'
/** 곁가지 질문(btw) 요청. 뒤에 요청 ID 를 붙여 GET 으로 질문을 받고 POST 로 답을 보낸다 */
const BTW_ENDPOINT = 'http://127.0.0.1:4710/api/hook/btw/'
/** 서버가 pty 에 `/jk-btw <요청 ID>` 로 친다. Claude Code 내장 /btw 와 이름이 겹치지 않게 앞말을 붙였다 */
const BTW_COMMAND = 'jk-btw'
/** 서버 요청 하나를 기다리는 시간 (fork 는 서버가 60초로 자른다) */
const BTW_FETCH_TIMEOUT_MS = 5000
/** 서버가 만드는 요청 ID 꼴. 사람이 직접 친 다른 인자는 아무것도 안 한다 */
const REQUEST_ID = /^[0-9a-f-]{36}$/

/**
 * Claude Code 내장 /btw 가 질문 앞에 붙이는 안내 (2.1.311 바이너리의 문구 그대로).
 * claude 가 읽는 입력이라 번역하지 않는다. 내장은 이전 문답을 따로 된 메시지로 넣지만 fork 는 prompt 하나라 아래 btwPrompt 가 글로 넣는다
 */
const BTW_REMINDER = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- Do NOT write tool calls or tool output as text (for example invoke or function_calls XML blocks) - nothing you write here is executed; if answering would need reading files, running commands, or searching, say that can't be checked from a side question and suggest asking in the main conversation
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>`

type BtwExchange = { question: string; answer: string }

/** fork 에 넘길 글: 안내 + 이전 곁가지 문답(오래된 것 먼저) + 질문 */
function btwPrompt(question: string, history: readonly BtwExchange[]): string {
  if (history.length === 0) return `${BTW_REMINDER}\n\n${question}`
  const earlier = history
    .map((exchange) => `<side_question>\n${exchange.question}\n</side_question>\n<side_answer>\n${exchange.answer}\n</side_answer>`)
    .join('\n')
  return `${BTW_REMINDER}\n\nEarlier side questions from the user and your answers to them, oldest first (context for this question only):\n${earlier}\n\n${question}`
}

/**
 * 호스트가 웹 세션 claude 에 넣는 세션 ID (`PRAY_SESSION`). 없으면 외부 세션이다.
 * 옛 이름 `JK_CORP_SESSION` 도 한동안 읽는다 — mod 는 파일이 바뀌면 바로 다시 읽혀, 호스트를 재시작하기 전의 웹 세션에는 옛 이름만 있다.
 * `$.env.get` 은 글자 그대로의 이름만 받아 두 번 부른다
 */
async function sessionIdOf($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('PRAY_SESSION')) ?? (await $.env.get('JK_CORP_SESSION'))
}

/** 웹 세션에만 /jk-btw 를 등록한다. 실패는 조용히 넘어간다 (곁가지 질문만 안 된다. 서버가 시간 초과로 실패를 알린다) */
async function registerBtw($: EngineInterface): Promise<void> {
  try {
    if ((await sessionIdOf($)) === undefined) return
    await $.command.register({
      name: BTW_COMMAND,
      description: 'Pray side question (sent by the web chat tab)',
      argumentHint: '<request id>',
      immediate: true,
    })
  } catch {
    // 무시
  }
}

/** 서버에 요청 하나. BTW_FETCH_TIMEOUT_MS 를 넘거나 ok 가 아니면 null */
async function btwFetch($: EngineInterface, url: string, body?: unknown): Promise<string | null> {
  const response = await Promise.race([
    $.http.fetch(
      url,
      body === undefined
        ? { method: 'GET' }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    ),
    $.clock.sleep(BTW_FETCH_TIMEOUT_MS).then(() => null),
  ])
  return response?.ok ? response.text : null
}

/**
 * 곁가지 질문 하나에 답한다: 서버에서 질문·이전 문답을 받아 지금 대화 문맥으로 도구 없이 한 번 답하게 하고(`$.model.fork`) 결과를 서버로 보낸다.
 * fork 는 대화 기록에 남지 않고 진행 중인 차례도 멈추지 않는다. 실패는 조용히 넘어간다 (서버가 시간 초과로 실패를 알린다)
 */
async function answerBtw($: EngineInterface, requestId: string): Promise<void> {
  try {
    const sessionId = await sessionIdOf($)
    if (sessionId === undefined) return
    const url = `${BTW_ENDPOINT}${requestId}?sessionId=${encodeURIComponent(sessionId)}`
    const text = await btwFetch($, url)
    if (text === null) return
    const { question, history } = JSON.parse(text) as { question?: unknown; history?: unknown }
    if (typeof question !== 'string' || !Array.isArray(history)) return
    const result = await $.model.fork({ prompt: btwPrompt(question, history as BtwExchange[]) })
    await btwFetch($, url, result)
  } catch {
    // 무시
  }
}

// 웹 세션(호스트가 PRAY_SESSION 을 넣어 띄운 claude)만 보낸다. 서버가 꺼져 있거나 거절해도 조용히 넘어간다 —
// 훅이 던지면 Claude Code 가 대화에 흐린 오류 줄을 남긴다.
// 엔진 검사가 `$` 를 파일 최상위에 선언한 함수에만 넘기게 해서 register 밖에 둔다
async function post($: EngineInterface, text: string | null): Promise<void> {
  try {
    const sessionId = await sessionIdOf($)
    if (sessionId === undefined) return
    await $.http.fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, text }),
    })
  } catch {
    // 무시: 제안은 있으면 좋은 것이라 실패를 알릴 곳이 없다
  }
}

/**
 * 입력칸 변경을 서버에 알리고, 서버가 `{ fill }` 로 답하면 입력칸을 그 글로 바꾼다 (보내기는 서버가 pty 의 Enter 로 한다).
 * 대기 메시지 취소가 진행 중일 때만 서버가 fill 을 준다. 실패·시간 초과는 조용히 넘어간다 (서버가 시간 초과로 실패를 알린다)
 */
async function reportBox($: EngineInterface, text: string, origin: string): Promise<void> {
  try {
    const sessionId = await sessionIdOf($)
    if (sessionId === undefined) return
    const response = await Promise.race([
      $.http.fetch(BOX_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text, origin }),
      }),
      $.clock.sleep(BOX_TIMEOUT_MS).then(() => null),
    ])
    if (!response?.ok || !response.text) return
    const { fill } = JSON.parse(response.text) as { fill?: unknown }
    if (typeof fill === 'string') await $.prompt.fill({ text: fill, mode: 'replace' })
  } catch {
    // 무시: 취소 기능만 안 된다
  }
}

export const register: Register = on => {
  // 곁가지 질문(btw). 프로세스 시작·mod 다시 불러오기 때마다 등록한다
  on('session.start', async ($, e, next) => {
    await registerBtw($)
    return next(e)
  })

  // 서버가 치는 명령이라 typeahead·/help 에서 숨긴다 (다 쳐서 실행하면 그대로 돈다)
  on('command.describe', { command: BTW_COMMAND }, ($, e, next) => next({ ...e, isHidden: true }))

  // 서버가 친 `/jk-btw <요청 ID>`. 기다리지 않고 바로 끝낸다 — 글(text) 없이 답해 대화에 출력 줄을 남기지 않는다.
  // 요청 ID 꼴이 아니면(사람이 직접 친 것) 아무것도 안 한다
  on('command.run', { command: BTW_COMMAND }, ($, e) => {
    const requestId = e.args.trim()
    if (REQUEST_ID.test(requestId)) void answerBtw($, requestId)
    return {}
  })

  // 엔진의 제안(origin suggestion)과 다른 mod 의 $.prompt.suggest(origin plugin) 모두. 입력칸에 실제로 놓였을 때만
  on('prompt.suggest', async ($, e, next) => {
    const result = await next(e)
    if (result.isShown) void post($, e.text)
    return result
  })

  // 보내면(슬래시 명령·숨은 프롬프트 포함) 엔진이 제안을 지운다. 기다리지 않는다 — 서버가 멈춰 있으면 제출이 늦어진다
  on('prompt.submit', ($, e, next) => {
    void post($, null)
    return next(e)
  })

  // 대기 메시지 취소용. ↑ 로 대기열을 꺼냄(origin engine), 자기 fill 결과, 빈 입력칸(보내서 비워짐 등)만 알린다 (타이핑은 prompt.edit 라 안 온다).
  // 기다리지 않는다: prompt.change 는 한 번에 하나만 돌아서 기다리면 fill 이 만든 다음 변경이 늦어진다
  on('prompt.change', ($, e, next) => {
    const isOwnFill = e.origin.kind === 'plugin' && e.origin.name === PLUGIN_NAME
    if (e.origin.kind === 'engine' || isOwnFill || e.text === '') void reportBox($, e.text, e.origin.kind)
    return next(e)
  })
}
