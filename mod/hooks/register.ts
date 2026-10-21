import type { EngineInterface, Register } from 'claude-code'

// jk-corp 서버. 같은 PC 라 loopback 이고 인증이 필요 없다. localhost 는 IPv6(::1)로 갈 수 있어 IP 로 쓴다
const ENDPOINT = 'http://127.0.0.1:4710/api/hook/suggestion'

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
}
