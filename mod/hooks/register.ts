import type { EngineInterface, Register } from 'claude-code'

// jk-corp 서버. 같은 PC 라 loopback 이고 인증이 필요 없다. localhost 는 IPv6(::1)로 갈 수 있어 IP 로 쓴다
const ENDPOINT = 'http://127.0.0.1:4710/api/hook/suggestion'
const BOX_ENDPOINT = 'http://127.0.0.1:4710/api/hook/prompt-box'
/** 입력칸 알림에 대한 서버 답을 기다리는 시간. 넘으면 아무것도 안 한다 */
const BOX_TIMEOUT_MS = 2000
/** plugin.json 의 name. 자기 fill 이 만든 입력칸 변경을 알아보는 데 쓴다 */
const PLUGIN_NAME = 'jk-corp'

// 웹 세션(호스트가 JK_CORP_SESSION 을 넣어 띄운 claude)만 보낸다. 서버가 꺼져 있거나 거절해도 조용히 넘어간다 —
// 훅이 던지면 Claude Code 가 대화에 흐린 오류 줄을 남긴다.
// 엔진 검사가 `$` 를 파일 최상위에 선언한 함수에만 넘기게 해서 register 밖에 둔다
async function post($: EngineInterface, text: string | null): Promise<void> {
  try {
    const sessionId = await $.env.get('JK_CORP_SESSION')
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
    const sessionId = await $.env.get('JK_CORP_SESSION')
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
