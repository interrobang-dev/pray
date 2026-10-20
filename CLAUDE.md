# jk-corp

Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰만 한다. 설계 전문: `docs/plans/2026-10-20-session-office-design.md`.

## 실행·확인

```
npm install
npm run hooks:install     # ~/.claude/settings.json 에 http 훅 6개 추가 (한 번만. 기존 훅은 안 건드림)
npm run build             # web/dist 생성. 서버가 이걸 정적으로 제공한다
npm run desktop           # 트레이 앱 실행 (호스트·서버를 자식으로 띄우고 창에 사무실을 연다)
```

**평소에는 트레이 앱으로 쓴다.** 바탕화면 `jk-corp.lnk` (= `node_modules\electron\dist\electron.exe desktop`, 작업 폴더 저장소). 트레이 아이콘: 클릭 = 창 열기, 우클릭 = 상태·서버/호스트 재시작·로그 폴더·로그인 시 자동 실행·종료. 창 X 는 숨기기이고 **트레이 "종료"만이 진짜 종료**(호스트가 꺼져 웹 세션이 끊기고 다음 실행 때 `--resume`). 승인 대기 세션이 있으면 아이콘에 빨간 점. 자식이 죽으면 3초 뒤 재시작, 1분에 5번 넘으면 포기하고 알림. 설치 파일(electron-builder)은 만들지 않았다 — 저장소에서 실행한다.

브라우저로도 `http://127.0.0.1:4710` 접속 가능. 로그: `~/.claude/jk-corp/logs/*.log`. 화면 헤더의 `↻` 는 호스트 재시작 (`POST /api/host/restart` → 호스트가 스스로 종료 → 트레이가 새 코드로 재시작. **작업 스케줄러 방식에서는 종료만 되고 다시 뜨지 않는다**). 웹 세션은 끊겼다가 `--resume` 된다.

설정: `~/.claude/jk-corp/config.json` (저장소 밖. SMTP 비밀번호가 들어 있으니 절대 커밋·출력하지 않는다)

```json
{ "bind": "0.0.0.0", "loginEmails": ["..."], "smtp": { "host", "port", "user", "pass" } }
```

파일이 없으면 127.0.0.1 전용·메일 로그인 없음으로 뜬다. 다른 PC 에서는 `http://<이 PC IP>:4710` → 메일 주소 입력 → 6자리 코드(10분, 5회) → 30일 쿠키. 토큰은 `~/.claude/jk-corp/auth-tokens.json`. HTTPS 가 아니라 쿠키에 Secure 가 없다 (사내망 전제). Windows 방화벽이 node.exe 인바운드를 막으면 다른 PC 에서 안 열린다 — 첫 접속 시 허용 필요.

**트레이 앱 없이 쓰는 대안: 작업 스케줄러.** `npm run startup:install` 이 `jk-corp-host`/`jk-corp-server` 작업을 등록한다(`wscript launch-hidden.vbs` 래퍼로 창 없이. S4U 는 관리자 권한 필요. PowerShell `-WindowStyle Hidden` 은 대화형 작업에서 콘솔 창이 보여 사용자가 닫는 사고가 두 번 났다). 멈출 때는 반드시 `scripts/stop.ps1` (`Stop-ScheduledTask` 는 래퍼만 죽이고 node 가 고아로 남는다). **트레이 앱과 스케줄러를 같이 쓰면 pipe·포트가 충돌한다** — 지금은 스케줄러 작업을 제거한 상태.

개발 중 화면 작업: 트레이 앱(또는 스케줄러)의 호스트·서버는 그대로 두고 `npm run dev:web` 만 띄워 `http://localhost:4711` 로 본다 (Vite 가 IPv6 localhost 로 열려 `127.0.0.1` 로는 안 열림. `/api` 는 4710 으로 프록시). 서버·호스트 코드를 고쳤으면 트레이 메뉴의 재시작을 쓴다. `npm run dev` (셋 다 tsx 로 실행)는 트레이 앱을 종료한 상태에서만 쓴다. 훅은 Claude Code가 settings.json을 핫리로드하므로 세션 재시작 없이 반영된다.

테스트: `npm test` (host·server·mcp 의 vitest).

**Claude Code 세션 안에서 호스트를 띄우지 말 것.** 띄우더라도 `ptyPool.ts`가 `CLAUDECODE`·`CLAUDE_*` 환경변수를 지우고 자식을 실행한다. 안 지우면 자식 claude가 중첩 실행으로 판단해 종료 코드 1로 죽는다.

## 구조

- `host/src/index.ts` — named pipe `\\.\pipe\jk-corp-host` 서버. 연결된 모든 클라이언트에 모든 세션 출력을 보낸다 (구독 관리 없음). `restart` 메시지를 받으면 종료 코드 2 로 나가고 트레이 앱이 다시 띄운다 (0 은 "의도한 중지" 라 안 살린다)
- `host/src/ptyPool.ts` — node-pty로 `claude.exe --session-id <uuid>` 실행, 세션별 200KB 링버퍼. `spawn.extraArgs` 로 `--name`·`--permission-mode` 등 추가 인자를 넘기고 `webSessions` 에 같이 저장해 resume 때도 넘긴다. claude 경로는 `--claude=` 인자 (스케줄러 환경엔 사용자 PATH 가 없어 설치 스크립트가 넘김)
- `host/src/runtime.ts` — `--name=value` 인자 파싱, `--log=<path>` 면 console 을 파일로 (스케줄러는 환경변수를 못 넘기므로 전부 인자)
- `scripts/install-startup.ps1` · `stop.ps1` · `uninstall-startup.ps1` — 작업 스케줄러 등록·중지·제거. UTF-8 BOM 필수 (Windows PowerShell 5.1 이 BOM 없는 .ps1 을 ANSI 로 읽어 한글이 깨짐)
- `desktop/src/main.ts` — Electron 트레이 앱. 호스트·서버를 `node --import tsx src/index.ts` 로 자식 실행(tsx CLI 는 자식 node 를 하나 더 만들어 kill 때 고아가 남으므로 쓰지 않음), 5초마다 `/api/sessions` 로 상태 폴링해 아이콘·툴팁 갱신. `node`·`claude` 경로는 `where` 로 찾고 자식 env 에서 `CLAUDE*`·`ELECTRON_*` 를 지운다
- `desktop/src/children.ts` — 자식 프로세스 재시작 정책. `desktop/src/icon.ts` — 이미지 파일 없이 PNG 를 코드로 만든 트레이 아이콘
- `desktop/tsconfig.json` 은 CommonJS 출력 (Electron main 을 단순하게). 빌드 결과 `desktop/dist/` 는 git 무시
- `host/src/protocol.ts` — pipe 메시지 타입과 줄 단위 JSON 프레이밍. 서버가 `@jk-corp/host/protocol`로 import
- `host/src/team.ts` — `Team` 타입(폴더·그룹·앵커·책상 오프셋·선택적 팀장)과 순수 함수 `normalizeCwd`·`teamOf`·`roleOf`. 서버가 `@jk-corp/host/team` 으로 import. 설계: `docs/plans/2026-10-20-team-folder-design.md`
- `host/src/hq.ts` — `~/.claude/jk-corp/hq.json` 읽기/쓰기. 호스트는 `webSessions`(spawn 시 추가, kill 시 제거), 서버는 `groups`·`teams`·`sessionNames` 를 쓴다 (`seats` 와 기본 그룹 `lobby` 는 없어졌다. 책상 위치는 `teams[].desks`). 같은 파일을 두 프로세스가 read-modify-write 하지만 쓰기가 드물어 허용. **`readHq` 는 모르는 키를 보존한다** — 한쪽 프로세스만 새 코드로 돌 때 다른 쪽 데이터(예: `teams`)가 지워진 적이 있다. 서버가 `@jk-corp/host/hq` 로 import
- `server/src/index.ts` — Express. 세션 목록·전역 SSE·훅 수신 + 웹 세션 생성/입력/크기/종료/터미널 스트림 + 그룹 API + 팀 API(`/api/team/*`: 생성(같은 폴더면 409)·조회·수정(이름·그룹·앵커·팀장)·삭제, 책상 오프셋, 팀 폴더로 팀원 spawn, task 지시·롱폴링 wait). `POST /api/sessions` 는 `cwd` 또는 `teamId`, `isLead` 면 그 팀의 팀장 (살아 있는 팀장이 있으면 409)
- `server/src/lead.ts` — 팀장 세션 지침(`--append-system-prompt`. 도구 사용법과 팀원 정리 규칙)과 spawn 인자, `--mcp-config` JSON (아래 mcp 를 `node --import <tsx loader> mcp/src/index.ts` 로 띄우고 env 로 팀 ID·서버 주소를 넘김. node 는 서버의 `process.execPath`). **지침은 spawn 때 한 번 만든 `extraArgs` 로 `hq.json.webSessions` 에 저장되고 resume 때 저장된 그대로 넘어간다** — 지침을 바꾸면 새로 만든 팀장부터 적용되고, 기존 팀장은 호스트·서버를 재시작해도 옛 지침 그대로다
- `mcp/src/index.ts` — 팀장 claude 에 붙는 stdio MCP 서버. 도구 `jk_spawn_member`·`jk_assign`·`jk_wait`·`jk_status`·`jk_dismiss` 가 서버 `/api/team/*` 를 호출한다 (`mcp/src/teamApi.ts`, fetch 주입). `jk_wait` 기본 120초 — 시간 안에 안 끝나면 null 을 주고 팀장이 다시 부른다
- `server/src/teamState.ts` — 팀장이 팀원에게 준 task 의 상태 기계 (순수, 시계 주입). assign → running → Stop 훅이면 done(result = last_assistant_message), 13초(`ACK_TIMEOUT_MS`) 안에 UserPromptSubmit 이 안 오거나 세션이 exit 하면 failed. 같은 팀원에 running 이 있으면 assign 거부(409). 설계: `docs/plans/2026-10-20-team-orchestration-design.md`
- `server/src/hostClient.ts` — pipe 클라이언트. 끊기면 3초마다 재연결
- `server/src/auth.ts` — 인증 코드·토큰 저장소(순수, 시계 주입), loopback 판정, 쿠키 파싱. `/api/*` 미들웨어는 index.ts 에 있고 `/api/auth/*` 와 `/api/hook` 은 예외
- `server/src/mail.ts` — nodemailer 로 인증 메일 발송. `server/src/config.ts` — config.json 읽기
- `server/src/usage.ts` — 계정 사용량(5시간·주간 한도) 조회. `~/.claude/.credentials.json` 의 OAuth 토큰으로 `api.anthropic.com/api/oauth/usage` 호출 (`/usage` 명령과 같은 데이터, 비공식). `GET /api/usage`, 60초 캐시
- `web/src/main.tsx` — `/api/auth/me` 로 인증 상태를 보고 `Login` 또는 `App` 을 띄운다
- `server/src/sessions.ts` — 살아 있는 세션 + 훅 상태 + 호스트 목록 + 대화 요약을 합쳐 `Session[]` 생성
- `server/src/liveSessions.ts` — `~/.claude/sessions/<pid>.json` 읽고 pid 생존 확인
- `server/src/hookState.ts` — 훅 이벤트 → 상태 매핑 (순수 함수)
- `server/src/transcript.ts` — jsonl → 제목·마지막 시각·마지막 assistant 텍스트 (순수 함수)
- `server/src/messages.ts` — jsonl → 채팅 메시지 배열. assistant 는 `message.id` 로 묶고 tool_result 를 tool_use 에 붙인다 (순수 함수)
- `server/src/transcriptWatcher.ts` — `~/.claude/projects` 재귀 감시 → 전역 SSE `transcript {sessionId}` (300ms 디바운스)
- `web/src/App.tsx` — 3열: 좌측 목록(그룹 라벨 → 팀 카드 → 세션 줄, 맨 아래 로비, 그 아래 휴무(죽은 세션, 기본 접힘·라벨 클릭으로 펼침. 팀 카드·로비에는 살아 있는 세션만). 세션 줄은 상태 색 점·아바타·제목·시각이고 **팀 안 세션은 폴더를 숨긴다**(팀 = 폴더). 글자 배지는 승인 대기와 팀장만), 가운데 사무실, 우측 패널 (세션 선택 시. 대화 탭 / 터미널 탭. 터미널은 웹 세션만)
- `web/src/Office.tsx` — PixiJS 8 캔버스. 그룹=그래픽 공간, 팀=책상 섬, 책상+캐릭터=살아 있는 세션. 스프라이트 없이 Graphics 로 그린다. **모든 좌표는 아트 픽셀(타일 16px)이고 world 를 2배로 키워** 도트가 선명하다 (화면 타일 32px). 데이터가 바뀌면 전부 지우고 다시 그리고, 손 흔들기·타자 애니메이션만 ticker 로 움직인다. 그리기 함수(`drawFigure`·`drawDesk`·`drawGroup`·`drawIsland`·`drawPlant`)만 바꾸면 스프라이트로 교체할 수 있게 레이아웃·상태 로직과 분리돼 있다
- `web/src/avatar.ts` — 세션 ID 해시 → 머리 스타일 6종·머리색·피부·셔츠. 사무실과 목록 아바타 칩이 같이 쓴다. 외부 세션도 색은 같고 **책상 측판·이름표 밑줄이 회색**인 것으로 구분 (캐릭터를 회색으로 하면 사무실이 죽어 보여서 바꿈)
- `web/src/types.ts` — 서버 응답 타입 (server 쪽과 손으로 맞춘다)
- `web/src/Chat.tsx` — 말풍선 뷰. 입력칸(여러 줄)은 Enter = 보내기, Shift+Enter = 줄바꿈 (한글 조합 중 Enter 는 무시). 보낼 때 줄마다 따로 보내고 줄 사이에 `ESC \r`, 끝에 `\r` 을 터미널 입력 API 로 보낸다. 승인 버튼은 Enter(승인)/Esc(거부) 키 전송
- `web/src/Terminal.tsx` — xterm.js. 출력은 세션별 SSE, 입력·크기는 POST. **Shift+Enter 는 가로채 `ESC \r` 로 보낸다** (xterm.js 는 Shift+Enter 도 Enter 와 같은 `\r` 이라 Claude Code 가 제출로 받는다. `ESC \r` 은 Alt+Enter 와 같고 `/terminal-setup` 이 VS Code 에 넣는 값)
- `web/src/UsagePanel.tsx` — 사이드바 하단 고정 게이지. 서버가 주는 사용률을 **남은 비율**로 바꿔 보여 준다. 60초 폴링, 남은 30%↓ 노랑·10%↓ 빨강
- `hooks/install.mjs` — settings.json 훅 설치 스크립트

## 핵심 개념

- **세션 생존 판정**은 `~/.claude/sessions/*.json`의 pid 로 한다. jsonl 수정 시각은 쓰지 않는다 (비활성 세션도 파일은 남아 있어서 부정확)
- **상태**는 훅 이벤트로만 바뀐다. `UserPromptSubmit`→working, `PermissionRequest`→needs-approval, `PostToolUse`→working(승인 해제), `Stop`→my-turn, `SessionEnd`→ended. 훅이 한 번도 안 온 세션은 `unknown`
- 훅은 `type: "http"`로 서버에 직접 POST 한다. 서버가 꺼져 있으면 그 사이 이벤트는 유실되고 Claude Code 쪽엔 영향 없다 (non-blocking). timeout 2초
- 훅 상태는 서버 메모리에만 있다. 서버 재시작 시 전부 `unknown`에서 다시 시작
- **세션 이름은 사용자 지정(`hq.json.sessionNames`) → jsonl 의 `ai-title`(Claude Code 가 첫 대화 뒤 자동으로 붙이는 요약 제목) → ID 앞 8자리 순.** 패널 헤더의 ✎ 로 모달에서 바꾸고 비우면 자동 제목으로 돌아간다 (`PATCH /api/sessions/:id {name}`). 외부 세션에도 붙일 수 있다. 세션 추가 모달의 "세션 이름" 과 팀장이 `jk_spawn_member` 로 준 팀원 이름도 여기에 저장한다. 웹 세션이 exit 하면 서버가 지운다 (외부 세션 것은 남는다). Claude Code 의 `/rename`·`--name` 은 jsonl 에 안 남아 화면에 영향 없다
- **사용량 토큰은 갱신하지 않는다.** 액세스 토큰(약 8시간)은 Claude Code 가 실행 중일 때 스스로 갱신해 파일에 다시 쓴다. 서버는 호출마다 파일을 다시 읽고 401 이면 "토큰 만료" 로 표시한다. refresh token 으로 직접 갱신하면 Claude Code 쪽 토큰과 충돌할 수 있어 일부러 안 한다
- **웹 세션 = 호스트 pty 목록에 있는 세션.** `--session-id`로 UUID를 넘겨 pty·jsonl·훅이 같은 키로 묶인다
- 터미널 스트림은 `attach` 요청에 호스트가 링버퍼 스냅샷을 한 번 주고(`snapshot` 이벤트, 화면 reset 후 그림), 이후 `output`을 잇는다. 서버만 재시작해도 브라우저가 SSE 재연결하면 같은 경로로 복원된다
- 새 폴더에서 claude를 띄우면 신뢰 확인 대화상자가 뜨고 **기본 선택이 "No, exit"**다. 사용자가 터미널에서 ↓ Enter를 눌러야 한다. 자동 테스트에서 Enter만 보내면 종료 코드 1로 죽는 게 정상이다
- 호스트 자체가 죽으면 웹 세션도 죽는다. 허용한 설계. `hq.json.webSessions` = "호스트가 살려 둘 세션". claude 가 어떤 이유로든 나가면(exit) 기록을 지운다. 호스트 시작 시 남은 기록을 `--resume` 하고, 폴더가 없으면 건너뛰며 지운다
- **한 번도 대화하지 않은 세션은 resume 이 안 된다** (jsonl 이 없어 "No conversation found" 로 종료 → 기록 자동 삭제). 정상
- 채팅 뷰는 별도 API 없이 **터미널 키 입력**으로 지시를 보낸다. 슬래시 명령은 자동완성이 Enter 를 먼저 먹어 두 번 눌러야 할 수 있다
- **팀장 지시(`assignTask`·팀원 첫 지시)는 지시문과 Enter 를 따로 보낸다** (`submitInstruction`: 지시문 전송 → 그 세션의 pty 출력이 700ms 동안 없으면 `\r`, 출력이 계속 나와도 8초가 지나면 `\r`). 한 번에 보내거나 고정 간격(300ms~2초)으로 보내면 긴 지시문을 Claude Code TUI 가 붙여넣기로 처리하는 동안 `\r` 이 흡수돼 입력창에 남고(`[Pasted text #1 +1 lines]`), UserPromptSubmit 이 안 와 task 가 failed 가 된다. 그래서 접수 판정 `ACK_TIMEOUT_MS` 는 Enter 최대 대기 8초 + 5초 = 13초
- **그룹 → 팀 → 세션.** 그룹은 그래픽 공간일 뿐이고, 팀은 같은 폴더의 세션 묶음(= 그룹 안의 책상 섬), 세션은 팀 안의 책상이다. 세션의 팀은 저장하지 않고 **cwd 로 매번 판정**한다 (`normalizeCwd`: 소문자·`/`·끝 슬래시 제거, 정확히 같은 폴더만). 팀은 사람이 "+ 팀" 으로만 만든다
- 사무실 좌표는 타일 단위. 팀 섬은 앵커(`teams[].x,y`)를 갖고, 책상은 끌어 놓았을 때만 앵커 기준 오프셋(`desks`)이 저장된다. 오프셋 없는 세션은 섬 안에 2열 자동 정렬. 섬 경계 = 책상들의 경계 상자 + 1타일. 팀 이름표를 끌면 섬과 책상이 같이 움직이고 놓인 그룹으로 `groupId` 가 바뀐다
- **로비 = 팀 없는 세션(웹·외부)이 모이는 고정 구역.** 그룹이 아니라 `hq.json` 에 없고 지울 수도 없다. 그룹들의 오른쪽 끝에 점선으로 그려지고 2열로 놓인다 (드래그 불가). 예전 기본 그룹 `lobby` 는 팀이 없으면 읽을 때 자동으로 지운다
- **그룹·책상은 바닥 격자에 맞춘다.** 격자는 x=0, y=WALL_H 부터 16px 간격이라 `PAD_X`·`PAD_Y` 는 반드시 TILE 배수여야 한다 (아니면 벽이 타일 중간에 걸친다). 책상 그림은 2×3 타일(32×48px) 에 꼭 맞고, 끄는 동안에도 타일에 스냅된다
- **외부 세션(터미널·IDE)** 은 폴더가 같은 팀이 있으면 그 팀 섬에 들어간다 (회색 측판, 관찰만, 드래그 불가, `role` 은 null 이라 지시 대상 아님). 팀이 없으면 로비
- 사무실이 화면보다 크면 휠로 패닝 (Shift+휠 또는 가로 휠 = 가로). 드래그 좌표는 `world.x/y` 를 빼고 계산한다
- 캐릭터 상태 표현: working 타자 애니메이션 + 모니터 켜짐(파랑), my-turn 손 들기 + 마지막 말 말풍선, needs-approval 손 들기 + 빨간 말풍선 + 볼 홍조, idle/unknown/ended 눈 감음. 팀장(`teams[].leadSessionId`)은 이름표 밑줄 금색 + 책상 위 금색 명패, 목록에는 "팀장" 태그만 (팀원은 기본값이라 표시 안 함)
- 화면 테마는 라이트 고정 (`style.css` 의 `:root` 변수. 참고 이미지가 밝은 사무실이라). 터미널 탭만 어둡다. 제목 "jk-corp" 만 Google Fonts `Silkscreen` 도트 폰트, 한글은 시스템 폰트 (한글 도트 폰트가 Google Fonts 에 없음)
- **추가는 계층의 각 단계에서 모달로 한다** (`web/src/Modal.tsx`: 오버레이, Esc·바깥 클릭 닫힘, `Segmented` 세그먼트 컨트롤). 툴바 "+ 그룹"(이름), 그룹 라벨 "+"(그 그룹에 팀 추가. 이름·작업 폴더), 팀 카드 헤더 "+"(그 팀 폴더에 세션 추가. 세그먼트 "팀원 | 팀장" + 첫 지시. 살아 있는 팀장이 있으면 팀장 쪽 비활성). 툴바 "+ 세션 (로비)" 는 폴더 직접 입력. **그룹 라벨·팀 헤더의 "+"·"⋯" 는 마우스를 올렸을 때만 보인다** (`MoreMenu`, 바깥 클릭·Esc 닫힘). 그룹 "⋯" 는 팀이 없을 때만 있고 "그룹 삭제"(팀이 있으면 409), 팀 "⋯" 는 "팀장 해제"(팀장이 있을 때)·"팀 삭제"(세션은 안 죽는다). 팀 섬 더블클릭 = 이름 변경(`prompt()`)
- 그룹 더블클릭 = 대기 메모 편집(`prompt()`), "+ 그룹" = 기존 그룹 오른쪽에 추가. **이름표를 끌면 이동, 오른쪽 아래 모서리 핸들을 끌면 크기 조절** (타일 단위, 최소 4×4, `PATCH /api/groups/:id` 에 x·y·w·h). 겹침 방지는 없고, 그룹을 줄여 책상이 밖에 남으면 사용자가 끌어 넣는다

## 화면 확인 방법 (headless)

Vite 페이지는 SSE 때문에 `--virtual-time-budget` 방식이 멈춘다. `--remote-debugging-port` 로 Edge 를 띄우고 CDP 로 N초 뒤 캡처하는 스크립트를 쓴다 (`scratchpad/cdp-shot.mjs` 패턴: `Page.navigate` → sleep → `Page.captureScreenshot`, 콘솔 오류도 수집). 기존 Edge 와 프로필이 겹치지 않게 `--user-data-dir` 을 따로 준다

## 확인하지 못한 것

- 팀장·팀원 spawn 의 `extraArgs`(`--name`, `--permission-mode bypassPermissions`, `--append-system-prompt`, `--mcp-config`), resume 때 extraArgs 재전달, 팀원 첫 지시 4초 지연 입력, 팀장 세션이 실제로 MCP 도구를 보고 쓰는지. **호스트를 새 코드로 재시작**한 뒤 "+ 팀"(이름·폴더·그룹) → "+ 새 세션" 에서 그 팀 선택 + "팀장으로" → 팀장에게 "팀원 둘에게 A·B 를 시키고 합쳐라" 로 확인해야 한다 (지시 → 결과 수신 흐름, 팀 API, MCP 서버 단독 동작은 검증함). 구 호스트는 `extraArgs` 를 무시하고 `hq.json` 의 `teams` 를 지우며 `restart` 메시지도 무시하므로 **첫 한 번은 트레이 메뉴로** 재시작해야 한다. 화면 `↻` 버튼의 실제 재시작도 그 뒤에 확인할 수 있다 (이 세션에서는 자기 자신이 끊겨 검증 못 함). Claude Code 의 MCP 도구 호출 타임아웃이 `jk_wait` 120초보다 짧으면 기본값을 줄여야 한다
- 섬·책상 마우스 드래그 (headless 로 검증 못 함. API 는 검증함)
- 다른 PC 에서 실제 접속 (방화벽 허용 여부). 서버 쪽 인증 흐름은 이 PC 의 LAN IP 로 검증했다
- 로컬 접속의 "채팅 입력 → claude 응답" 전체 흐름 (API 비용 때문에 자동 검증은 `/help` 까지만 했다)
