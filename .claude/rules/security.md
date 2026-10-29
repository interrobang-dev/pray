---
paths:
  - "server/src/auth*.ts"
  - "server/src/requestGuard*.ts"
  - "server/src/index.ts"
  - "server/src/workspaceSave*.ts"
  - "hooks/install.mjs"
---

# 서버 접근 막기 (인증·Host·Origin·훅)

메일 로그인·쿠키 인증, DNS rebinding 을 막는 Host 검사, CSRF 를 막는 Origin 검사, 훅 경로를 이 PC 로만 받는 규칙과 `index.ts` 미들웨어 순서를 다룬다. 실행·`config.json`·다른 PC 접속 방법은 루트 `CLAUDE.md`, API 경로 전부는 server-api.md 다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

다른 파일에 있는 항목:
- 저장 API(`PUT /api/sessions/:id/file`)의 거절 순서·`workspaceSave.ts` 의 저장 규칙 → server-api.md (`isLocalPageRequest` 판정 규칙은 아래)
- AskUserQuestion 질문 훅을 붙잡는 흐름 → server-api.md

## 구조

- `server/src/auth.ts` — 메일 인증 코드·로그인 토큰 저장소(순수, 시계 주입. 코드 6자리 10분·5회, 재요청 30초, 토큰 30일 `auth-tokens.json`), 소켓 주소 loopback 판정 `isLoopback`(`127.0.0.1`·`::1`·`::ffff:127.0.0.1` — X-Forwarded-For 같은 머리는 안 본다), 쿠키 파싱
- `server/src/requestGuard.ts` — 요청 머리 판정 (순수, `requestGuard.test.ts`): `isAllowedHost`(Host 검사), `isSameOriginRequest`(Origin 검사), `isLoopbackUrl`(http(s) 주소의 이름이 loopback 인지. `workspaceSave.ts` 의 `isLocalPageRequest` 가 같이 쓴다)
- `server/src/index.ts` 의 미들웨어 — 순서대로, `const app = express()` 바로 뒤라 compression·JSON 파서보다 먼저 돈다 (거절할 요청의 본문을 읽지 않는다):
  1. **Host 검사 — 모든 요청**(정적 파일 `web/dist`·SSE·`/api` 전부). 아니면 403 `{ message: 'Host name not allowed' }`. 정적 파일까지 거는 이유: 공격 사이트 도메인으로는 화면부터 안 뜨게, 그리고 경로마다 따지지 않게
  2. **Origin 검사 — `/api` 의 GET·HEAD·OPTIONS 밖 전부** (`/api/auth/*`·훅 포함). 아니면 403 `{ message: 'Cross-site request blocked' }`
  3. **훅 경로 `/api/hook`·`/api/hook/ask`** (`CLAUDE_HOOK_PATH`, Express 라우팅처럼 대소문자·끝 슬래시 무시): loopback 소켓만. 아니면 로그인 쿠키가 있어도 403 `{ message: 'Hooks are accepted only from this PC' }`
  4. `/api/auth/*` 는 인증 없이 통과. loopback 소켓은 무인증, 그 밖은 쿠키 `jk_session`(HttpOnly·SameSite=Lax·30일. HTTPS 가 아니라 Secure 없음)이 맞아야 하고 아니면 401 `{ message: 'Login required' }`
  5. 저장 API 는 라우트 안에서 loopback 소켓과 `isLocalPageRequest` 를 더 본다 (아래)

## 핵심 개념

- **Host 규칙 (`isAllowedHost`).** 이름이 IP 숫자 주소(IPv4, `[IPv6]`)·`localhost`·이 PC 이름(`os.hostname()`, 대소문자 무시)일 때만 통과하고 포트는 보지 않는다. `이름[:포트]`·`[IPv6][:포트]` 꼴을 먼저 정규식으로 걸러 `a@b`·경로가 hostname 을 바꾸지 못하게 한 뒤 URL 로 해석한다 (`127.1` 같은 IPv4 꼴은 점 네 칸으로 맞춰져 숫자 주소로 통과). `localhost.`(끝 점)·FQDN(`pc.corp.local` 같은 DNS 접미사 이름)·다른 이름은 거절. **이유: DNS rebinding** — 공격 사이트가 자기 도메인을 127.0.0.1 로 풀면 브라우저는 같은 출처로 보고 소켓은 loopback 이라 무인증으로 통과해 대화·파일을 읽고 `/input` 으로 지시까지 할 수 있었다. 이때 Host 는 그 도메인 이름이라 도메인을 거절하면 막힌다. **허용 목록 설정은 없다** — 다른 PC 는 IP 나 PC 이름으로 열어야 하고 DNS 접미사가 붙은 이름·다른 별칭이면 403 이다. 막지 못하는 것: 같은 LAN 의 공격자가 LLMNR·NetBIOS 로 이 PC 이름을 127.0.0.1 로 속이는 경우
- **Origin 규칙 (`isSameOriginRequest`).** Origin 이 없으면 통과, `null`(sandbox iframe·`file:` 등)·http(s) 가 아님·해석 안 됨은 거절, Origin 의 host:port 가 Host 와 같으면 통과(기본 포트 80 은 어느 쪽에 적혀도 같다), **둘 다 loopback 이름(127.0.0.1·localhost·[::1])이면 이름·포트가 달라도 통과**. Referer 는 보지 않는다 (지금 브라우저는 GET·HEAD 밖 요청에 늘 Origin 을 붙인다)
  - loopback 예외가 필요한 이유: Vite 개발 서버(4711)의 문자열 proxy `'/api': 'http://127.0.0.1:4710'` 는 `changeOrigin: true` 라 Host 를 `127.0.0.1:4710` 으로 바꾸고 Origin `http://localhost:4711` 은 그대로 넘긴다 (Vite 7.3 `proxyMiddleware` 코드. Origin 을 바꾸는 `rewriteWsOrigin` 은 WebSocket 만). 예외 탓에 이 PC 의 다른 loopback 포트에서 연 페이지도 통과한다 — 이 PC 에서 도는 프로그램이라 받아들인다
  - Origin 을 안 보내는 쪽 (그래서 통과): claude 의 http 훅(Claude Code 가 axios 로 보낸다), mod(`mod/hooks/register.ts` 의 `$.http.fetch`, Claude Code 안), 팀장 MCP(`mcp/src/teamApi.ts`, Node fetch — Node 24 fetch 는 Origin 없이 보낸다(실측)), 트레이(`desktop/src/main.ts`, GET 만), curl
- **CSRF 막기의 범위.** Origin 검사가 `/api` 쓰기 전부에 걸려, 이 PC 에서 연 다른 사이트의 form·no-cors 단순 요청(`text/plain` 본문이든 본문 없는 POST 든 — `/api/server/restart`·`/api/host/restart`·`/api/accounts/logout`·`/api/accounts/login`·`/api/flow/alarms/read-all`·`/interrupt`·`/resume`·`/attachments`)이 403 이다. CORS 머리를 주지 않아 다른 사이트의 CORS fetch 는 사전 요청에서 막힌다. 다른 PC 쿠키는 SameSite=Lax 라 다른 사이트 POST 에 붙지 않는다. **GET 은 Origin 을 보지 않으므로 상태를 바꾸는 API 를 GET 으로 만들지 않는다** (rebinding 은 Host 검사가 막아 다른 사이트는 GET 응답을 읽지 못한다)
- **훅은 이 PC 에서만.** 훅 URL 은 `hooks/install.mjs` 의 `http://127.0.0.1:4710/api/hook`·`/api/hook/ask` 라 소켓이 loopback 이고 Host 가 그 값(숫자 주소)이라 Host 검사도 통과한다. bind `0.0.0.0` 일 때 다른 PC 가 무인증으로 가짜 Stop 을 보내 팀원 task 결과(`teamState.ts` 의 `applyHook`)를 꾸미거나 질문 훅을 붙잡게 하지 못하도록 막는다. 같은 `/api/hook/` 아래라도 `suggestion`·`prompt-box`·`btw/:requestId` 는 mod 용이라 보통 인증 안이다 (mod 는 loopback 소켓이라 통과)
- **저장 API 의 `isLocalPageRequest`** (`workspaceSave.ts`, 공통 Origin 검사보다 엄격): Origin(없으면 Referer)이 loopback 이름이고(포트 무관 — Vite 4711 도) **Host 머리도 loopback 이름**일 때만. `null`·둘 다 없음은 거절 — 로그인한 다른 PC·Origin 없는 도구는 저장하지 못한다. 라우트에서 소켓 loopback 검사와 같이 쓰고, JSON 요구(415)와 합쳐 다른 사이트의 form·no-cors 는 막힌다

## 확인하지 못한 것

- Host·Origin·훅 경로 검사는 단위 테스트와 시험 서버(임시 홈·가짜 pipe·포트 4797·`bind 0.0.0.0`·토큰 파일을 둔 로그인 쿠키)로만 확인했다: Host `evil.com`·`localhost.` 의 GET·POST·정적 `/`·SSE 403, 본문 없는 POST·form 꼴 `text/plain` 의 다른 Origin·`null`·rebinding(Origin·Host 모두 공격 이름) 403, Origin 없는 POST(훅·`/hook/ask`·입력) 200, Vite 꼴(Origin `localhost:4711`·Host `127.0.0.1`) 200, LAN IP 로 `/api/hook`·`/hook/ask`·`/api/HOOK/` 는 쿠키가 있어도 403, LAN 쿠키 + 같은 Origin POST 200·다른 포트 Origin 403, `http://<LAN IP>:포트`·`http://<PC 이름>:포트` 의 화면·SSE·POST 200, Host `[::1]`·`[fe80::1]` 통과, 저장 PUT 은 LAN 에서 그대로 403. 거절된 POST 는 가짜 호스트에 입력이 닿지 않았다. Vite(다른 포트 → 시험 서버) + headless Chrome 으로 화면이 뜨고 페이지 안 POST·PATCH 가 200, 콘솔 오류 없음
- 실제 claude http 훅·mod 요청의 Origin 은 재지 않았다. Host 는 URL 의 `127.0.0.1:4710` 이라 통과한다. Origin 은 서버 쪽 HTTP 클라이언트(axios·Bun fetch)라 붙이지 않을 것으로 판단했다 — 붙더라도 `http://127.0.0.1:4710` 이면 통과, 다른 값이면 훅이 403 이 되어 상태 점·입력칸 제안이 멈춘다(훅은 non-blocking 이라 claude 는 그대로 돈다). 실행 중인 서버(트레이)에 반영한 뒤 상태 점이 바뀌는지, 입력칸 제안·btw 가 도는지 볼 것
- 실제 다른 PC 에서 PC 이름·IP 로 접속, 사내 DNS 접미사 이름으로 열 때(403 이 맞다)는 보지 못했다
