# jk-corp

Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰만 한다. 설계 전문: `docs/plans/2026-10-20-session-office-design.md`.

하지 않는 것: 외부 세션 조작(관찰만) · 설치 파일(electron-builder) — 저장소에서 실행한다 · HTTPS(사내망 전제) · Claude 토큰 직접 갱신(Claude Code 가 한다).

## 문서 지도 — 영역별 상세는 `.claude/rules/`

이 파일에는 어디서나 지킬 것, 실행·확인 방법, 모듈 한 줄 역할만 있다. 모듈 설명 전문·영역별 핵심 개념·영역별 "확인하지 못한 것" 은 `.claude/rules/<주제>.md` 에 있다.

- rules 파일마다 frontmatter `paths:` 가 걸려 있어 **그 경로의 파일을 Read·Write·Edit 하면 저절로 읽힌다. 그 경로 파일을 열기 전에는 읽히지 않는다.**
- 그래서 **어떤 영역을 고치거나 계획(설계·영향 검토·질문에 답하기)하기 전에 아래 표의 rules 파일을 Read 로 먼저 읽는다.** 계획 단계에서는 코드를 아직 안 열어 저절로 읽히지 않는다. 여러 영역에 걸친 일이면 해당 파일을 모두 읽는다.
- 한 내용은 주 영역 한 곳에만 있고 다른 곳은 "→ xxx.md" 로 가리킨다. rules 본문의 "위·아래 핵심 개념 …" 은 한 파일이던 때의 말이라, 가리키는 항목이 다른 파일에 있으면 그 파일 머리의 "다른 파일에 있는 항목" 에 적혀 있다.

| 파일 | 다루는 것 |
|---|---|
| `host.md` | 호스트(pipe·pty·resume·퇴근 기록)·`hq.json`(`hq.ts` 전문)·트레이 앱·스케줄러 스크립트·훅 설치·그룹 할 일 저장 규칙 |
| `team.md` | 팀·파트 판정, 팀장·파트장 지침·MCP 도구, task 상태, 팀원 이름·모델·effort, worktree 파트 |
| `server-api.md` | 서버 API 경로 전부(`index.ts` 전문), 세션 목록·jsonl 요약·훅 상태·표시 상태 계산, shell·작업 파일·첨부, AskUserQuestion, 세션 이름·역할·인물, 폴더 신뢰, 모델·effort 바꾸기 |
| `queue-interrupt.md` | mod(입력 제안·입력칸 알림), 보내기의 함정, 대기열·대기 메시지 취소, 작업 중지 |
| `accounts.md` | 사용량 조회·사용량 창, Claude 계정 보관·전환·로그인·로그아웃 (서버·화면) |
| `flow.md` | 플로우(flow.team) 알림 서버·화면 |
| `chat.md` | 대화 메시지(`messages.ts`)와 대화 탭 전체, 마크다운, 작업 파일, Shells, 터미널 탭 |
| `web-app.md` | App.tsx(목록·패널·상태 표시줄·폰·사무실 숨기기), 응답 타입·공통 문구, 테마·스크롤바·로고, 모달·메뉴, 그룹 할 일 화면, 역할 칩, 모델 변경 창 |
| `office.md` | 사무실 캔버스(Office.tsx 전문), 배치·섬 밀기·그룹 크기, 고정 꾸미기, 라운지·라운지 휴식, 퇴근 거리 |
| `office-art.md` | 목록 아바타·인물 고르기·색 바꾸기, 스프라이트 파이프라인·아틀라스 |

저절로 읽히는 경로는 각 파일 머리의 `paths:` 를 본다.

### 문서를 고치는 곳

- 기능을 끝내 달라진 것이 있으면 **그 영역의 rules 파일에서 그 줄을 고쳐 쓴다** (덧붙이지 않는다. 틀려진 것은 지운다). 이 파일은 어디서나 지킬 규칙·실행 방법·모듈 한 줄·지도가 달라질 때만 고친다.
- 새 모듈을 만들면 아래 "구조" 에 한 줄, 주 영역 rules 파일에 설명 전문, 그 파일 `paths:` 에 경로를 더한다. 새 영역이면 rules 파일을 새로 만들고 위 표에 더한다.
- 확인하지 못한 것은 그 영역 rules 파일의 "확인하지 못한 것" 절에 쓰고, 확인하면 지운다.
- rules 파일 하나는 **4만 자 이하**로 둔다 (나중에 읽히는 파일은 그보다 길면 앞부분만 읽힌다. `node -e "console.log(require('fs').readFileSync('<파일>','utf8').length)"`). 넘으면 주제로 나눈다. 이 파일은 2만 자 안팎으로 둔다 (모든 세션이 매 차례 읽는다). `@import` 는 쓰지 않는다 (같이 읽혀 줄지 않는다).

## 실행·확인

```
npm install
npm run hooks:install     # ~/.claude/settings.json 에 http 훅 7개 추가 (상태용 6개 + AskUserQuestion 질문 훅 1개. 한 번만. 기존 훅은 안 건드림)
npm run build             # web/dist 생성. 서버가 이걸 정적으로 제공한다
npm run desktop           # 트레이 앱 실행 (호스트·서버를 자식으로 띄우고 창에 사무실을 연다)
```

**평소에는 트레이 앱으로 쓴다.** 바탕화면 `jk-corp.lnk` (= `node_modules\electron\dist\electron.exe desktop`, 작업 폴더 저장소). 바로가기는 빌드하지 않고 `desktop/dist/` 를 그대로 실행하므로 `desktop/src` 를 고치면 `npm run build --workspace desktop` 뒤 트레이 Quit → 다시 켜야 한다 (`npm run desktop` 은 빌드한 뒤 띄우고, 루트 `npm run build` 는 web 만 빌드한다). 트레이 아이콘: 클릭 = 창 열기, 우클릭 = 상태·서버/호스트 재시작·로그 폴더·로그인 시 자동 실행·종료 (메뉴·툴팁·확인 창·알림 글자는 영어: Restart server·Restart host·Open log folder·Launch at login·Quit). 창 X 는 숨기기이고 **트레이 "Quit"만이 진짜 종료**(호스트가 꺼져 웹 세션이 끊기고 다음 실행 때 `--resume`). 승인 대기 세션이 있으면 아이콘에 빨간 점. 자식이 죽으면 3초 뒤 재시작, 1분에 5번 넘으면 포기하고 알림. 설치 파일(electron-builder)은 만들지 않았다 — 저장소에서 실행한다.

브라우저로도 `http://127.0.0.1:4710` 접속 가능. 로그: `~/.claude/jk-corp/logs/*.log`. 화면 아래 상태 표시줄의 연결 상태 옆 `↻` 로 재시작한다. 호스트 ↻ = `POST /api/host/restart` → 호스트가 종료 코드 2 로 나감 → 트레이가 새 코드로 다시 띄움. 웹 세션은 끊겼다가 `--resume` 된다. 서버 ↻ = `POST /api/server/restart` → 서버가 응답을 보낸 뒤 종료 코드 2 로 나감 → 트레이가 새 코드로 다시 띄움. 몇 초 끊기고 세션은 그대로지만, 서버 메모리에만 있는 훅 상태(다음 훅부터 다시 보인다)·붙잡은 질문(터미널 탭에서 답한다)·입력칸 제안은 사라진다. **작업 스케줄러 방식에서는 둘 다 종료만 되고 다시 뜨지 않는다** (서버는 `npm run dev` 에서도).

설정: `~/.claude/jk-corp/config.json` (저장소 밖. SMTP 비밀번호가 들어 있으니 절대 커밋·출력하지 않는다)

```json
{ "bind": "0.0.0.0", "loginEmails": ["..."], "smtp": { "host", "port", "user", "pass" } }
```

파일이 없으면 127.0.0.1 전용·메일 로그인 없음으로 뜬다. 다른 PC 에서는 `http://<이 PC IP>:4710` → 메일 주소 입력 → 6자리 코드(10분, 5회) → 30일 쿠키. 토큰은 `~/.claude/jk-corp/auth-tokens.json`. HTTPS 가 아니라 쿠키에 Secure 가 없다 (사내망 전제). Windows 방화벽이 node.exe 인바운드를 막으면 다른 PC 에서 안 열린다 — 첫 접속 시 허용 필요.

**트레이 앱 없이 쓰는 대안: 작업 스케줄러.** `npm run startup:install` 이 `jk-corp-host`/`jk-corp-server` 작업을 등록한다(`wscript launch-hidden.vbs` 래퍼로 창 없이. S4U 는 관리자 권한 필요. PowerShell `-WindowStyle Hidden` 은 대화형 작업에서 콘솔 창이 보여 사용자가 닫는 사고가 두 번 났다). 멈출 때는 반드시 `scripts/stop.ps1` (`Stop-ScheduledTask` 는 래퍼만 죽이고 node 가 고아로 남는다). **트레이 앱과 스케줄러를 같이 쓰면 pipe·포트가 충돌한다** — 지금은 스케줄러 작업을 제거한 상태.

개발 중 화면 작업: 트레이 앱(또는 스케줄러)의 호스트·서버는 그대로 두고 `npm run dev:web` 만 띄워 `http://localhost:4711` 로 본다 (Vite 가 IPv6 localhost 로 열려 `127.0.0.1` 로는 안 열림. `/api` 는 4710 으로 프록시). 서버·호스트 코드를 고쳤으면 트레이 메뉴의 재시작을 쓴다. `npm run dev` (셋 다 tsx 로 실행)는 트레이 앱을 종료한 상태에서만 쓴다. 훅은 Claude Code가 settings.json을 핫리로드하므로 세션 재시작 없이 반영된다.

테스트: `npm test` (host·server·mcp·web 의 vitest. web 은 순수 함수만).

**Claude Code 세션 안에서 호스트를 띄우지 말 것.** 띄우더라도 `ptyPool.ts`가 `CLAUDECODE`·`CLAUDE_*` 환경변수를 지우고 자식을 실행한다. 안 지우면 자식 claude가 중첩 실행으로 판단해 종료 코드 1로 죽는다.

## 구조 (모듈 한 줄 — 상세는 → 표의 rules 파일)

호스트·트레이 → `host.md`
- `host/src/index.ts` — named pipe `\\.\pipe\jk-corp-host` 서버. spawn·resume·forget·kill·restart·restart-session 처리, 퇴근 기록 보관 기간 정리
- `host/src/ptyPool.ts` — node-pty 로 `claude.exe` 실행·세션별 링버퍼, extraArgs 저장, 끝나면 퇴근 기록, 모델 바꾸기 재시작, 웹 세션에 mod 불러오기
- `host/src/hq.ts` — `~/.claude/jk-corp/hq.json` 읽기·쓰기 (웹 세션·퇴근 기록·그룹·팀·이름·인물·성별·역할·그룹 할 일·목록 순서)
- `host/src/runtime.ts` — `--name=value` 인자 파싱, `--log=` 파일 로그 · `host/src/protocol.ts` — pipe 메시지 타입·줄 단위 JSON
- `desktop/src/main.ts`·`children.ts`·`icon.ts` — Electron 트레이 앱, 자식 재시작 정책, 코드로 만든 트레이·창 아이콘
- `scripts/*.ps1` — 작업 스케줄러 등록·중지·제거 · `hooks/install.mjs` — settings.json 훅 설치

팀 → `team.md`
- `host/src/team.ts` — Team·Part 타입, cwd → 팀·파트·역할 판정
- `server/src/lead.ts` — 팀장·파트장 지침·spawn 인자·`--mcp-config` · `server/src/teamState.ts` — task 상태 기계 · `server/src/taskWait.ts` — jk_wait 롱폴링(대기 시간·헤더 먼저 보내고 공백 흘리기)
- `server/src/memberModel.ts` — 팀원 모델·effort 값, extraArgs 의 `--model`·`--effort` 읽고 바꾸기 · `server/src/memberName.ts` — 팀원 이름 뽑기·역할 검증
- `server/src/worktree.ts` — 파트 worktree 만들기·지우기, `~/.claude.json` 폴더 신뢰 기록
- `mcp/src/index.ts`·`teamApi.ts` — 팀장·파트장 claude 에 붙는 stdio MCP 서버 (`jk_spawn_member`·`jk_assign`·`jk_wait`·`jk_status`·`jk_dismiss`)

서버 → `server-api.md` (계정·플로우·대화·대기열은 각 파일)
- `server/src/index.ts` — Express: 모든 API·SSE·훅 수신
- `server/src/sessions.ts` — 세션 목록(근무·휴식·퇴근 합치기, 생성순) · `transcript.ts` — jsonl 요약 · `transcriptWatcher.ts` — jsonl 감시 → SSE
- `server/src/hookState.ts` — 훅 → 훅 상태 · `turnEnd.ts` — waiting·done·my-turn 판정 · `liveSessions.ts` — pid 생존 확인
- `server/src/shells.ts` — 백그라운드 shell·작업 판정, 출력 끝 N줄 · `scratchpad.ts` — 세션 작업 폴더·첨부 저장
- `server/src/askQuestion.ts` — AskUserQuestion 해석·답 · `serialRunner.ts` — 한 번에 하나 실행기 · `hostClient.ts` — pipe 클라이언트
- `server/src/auth.ts`·`mail.ts`·`config.ts` — 메일 인증·토큰·config.json
- `server/src/messages.ts` — jsonl → 대화 메시지 (→ `chat.md`) · `flow.ts` — 플로우 (→ `flow.md`)
- `server/src/suggestion.ts`·`unqueue.ts`·`interrupt.ts` — 입력 제안·대기 취소·작업 중지 (→ `queue-interrupt.md`) · `mod/` — 웹 세션 전용 mod (→ 같은 파일)
- `server/src/usage.ts`·`accounts.ts`·`accountStore.ts`·`accountLogin.ts`·`switchImpact.ts` — 사용량·계정 (→ `accounts.md`)

웹 → `web-app.md` · `chat.md` · `office.md` · `office-art.md` · `accounts.md` · `flow.md`
- `web/src/main.tsx` — 로그인 또는 App · `App.tsx` — 3열 화면(목록·사무실·패널)·상태 표시줄·폰 한 열 · `types.ts` — 응답 타입·공통 문구 함수
- `web/src/theme.ts` — 테마 · `Modal.tsx` — 모달·세그먼트 · `sessionMenu.ts` — 세션 줄 ⋯ 메뉴 · `sessionPosition.ts`·`PositionChip.tsx` — 역할·이름
- `web/src/GroupTodosModal.tsx`·`groupTodos.ts` — 그룹 TODO · `ModelSettingModal.tsx`·`modelSetting.ts` — 모델·effort 변경 창
- `web/src/Chat.tsx`·`chatRows.ts`·`runningTools.ts` — 대화 탭 · `Markdown.tsx` — 마크다운 · `CopyButton.tsx`·`copyText.ts`·`codeText.ts` — 복사 버튼·클립보드·코드 글자 뽑기 · `Files.tsx` — 작업 파일 · `Shells.tsx` — shell 보기 · `Terminal.tsx` — xterm · `chatSearch.ts`·`ChatSearchBar.tsx`·`chatSearchPaint.ts` — 대화 탭 안 검색(찾기·막대·글자 칠하기) (→ `chat.md`)
- `web/src/Office.tsx` — PixiJS 사무실 · `officeLayout.ts` — 배치 · `officeFixtures.ts` — 고정 꾸미기 · `lounge.ts` — 라운지 자리 · `dotState.ts` — 인물 상태·라운지 판정 · `offDutyStreet.ts` — 퇴근 거리 배치 (→ `office.md`)
- `web/src/characterArt.ts`·`dotCharacter.ts`·`recolor.ts`·`CharacterPicker.tsx` — 인물 그림·고르기·색 · `tools/sprites/` — 스프라이트 파이프라인 · `web/public/office/` — 아틀라스 (→ `office-art.md`)
- `web/src/UsagePanel.tsx`·`Accounts.tsx`·`accountLabels.ts` — 사용량·계정 (→ `accounts.md`) · `FlowPanel.tsx` — 플로우 (→ `flow.md`)

## 어디서나 지킬 규칙

- **화면 글자는 영어, 대화 내용은 그대로.** 영어: 웹 화면의 버튼·라벨·카드·안내·확인 창(confirm·alert·prompt)·툴팁(title)·aria-label·placeholder, 화면에 뜨는 서버 오류 문구, 트레이 앱 메뉴·알림, 로그인 코드 메일. 그대로 둔다: claude 와의 대화 내용(말풍선, 자리 카드의 마지막 말처럼 claude·사람이 쓴 글 — 쓴 사람의 글이라 번역 대상이 아니다), 리드 지침(`server/src/lead.ts`)·MCP 도구 설명(`mcp/src`)·claude 에게 가는 훅 응답 문구(질문 취소·대화로 답하기 등 — 화면이 아니라 claude 가 읽는 입력이라 바꾸면 claude 의 판단이 바뀔 수 있고, 지침은 이미 떠 있는 리드에 반영되지도 않는다), 로그·코드 주석·문서·커밋 메시지, `<html lang>`(대화 내용이 한국어라). 용어: 팀장 Lead · 파트장 Part lead · 팀원 Member · 팀 Team · 파트 Part · 그룹 Group · 외부 세션 External session · 근무 On duty · 휴식 Break · 퇴근 Off duty · 종료 End · 중지 Stop · 다시 출근 Clock in · 기록 지우기 Delete record. 상태 이름은 `types.ts` 의 `statusLabel`, 지난 시각은 `formatAgo`("5m ago") 를 쓴다. 새 문구는 사용량 창·Shells 창 말투(짧게, 문장 첫 글자만 대문자)에 맞춘다
- **서버가 화면으로 보내는 `{ message }` 도 영어다** — `@jk-corp/host/hq` 의 오류 문구는 한국어라 `error.message` 를 그대로 보내지 않는다 (→ `server-api.md`).
- **색은 `web/src/style.css` 맨 위 `:root`(라이트)·`:root[data-theme='dark']`(다크) 변수로만 쓴다** — literal 로 박지 말고 변수를 만들어 두 값을 다 넣는다. 테마 규칙 전문 → `web-app.md`. 폰 전용 스타일은 `style.css` 끝 `@media (max-width: 768px)` 블록에만 둔다.
- **`hq.json` 은 호스트·서버 두 프로세스가 같이 읽고 쓴다.** `readHq` 는 모르는 키를 보존한다 (한쪽만 새 코드일 때 다른 쪽 데이터가 지워진 적이 있다). 쓰기는 같은 폴더 임시 파일에 다 쓴 뒤 `renameSync` 로 바꿔 끼우고, 파일이 있는데 읽기·해석에 실패하면 던져서 읽기·쓰기를 모두 막는다. 요청 처리 밖에서 hq 를 부르는 곳을 새로 만들면 예외를 잡아야 한다 (안 잡으면 서버가 죽고 트레이가 재시작을 반복하다 포기한다). 전문 → `host.md` 의 `host/src/hq.ts`.
- **계정 기능 시험 규칙.** 실제 `~/.claude/.credentials.json`·`~/.claude.json`·`~/.claude/jk-corp/` 를 쓰지 않고, 실제 로그인을 끝내지 않고, 기본 폴더에서 실제 `claude auth logout` 을 하지 않는다. 시험 서버(아래 "화면 확인 방법")의 preload 로 전역 `fetch` 의 `https://api.anthropic.com/` 를 가짜 API 로 돌리고 가짜 토큰 파일을 둔다. 시험 서버가 띄우는 claude 의 외부 접속은 `HTTPS_PROXY` 를 CONNECT 를 막는 가짜 프록시로 줘서 막는다 (Claude Code 의 OAuth 주소는 `CLAUDE_CODE_CUSTOM_OAUTH_URL` 허용 목록 밖으로 못 돌린다). claude(Bun)의 홈이 `USERPROFILE` 을 따르는지 확인하지 않았으니 시험 서버에서도 기본 폴더 claude 는 띄우지 않는다 (`--claude=` 로 다른 실행 파일을 주고 확인한다)
- **Claude Code 세션 안에서 호스트를 띄우지 않는다** (위 "실행·확인").
- 설정 `~/.claude/jk-corp/config.json` 의 SMTP 비밀번호는 커밋·출력하지 않는다 (위 "실행·확인").

## 핵심 개념 (공통)

- **세션 목록 순서는 생성순이고 활동으로 바뀌지 않는다.** 왼쪽 목록(Focus Zone·Off Duty·팀 카드·파트)과 사무실 책상·부스 자리 배정(`officeLayout.ts` 는 서버 순서를 filter 만 해서 그대로 쓴다)이 모두 같은 순서라, 작업을 해도 줄과 책상이 움직이지 않는다. 상태는 색 점·배지·아이콘으로 본다. 라운지(차례가 끝난 최근순)·퇴근 거리(최근 퇴근순)·Shells(시작 순)는 자기 순서가 따로 있다
- **세션 생존 판정**은 `~/.claude/sessions/*.json`의 pid 로 한다. jsonl 수정 시각은 쓰지 않는다 (비활성 세션도 파일은 남아 있어서 부정확)
- **근무·휴식·퇴근** (`Session.attendance`, 화면과의 약속): 근무(present) = pid 기록이나 호스트 목록에 있음. 휴식(break) = `hq.json.webSessions` 에 있는데 프로세스 없음 (호스트·트레이 재시작 중. 호스트가 다시 뜨면 `--resume` 으로 저절로 돌아온다). 퇴근(off) = 끝난 웹 세션 (`hq.json.offDuty`. 다시 출근할 수 있다). 목록에서 빠지는 것: 퇴근 기록 삭제(손·보관 기간: 팀장이 정리한 팀원(released) 6시간, 그 밖(exit·dismissed·error) 7일. released 는 팀장이 팀원을 계속 만들고 정리해서 쌓인다), 끝난 외부(터미널·IDE) 세션, 대화가 한 번도 없던 웹 세션
- **상태**는 훅 이벤트로만 바뀐다. `UserPromptSubmit`→working, `PermissionRequest`→needs-approval, `PostToolUse`→working(승인 해제), `Stop`→my-turn, `SessionEnd`→ended. 훅이 한 번도 안 온 세션은 `unknown`. **근무 중인데 ended 면 끝나기 직전(`statusBeforeEnd`)이 my-turn 이면 my-turn, 아니면 idle 로 보인다** (`displayStatus`): 호스트 재시작 때 claude 가 끝나며 SessionEnd 가 오고 `--resume` 으로 다시 떠도 SessionStart 훅이 오지 않아서다. working·needs-approval 은 프로세스와 함께 사라져 되살리지 않고, 휴식·퇴근은 그대로 ended, 서버 재시작 뒤에는 훅 상태가 없어 unknown. **`workingSince`(이번 차례 시작 시각)는 `UserPromptSubmit` 때 정하고** `PostToolUse`·`PermissionRequest` 는 같은 차례라 잇고, 그 밖의 이벤트는 null. `updatedAt` 은 도구를 쓸 때마다 바뀌어 시작 시각으로 못 쓴다. 이전 값이 없는데 `PostToolUse` 가 오면(서버 재시작 직후) 지어내지 않고 null — 화면은 시간 없이 "Working" 만 띄운다. **예외: 웹 중지는 훅이 오지 않아(실측) 서버가 jsonl 로 멈춘 것을 확인하고 my-turn 으로 돌린다** (아래 작업 중지). 작업 중에 보낸 메시지는 대기열에 들어갈 때 UserPromptSubmit 이 온다(실측) — 그래서 그때 `workingSince` 가 새로 정해진다
- **표시 상태(`Session.status`)는 훅 상태에 waiting·done 을 더한 것이다.** 훅 상태(`HookState.status`, `HookStatus`)는 그대로 두고 세션 목록이 내보낼 때만 근무 중 세션의 my-turn(근무 중 ended 의 `statusBeforeEnd` my-turn 포함)을 이 순서로 가른다 (`turnEnd.ts`): ① **waiting** — jsonl 에 안 끝난 백그라운드 작업(shell·백그라운드로 넘어간 MCP 호출·백그라운드 에이전트, `runningBackgroundTasks`)이 있다. 끝나면 claude 가 알림으로 깨어 이어서 일한다 ② **done** — 팀원(`role` member)의 가장 최근 task 가 done 이고 그 뒤 새 차례가 없다 (task 는 그 차례의 Stop 에서 끝나므로 `finishedAt` ≥ 마지막 UserPromptSubmit `lastPromptAt` 이면 같은 차례. `lastPromptAt` 을 못 봤으면 task 를 믿는다). 물음으로 끝나도 done — 팀원의 물음은 팀장이 jk_wait 결과로 받는다 ③ **my-turn** — 웹 중지로 멈췄거나(`isInterrupted`) 마지막 말(`lastAssistantText`)이 없거나 빈 글 ④ **my-turn** — 마지막 말의 끝 6줄(끝의 `*_\``·공백을 떼고 빈 줄이 된 것은 세지 않는다) 안에 `?`·`？` 가 있다 ⑤ 그 밖은 **done**. 휴식·퇴근·unknown·idle 은 가르지 않는다 (서버 재시작 직후 unknown 인 세션은 백그라운드 작업이 돌아도 waiting 이 아니다). 대기 메시지 취소·중지·모델 변경 409·`modelChangeConflict` 같은 서버 판정은 훅 상태를 본다. 바쁨(`isBusy`: 계정 전환 경고·전환 뒤 호스트 재시작 확인)은 waiting 도 넣는다. 물음표 규칙은 어림이다: "알려 주시면 진행하겠습니다" 처럼 물음표 없이 묻는 글은 done, 끝 6줄 코드·URL 의 `?` 는 my-turn 이 된다. task 는 서버 메모리라 서버를 재시작하면 그 전에 받은 지시는 ② 로 보지 않는다
- 훅은 `type: "http"`로 서버에 직접 POST 한다. 서버가 꺼져 있으면 그 사이 이벤트는 유실되고 Claude Code 쪽엔 영향 없다 (non-blocking). timeout 2초 (질문 훅만 3600초)
- 훅 상태는 서버 메모리에만 있다. 서버 재시작 시 전부 `unknown`에서 다시 시작. 상태 표시에만 쓰고 목록에 넣는 기준은 아니다 (그래서 목록은 서버를 재시작해도 그대로다)
- **웹 세션 = 호스트 pty 목록에 있는 세션.** `--session-id`로 UUID를 넘겨 pty·jsonl·훅이 같은 키로 묶인다
- **그룹 → 팀 → 세션.** 그룹은 그래픽 공간일 뿐이고, 팀은 같은 폴더의 세션 묶음(= 그룹 안의 책상 섬), 세션은 팀 안의 책상이다. 세션의 팀은 저장하지 않고 **cwd 로 매번 판정**한다 (`normalizeCwd`: 소문자·`/`·끝 슬래시 제거, 정확히 같은 폴더만). 팀은 사람이 그룹 라벨 "+"(title "Add team to group")로만 만든다

## 화면 확인 방법 (headless)

Vite 페이지는 SSE 때문에 `--virtual-time-budget` 방식이 멈춘다. `--remote-debugging-port` 로 Edge 를 띄우고 CDP 로 N초 뒤 캡처하는 스크립트를 쓴다 (`scratchpad/cdp-shot.mjs` 패턴: `Page.navigate` → sleep → `Page.captureScreenshot`, 콘솔 오류도 수집). 기존 Edge 와 프로필이 겹치지 않게 `--user-data-dir` 을 따로 준다. 폰 화면은 `Emulation.setDeviceMetricsOverride`(390×844, `mobile: true`) + `setTouchEmulationEnabled` + `setEmulatedMedia`(`hover: none`) 로 찍는다. **실제 세션의 터미널 탭을 열면 화면 폭으로 pty resize 가 POST 된다** — 보기만 할 때는 CDP `Fetch` 로 GET 이 아닌 `/api` 요청을 가로채 가짜 200 으로 끝낸다. dev 모드의 터미널 탭에서 나는 xterm `reading 'dimensions'` 예외는 StrictMode 이중 마운트 탓이고 빌드 결과에서는 안 난다

새 서버 API 는 실행 중인 서버를 재시작하지 않고 시험 서버로 확인한다: 임시 홈(`USERPROFILE`·`HOME`)과 가짜 호스트 pipe 로 다른 포트에 띄운다. **`index.ts` 의 PORT 는 고치지 않는다** (고친 사이 트레이가 서버를 재시작하면 그 포트로 뜬다) — preload(`--import`)로 `net.Server.prototype.listen` 의 4710 과 `net.connect` 의 `\\.\pipe\jk-corp-host` 를 바꾼다. 비교가 어긋나면 시험 서버가 실제 호스트에 붙으므로 가짜 pipe 에 연결된 것을 확인한 뒤 시작한다. 백슬래시가 든 스크립트는 Bash heredoc 으로 쓰지 않는다 (`\\` 가 `\` 로 줄어 pipe 이름이 깨진다). 화면에서 새 API 를 볼 때는 CDP `Fetch.continueRequest` 의 `url` 로 그 경로만 시험 서버로 돌린다

실제 claude 동작은 node-pty 로 claude 를 직접 띄워 잰다 (jk-corp 호스트를 거치지 않는다. `CLAUDECODE`·`CLAUDE_*` 를 지운 env, 신뢰된 이 저장소 폴더, `--model haiku`). **훅이 실제 4710 서버로 가지 않게** `--setting-sources project,local`(사용자 settings.json 의 훅을 뺀다)에 `--settings <파일>` 로 http 훅을 기록 서버로 보내고 `--strict-mcp-config` 를 준다 (실제 서버 `/api/sessions` 에서 그 세션이 `unknown` 으로 남는 것으로 확인). `--permission-mode default` 를 준다 — 기본값이 auto mode 면 차례가 끝날 때 "Auto mode works better…" 창이 떠 다음 입력을 먹는다(그 창에서 Enter 가 들어가 `~/.claude.json` 의 `autoModeEnvSetup` 이 지워진 적이 있다). 오래 걸리는 명령은 `node -e "setTimeout(…, 45000)"` (Bash 도구가 `sleep 45` 단독 명령을 막는다). SessionStart http 훅은 오지 않아 입력칸(`❯`)이 그려지기를 기다린다. 화면은 `@xterm/headless` 로 그려 본다. 이 claude 도 `~/.claude/sessions` pid 기록을 남겨 실제 서버 목록에 외부 세션으로 잠깐 보인다
