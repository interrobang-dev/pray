# jk-corp

Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰만 한다. 설계 전문: `docs/plans/2026-10-20-session-office-design.md`.

## 실행·확인

```
npm install
npm run hooks:install     # ~/.claude/settings.json 에 http 훅 6개 추가 (한 번만. 기존 훅은 안 건드림)
npm run build             # web/dist 생성. 서버가 이걸 정적으로 제공한다
npm run startup:install   # 작업 스케줄러에 jk-corp-host / jk-corp-server 등록 (로그인 시 자동 실행)
Start-ScheduledTask jk-corp-host; Start-ScheduledTask jk-corp-server   # 지금 바로 시작
```

평소 접속: `http://127.0.0.1:4710` (스케줄러로 뜬 서버 + 빌드된 웹). 로그: `~/.claude/jk-corp/logs/*.log`.

설정: `~/.claude/jk-corp/config.json` (저장소 밖. SMTP 비밀번호가 들어 있으니 절대 커밋·출력하지 않는다)

```json
{ "bind": "0.0.0.0", "loginEmails": ["..."], "smtp": { "host", "port", "user", "pass" } }
```

파일이 없으면 127.0.0.1 전용·메일 로그인 없음으로 뜬다. 다른 PC 에서는 `http://<이 PC IP>:4710` → 메일 주소 입력 → 6자리 코드(10분, 5회) → 30일 쿠키. 토큰은 `~/.claude/jk-corp/auth-tokens.json`. HTTPS 가 아니라 쿠키에 Secure 가 없다 (사내망 전제). Windows 방화벽이 node.exe 인바운드를 막으면 다른 PC 에서 안 열린다 — 첫 접속 시 허용 필요.

**멈출 때는 반드시 `scripts/stop.ps1`.** 작업은 숨김 PowerShell 래퍼로 node 를 띄우는데(창 없이 띄우는 S4U 방식은 관리자 권한 필요), `Stop-ScheduledTask` 는 래퍼만 죽이고 node 가 고아로 남아 다음 시작이 pipe/포트 충돌로 죽는다. stop.ps1 은 node 까지 죽인다. 호스트를 멈추면 웹 세션도 죽고, 다음 시작 때 `hq.json.webSessions` 를 읽어 `--resume` 한다.

개발 중 화면 작업: 스케줄러 호스트·서버는 그대로 두고 `npm run dev:web` 만 띄워 `http://localhost:4711` 로 본다 (Vite 가 IPv6 localhost 로 열려 `127.0.0.1` 로는 안 열림. `/api` 는 4710 으로 프록시). 서버·호스트 코드를 고쳤으면 `scripts/stop.ps1` 후 작업을 다시 Start 한다. `npm run dev` (셋 다 tsx 로 실행)는 스케줄러 작업을 멈춘 상태에서만 쓴다. 훅은 Claude Code가 settings.json을 핫리로드하므로 세션 재시작 없이 반영된다.

테스트: `npm test` (host·server의 vitest).

**Claude Code 세션 안에서 호스트를 띄우지 말 것.** 띄우더라도 `ptyPool.ts`가 `CLAUDECODE`·`CLAUDE_*` 환경변수를 지우고 자식을 실행한다. 안 지우면 자식 claude가 중첩 실행으로 판단해 종료 코드 1로 죽는다.

## 구조

- `host/src/index.ts` — named pipe `\\.\pipe\jk-corp-host` 서버. 연결된 모든 클라이언트에 모든 세션 출력을 보낸다 (구독 관리 없음)
- `host/src/ptyPool.ts` — node-pty로 `claude.exe --session-id <uuid>` 실행, 세션별 200KB 링버퍼. claude 경로는 `--claude=` 인자 (스케줄러 환경엔 사용자 PATH 가 없어 설치 스크립트가 넘김)
- `host/src/runtime.ts` — `--name=value` 인자 파싱, `--log=<path>` 면 console 을 파일로 (스케줄러는 환경변수를 못 넘기므로 전부 인자)
- `scripts/install-startup.ps1` · `stop.ps1` · `uninstall-startup.ps1` — 작업 스케줄러 등록·중지·제거. UTF-8 BOM 필수 (Windows PowerShell 5.1 이 BOM 없는 .ps1 을 ANSI 로 읽어 한글이 깨짐)
- `host/src/protocol.ts` — pipe 메시지 타입과 줄 단위 JSON 프레이밍. 서버가 `@jk-corp/host/protocol`로 import
- `host/src/hq.ts` — `~/.claude/jk-corp/hq.json` 읽기/쓰기. 호스트는 `webSessions`(spawn 시 추가, kill 시 제거), 서버는 `rooms`·`seats` 를 쓴다. 같은 파일을 두 프로세스가 read-modify-write 하지만 쓰기가 드물어 허용. 서버가 `@jk-corp/host/hq` 로 import
- `server/src/index.ts` — Express. 세션 목록·전역 SSE·훅 수신 + 웹 세션 생성/입력/크기/종료/터미널 스트림 + 사무실(방·자리) API
- `server/src/hostClient.ts` — pipe 클라이언트. 끊기면 3초마다 재연결
- `server/src/auth.ts` — 인증 코드·토큰 저장소(순수, 시계 주입), loopback 판정, 쿠키 파싱. `/api/*` 미들웨어는 index.ts 에 있고 `/api/auth/*` 와 `/api/hook` 은 예외
- `server/src/mail.ts` — nodemailer 로 인증 메일 발송. `server/src/config.ts` — config.json 읽기
- `web/src/main.tsx` — `/api/auth/me` 로 인증 상태를 보고 `Login` 또는 `App` 을 띄운다
- `server/src/sessions.ts` — 살아 있는 세션 + 훅 상태 + 호스트 목록 + 대화 요약을 합쳐 `Session[]` 생성
- `server/src/liveSessions.ts` — `~/.claude/sessions/<pid>.json` 읽고 pid 생존 확인
- `server/src/hookState.ts` — 훅 이벤트 → 상태 매핑 (순수 함수)
- `server/src/transcript.ts` — jsonl → 제목·마지막 시각·마지막 assistant 텍스트 (순수 함수)
- `server/src/messages.ts` — jsonl → 채팅 메시지 배열. assistant 는 `message.id` 로 묶고 tool_result 를 tool_use 에 붙인다 (순수 함수)
- `server/src/transcriptWatcher.ts` — `~/.claude/projects` 재귀 감시 → 전역 SSE `transcript {sessionId}` (300ms 디바운스)
- `web/src/App.tsx` — 3열: 좌측 세션 목록, 가운데 사무실, 우측 패널 (세션 선택 시. 대화 탭 / 터미널 탭. 터미널은 웹 세션만)
- `web/src/Office.tsx` — PixiJS 8 캔버스. 방=업무, 책상+캐릭터=살아 있는 세션. 스프라이트 없이 Graphics 로 그린다. 데이터가 바뀌면 전부 지우고 다시 그리고, 손 흔들기·타자 애니메이션만 ticker 로 움직인다
- `web/src/types.ts` — 서버 응답 타입 (server 쪽과 손으로 맞춘다)
- `web/src/Chat.tsx` — 말풍선 뷰. 입력칸은 `텍스트` 후 `\r` 을 터미널 입력 API 로 보낸다. 승인 버튼은 Enter(승인)/Esc(거부) 키 전송
- `web/src/Terminal.tsx` — xterm.js. 출력은 세션별 SSE, 입력·크기는 POST
- `hooks/install.mjs` — settings.json 훅 설치 스크립트

## 핵심 개념

- **세션 생존 판정**은 `~/.claude/sessions/*.json`의 pid 로 한다. jsonl 수정 시각은 쓰지 않는다 (비활성 세션도 파일은 남아 있어서 부정확)
- **상태**는 훅 이벤트로만 바뀐다. `UserPromptSubmit`→working, `PermissionRequest`→needs-approval, `PostToolUse`→working(승인 해제), `Stop`→my-turn, `SessionEnd`→ended. 훅이 한 번도 안 온 세션은 `unknown`
- 훅은 `type: "http"`로 서버에 직접 POST 한다. 서버가 꺼져 있으면 그 사이 이벤트는 유실되고 Claude Code 쪽엔 영향 없다 (non-blocking). timeout 2초
- 훅 상태는 서버 메모리에만 있다. 서버 재시작 시 전부 `unknown`에서 다시 시작
- 세션 제목은 jsonl의 `ai-title` 줄에서 가져온다
- **웹 세션 = 호스트 pty 목록에 있는 세션.** `--session-id`로 UUID를 넘겨 pty·jsonl·훅이 같은 키로 묶인다
- 터미널 스트림은 `attach` 요청에 호스트가 링버퍼 스냅샷을 한 번 주고(`snapshot` 이벤트, 화면 reset 후 그림), 이후 `output`을 잇는다. 서버만 재시작해도 브라우저가 SSE 재연결하면 같은 경로로 복원된다
- 새 폴더에서 claude를 띄우면 신뢰 확인 대화상자가 뜨고 **기본 선택이 "No, exit"**다. 사용자가 터미널에서 ↓ Enter를 눌러야 한다. 자동 테스트에서 Enter만 보내면 종료 코드 1로 죽는 게 정상이다
- 호스트 자체가 죽으면 웹 세션도 죽는다. 허용한 설계. `hq.json.webSessions` = "호스트가 살려 둘 세션". claude 가 어떤 이유로든 나가면(exit) 기록을 지운다. 호스트 시작 시 남은 기록을 `--resume` 하고, 폴더가 없으면 건너뛰며 지운다
- **한 번도 대화하지 않은 세션은 resume 이 안 된다** (jsonl 이 없어 "No conversation found" 로 종료 → 기록 자동 삭제). 정상
- 채팅 뷰는 별도 API 없이 **터미널 키 입력**으로 지시를 보낸다. 슬래시 명령은 자동완성이 Enter 를 먼저 먹어 두 번 눌러야 할 수 있다
- 사무실 좌표는 타일(32px) 단위. 자리(`seats`)는 책상을 끌어 놓았을 때만 저장되고, 자리 없는 세션은 화면에서 로비 빈 칸에 3타일 간격으로 임시 배치한다 (저장 안 함)
- 캐릭터 상태 표현: working 타자 애니메이션 + 모니터 켜짐, my-turn 손 들기 + 마지막 말 말풍선, needs-approval 손 들기 + 빨간 말풍선, idle/unknown 반투명, 외부 세션은 회색 계열
- 방 더블클릭 = 대기 메모 편집(`prompt()`), "+ 방" = 기존 방 오른쪽에 추가. 방 이동·삭제·크기 조절은 없다

## 화면 확인 방법 (headless)

Vite 페이지는 SSE 때문에 `--virtual-time-budget` 방식이 멈춘다. `--remote-debugging-port` 로 Edge 를 띄우고 CDP 로 N초 뒤 캡처하는 스크립트를 쓴다 (`scratchpad/cdp-shot.mjs` 패턴: `Page.navigate` → sleep → `Page.captureScreenshot`, 콘솔 오류도 수집). 기존 Edge 와 프로필이 겹치지 않게 `--user-data-dir` 을 따로 준다

## 확인하지 못한 것

- 다른 PC 에서 실제 접속 (방화벽 허용 여부). 서버 쪽 인증 흐름은 이 PC 의 LAN IP 로 검증했다
- 로컬 접속의 "채팅 입력 → claude 응답" 전체 흐름 (API 비용 때문에 자동 검증은 `/help` 까지만 했다)
