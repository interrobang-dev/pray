# Pray (jk-corp)

앱 이름은 **Pray** (문구 "Do your best. Then pray."). 내부 이름도 pray 다 (패키지 `@pray/*`·루트 `pray`, 호스트 pipe `\\.\pipe\pray-host`, 환경변수 `PRAY_*`, MCP 서버 `pray`·도구 `team_*`, mod 플러그인 `pray`, localStorage `pray.*`, 알림 ID `pray`, 스케줄러 작업 `pray-*`). jk-corp 로 남은 것: 저장소·worktree 폴더 이름 (GitHub 저장소는 `interrobang-dev/pray`), 인증 쿠키 `jk_session`, 스프라이트 메타 키 `jkCorp`, 옛 이름을 읽는 호환 코드 (로고·글자 로고 → `web-app.md`). 설정 폴더는 `~/.claude/pray/` (옛 `~/.claude/jk-corp/` 만 있으면 트레이·호스트·서버가 시작할 때 한 번 옮긴다 → `host.md` 의 `dataDir.ts`). Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰만 한다. 설계 전문: `docs/plans/2026-10-20-session-office-design.md`.

하지 않는 것: 외부 세션 조작(관찰만) · 설치 파일(electron-builder) — 저장소에서 실행한다 · HTTPS(사내망 전제) · Claude 토큰 직접 갱신(Claude Code 가 한다).

## 문서 지도 — 영역별 상세는 `.claude/rules/`

이 파일에는 어디서나 지킬 것, 실행·확인 방법, 모듈 한 줄 역할만 있다. 모듈 설명 전문·영역별 핵심 개념·영역별 "확인하지 못한 것" 은 `.claude/rules/<주제>.md` 에 있다.

- rules 파일마다 frontmatter `paths:` 가 걸려 있어 **그 경로의 파일을 Read·Write·Edit 하면 저절로 읽힌다. 그 경로 파일을 열기 전에는 읽히지 않는다.**
- 그래서 **어떤 영역을 고치거나 계획(설계·영향 검토·질문에 답하기)하기 전에 아래 표의 rules 파일을 Read 로 먼저 읽는다.** 계획 단계에서는 코드를 아직 안 열어 저절로 읽히지 않는다. 여러 영역에 걸친 일이면 해당 파일을 모두 읽는다.
- 한 내용은 주 영역 한 곳에만 있고 다른 곳은 "→ xxx.md" 로 가리킨다. rules 본문의 "위·아래 핵심 개념 …" 은 한 파일이던 때의 말이라, 가리키는 항목이 다른 파일에 있으면 그 파일 머리의 "다른 파일에 있는 항목" 에 적혀 있다.

| 파일 | 다루는 것 |
|---|---|
| `host.md` | 호스트(pipe·pty·resume·퇴근 기록)·`hq.json`(`hq.ts` 전문)·트레이 앱·스케줄러 스크립트·훅 설치·팀 할 일 저장 규칙 |
| `team.md` | 팀·파트 판정, 팀장·파트장 지침·MCP 도구, task 상태, 팀원 이름·모델·effort, worktree 파트 |
| `security.md` | 인증(`auth.ts`)·DNS rebinding 을 막는 Host 검사·CSRF 를 막는 Origin 검사(`requestGuard.ts`)·훅 경로와 팀 폴더 열기(`openFolder.ts`)·대화 .html 을 Chrome 으로 열기(`openInChrome.ts`)·폴더 고르기·git init(`folderPicker.ts`) 이 PC 전용·`index.ts` 미들웨어 순서 |
| `server-api.md` | 서버 API 경로 전부(`index.ts` 전문), 세션 목록·jsonl 요약·훅 상태·표시 상태 계산, shell·작업 파일·첨부·세션 cwd 파일 읽기(`workspaceFiles.ts`)·저장(`workspaceSave.ts`), AskUserQuestion, 세션 이름·역할·인물, 폴더 신뢰, 모델·effort 바꾸기 |
| `queue-interrupt.md` | mod(입력 제안·입력칸 알림·곁가지 질문), 보내기의 함정, 대기열·대기 메시지 취소, 작업 중지, 곁가지 질문 흐름(`btw.ts`) |
| `accounts.md` | 사용량 조회·사용량 창, Claude 계정 보관·전환·로그인·로그아웃 (서버·화면) |
| `flow.md` | 플로우(flow.team) 알림 서버·화면 |
| `chat.md` | 대화 메시지(`messages.ts`)와 대화 탭 전체, 마크다운, 작업 파일, Shells, 터미널 탭 |
| `workspace.md` | 세션 패널 Files 탭(세션 cwd 트리·코드 보기·빠른 찾기·줄 고르기·Add to chat·git/SVN 변경 목록과 diff·git 커밋 히스토리·이 PC 에서만 되는 편집). 그 서버 API 는 `server-api.md`, 단 변경 보기(`workspaceChanges.ts`)·커밋 히스토리(`workspaceHistory.ts`)·내용 찾기 API 는 이 파일 |
| `web-app.md` | App.tsx(목록·패널·상태 표시줄·폰·사무실 숨기기), 응답 타입·공통 문구, 테마·스크롤바·로고, 모달·메뉴, 팀 만들기 창·폴더 고르기, 팀 할 일 화면, 역할 칩, 모델 변경 창 |
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

**평소에는 트레이 앱으로 쓴다.** 바탕화면 `Pray.lnk` (= `node_modules\electron\dist\electron.exe desktop`, 작업 폴더 저장소). `npm install` 의 postinstall 이 그 electron.exe 의 아이콘·이름을 Pray 로 바꾼다 (바로가기·작업 표시줄 아이콘은 exe 를 따르고 Windows 아이콘 캐시 때문에 늦게 바뀔 수 있다. 트레이가 떠 있으면 경고만 내고 넘어가니 Quit 뒤 `npm run brand:electron`. 알림 머리 이름은 시작 메뉴의 옛 `Electron.lnk` 를 지워야 Pray → `host.md`). 바로가기는 빌드하지 않고 `desktop/dist/` 를 그대로 실행하므로 `desktop/src` 를 고치면 `npm run build --workspace desktop` 뒤 트레이 Quit → 다시 켜야 한다 (`npm run desktop` 은 빌드한 뒤 띄우고, 루트 `npm run build` 는 web 만 빌드한다). 트레이 아이콘: 클릭 = 창 열기, 우클릭 = 상태·서버/호스트 재시작·로그 폴더·로그인 시 자동 실행·알림 켜기/끄기·종료 (메뉴·툴팁·확인 창·알림 글자는 영어: Restart server·Restart host·Open log folder·Launch at login·Notifications·Quit). 세션이 끝나거나(Done·My turn, 팀원 제외) 승인을 기다리거나 팀장·파트장 문맥이 15만을 넘으면(Hand over) Windows 알림, 누르면 그 세션 패널 (→ `host.md`). 창 X 는 숨기기이고 **트레이 "Quit"만이 진짜 종료**(호스트가 꺼져 웹 세션이 끊기고 다음 실행 때 `--resume`). 승인 대기 세션이 있으면 아이콘에 빨간 점. 자식이 죽으면 3초 뒤 재시작, 1분에 5번 넘으면 포기하고 알림. 설치 파일(electron-builder)은 만들지 않았다 — 저장소에서 실행한다.

브라우저로도 `http://127.0.0.1:4710` 접속 가능. 로그: `~/.claude/pray/logs/*.log`. 화면 아래 상태 표시줄의 연결 상태 옆 `↻` 로 재시작한다. 호스트 ↻ = `POST /api/host/restart` → 호스트가 종료 코드 2 로 나감 → 트레이가 새 코드로 다시 띄움. 웹 세션은 끊겼다가 `--resume` 된다. 서버 ↻ = `POST /api/server/restart` → 서버가 응답을 보낸 뒤 종료 코드 2 로 나감 → 트레이가 새 코드로 다시 띄움. 몇 초 끊기고 세션은 그대로지만, 서버 메모리에만 있는 훅 상태(다음 훅부터 다시 보인다)·붙잡은 질문(터미널 탭에서 답한다)·입력칸 제안은 사라진다. **작업 스케줄러 방식에서는 둘 다 종료만 되고 다시 뜨지 않는다** (서버는 `npm run dev` 에서도).

설정: `~/.claude/pray/config.json` (저장소 밖. SMTP 비밀번호가 들어 있으니 절대 커밋·출력하지 않는다)

```json
{ "bind": "0.0.0.0", "loginEmails": ["..."], "smtp": { "host", "port", "user", "pass" } }
```

파일이 없으면 127.0.0.1 전용·메일 로그인 없음으로 뜬다. 다른 PC 에서는 `http://<이 PC IP 또는 PC 이름>:4710` (도메인 이름은 Host 검사로 403 → `security.md`) → 메일 주소 입력 → 6자리 코드(10분, 5회) → 30일 쿠키. 토큰은 `~/.claude/pray/auth-tokens.json`. HTTPS 가 아니라 쿠키에 Secure 가 없다 (사내망 전제). Windows 방화벽이 node.exe 인바운드를 막으면 다른 PC 에서 안 열린다 — 첫 접속 시 허용 필요.

**트레이 앱 없이 쓰는 대안: 작업 스케줄러.** `npm run startup:install` 이 `pray-host`/`pray-server` 작업을 등록한다(옛 이름 `jk-corp-*` 작업이 있으면 지우고, `stop.ps1`·`uninstall-startup.ps1` 도 옛 이름까지 멈추고 지운다. `wscript launch-hidden.vbs` 래퍼로 창 없이. S4U 는 관리자 권한 필요. PowerShell `-WindowStyle Hidden` 은 대화형 작업에서 콘솔 창이 보여 사용자가 닫는 사고가 두 번 났다). 멈출 때는 반드시 `scripts/stop.ps1` (`Stop-ScheduledTask` 는 래퍼만 죽이고 node 가 고아로 남는다). **트레이 앱과 스케줄러를 같이 쓰면 pipe·포트가 충돌한다** — 지금은 스케줄러 작업을 제거한 상태.

개발 중 화면 작업: 트레이 앱(또는 스케줄러)의 호스트·서버는 그대로 두고 `npm run dev:web` 만 띄워 `http://localhost:4711` 로 본다 (Vite 가 IPv6 localhost 로 열려 `127.0.0.1` 로는 안 열림. `/api` 는 4710 으로 프록시). 서버·호스트 코드를 고쳤으면 트레이 메뉴의 재시작을 쓴다. `npm run dev` (셋 다 tsx 로 실행)는 트레이 앱을 종료한 상태에서만 쓴다. 훅은 Claude Code가 settings.json을 핫리로드하므로 세션 재시작 없이 반영된다.

테스트: `npm test` (host·server·mcp·web·desktop 의 vitest. web·desktop 은 순수 함수만).

**Claude Code 세션 안에서 호스트를 띄우지 말 것.** 띄우더라도 `ptyPool.ts`가 `CLAUDECODE`·`CLAUDE_*` 환경변수를 지우고 자식을 실행한다. 안 지우면 자식 claude가 중첩 실행으로 판단해 종료 코드 1로 죽는다.

## 구조 (모듈 한 줄 — 상세는 → 표의 rules 파일)

호스트·트레이 → `host.md`
- `host/src/index.ts` — named pipe `\\.\pipe\pray-host` 서버. spawn·resume·forget·kill·restart·restart-session 처리, 퇴근 기록 보관 기간 정리, 옛 pipe `jk-corp-host` 가 살아 있으면 뜨지 않음 (`legacyHost.ts`)
- `host/src/ptyPool.ts` — node-pty 로 `claude.exe` 실행·세션별 링버퍼, extraArgs 저장, 끝나면 퇴근 기록, 모델 바꾸기 재시작, 웹 세션에 mod 불러오기
- `host/src/hq.ts` — `~/.claude/pray/hq.json` 읽기·쓰기 (웹 세션·퇴근 기록·그룹·팀·이름·인물·성별·역할·팀 할 일·목록 순서)
- `host/src/runtime.ts` — `--name=value` 인자 파싱, `--log=` 파일 로그 · `host/src/dataDir.ts` — 설정 폴더 `~/.claude/pray/` 정하기·옛 폴더 한 번 옮기기 (서버가 `@pray/host/dataDir` 로 import, 트레이는 `desktop/src/dataDir.ts` 에 같은 규칙) · `host/src/protocol.ts` — pipe 메시지 타입·줄 단위 JSON
- `desktop/src/main.ts`·`children.ts`·`icon.ts`·`notify.ts`·`toast.ts`·`noticeFace.ts`·`externalLink.ts` — Electron 트레이 앱, 자식 재시작 정책, 코드로 만든 트레이·창·알림 그림, 세션 알림 판정·글자, 알림 토스트 XML, 알림 그림의 세션 도트 인물 머리(`dotCharacter.ts`·`recolor.ts` 는 화면 인물·색 규칙 사본), 창의 웹 링크를 기본 브라우저로 넘길지 판정
- `scripts/*.ps1` — 작업 스케줄러 등록·중지·제거 · `scripts/brand-electron.mts` — postinstall 로 electron.exe 아이콘·이름을 Pray 로 · `hooks/install.mjs` — settings.json 훅 설치

팀 → `team.md`
- `host/src/team.ts` — Team·Part 타입, cwd → 팀·파트·역할 판정
- `server/src/lead.ts` — 팀장·파트장 지침·spawn 인자·`--mcp-config` · `server/src/leadReplace.ts` — Hand over 때 옛 지시자를 끝내고 끝나기 기다리기 · `server/src/leadHandoff.ts` — 새 팀장·파트장에게 첫 메시지로 줄 직전 지시자 히스토리(압축 요약 + 그 뒤 지시·답) · `server/src/handoffState.ts` — 새 지시자가 인계 글에 답하기 전 "인계 중" 상태(입력 409·화면 잠금) · `server/src/teamState.ts` — task 상태 기계(재시작 때 되살린 running 정리) · `server/src/teamTaskFile.ts` — task·팀원 운영 기록(spawn·dismiss)을 `~/.claude/pray/team-tasks.json` 에 저장·보관 기간 정리 · `server/src/teamTaskHistory.ts` — 화면 Tasks 창용 팀 task·운영 기록 목록과 task 전문 · `server/src/taskUsage.ts` — 끝난 task 의 jsonl 응답 usage 합·모델 · `server/src/taskWait.ts` — team_wait 롱폴링(대기 시간·헤더 먼저 보내고 공백 흘리기)
- `server/src/memberModel.ts` — 팀원 모델·effort 값, extraArgs 의 `--model`·`--effort` 읽고 바꾸기 · `server/src/teamMembers.ts` — team_status 팀원 꼴(근무 중만 전체 꼴, 휴식·퇴근은 짧은 꼴. 문맥 크기 `contextTokens`·쉰 시각 `idleSince`) · `server/src/memberName.ts` — 팀원 이름 뽑기·역할 검증
- `server/src/worktree.ts` — 파트 worktree 만들기·지우기, `~/.claude.json` 폴더 신뢰 기록
- `mcp/src/index.ts`·`teamServer.ts`·`teamApi.ts` — 팀장·파트장 claude 에 붙는 stdio MCP 서버 (`team_spawn_member`·`team_assign`·`team_wait`·`team_status`·`team_dismiss`. 이름을 바꾸기 전 리드는 env 로 옛 모드 `jk_*`)

서버 → `server-api.md` (계정·플로우·대화·대기열은 각 파일)
- `server/src/index.ts` — Express: 모든 API·SSE·훅 수신
- `server/src/sessions.ts` — 세션 목록(근무·휴식·퇴근 합치기, 생성순) · `transcript.ts` — jsonl 요약 · `transcriptWatcher.ts` — jsonl 감시 → SSE
- `server/src/vcs.ts` — 팀 폴더의 형상관리(git·SVN) 판정·5분 캐시 → office 응답의 `vcs`
- `server/src/hookState.ts` — 훅 → 훅 상태 · `turnEnd.ts` — waiting·done·my-turn 판정 · `liveSessions.ts` — pid 생존 확인
- `server/src/shells.ts` — 백그라운드 shell·작업 판정, 출력 끝 N줄 · `scratchpad.ts` — 세션 작업 폴더·첨부 저장
- `server/src/workspaceFiles.ts` — 세션 cwd 읽기(Files 탭 API): 경로 검증·한 단계 목록·파일 글/바이너리 판정·이름 빠른 찾기 · `workspaceChanges.ts` — 세션 cwd 의 git/SVN 변경 목록·diff(읽기만) · `workspaceHistory.ts` — 세션 cwd 의 git 커밋 목록·커밋 상세·커밋 파일 diff(읽기만) · `workspaceSave.ts` — 세션 cwd 글 파일 저장(이 PC 에서만, CSRF·충돌·줄바꿈/BOM) · `workspaceSearch.ts`·`workspaceSearchWorker.ts` — 세션 cwd 전체 내용 찾기(worker 스레드에서, 시간을 넘기면 terminate) (→ `workspace.md`)
- `server/src/chatImage.ts` — 대화 속 그림 API 의 경로 꼴·허용 범위(세션 cwd·Claude 임시 폴더) 판정, .html 링크 열기도 같은 판정 (→ `server-api.md`·`security.md`)
- `server/src/askQuestion.ts` — AskUserQuestion 해석·답 · `serialRunner.ts` — 한 번에 하나 실행기 · `hostClient.ts` — pipe 클라이언트
- `server/src/auth.ts`·`mail.ts`·`config.ts` — 메일 인증·토큰·config.json · `requestGuard.ts` — Host·Origin 머리 판정 · `openFolder.ts` — 팀 폴더를 이 PC 탐색기로 열기 · `openInChrome.ts` — 대화 속 .html 링크를 이 PC 의 Chrome 으로 열기 · `folderPicker.ts` — 팀 만들기 창의 폴더 고르기·새 폴더·git init, 이 PC 전용 (→ `security.md`)
- `server/src/messages.ts` — jsonl → 대화 메시지 (→ `chat.md`) · `flow.ts` — 플로우 (→ `flow.md`)
- `server/src/messageCache.ts` — 대화 API 의 해석 캐시·버전·바뀐 뒤쪽만 보내기
- `server/src/suggestion.ts`·`unqueue.ts`·`interrupt.ts`·`btw.ts` — 입력 제안·대기 취소·작업 중지·곁가지 질문(`/btw`) (→ `queue-interrupt.md`) · `mod/` — 웹 세션 전용 mod (→ 같은 파일)
- `server/src/usage.ts`·`accounts.ts`·`accountStore.ts`·`accountLogin.ts`·`switchImpact.ts` — 사용량·계정 (→ `accounts.md`)

웹 → `web-app.md` · `chat.md` · `workspace.md` · `office.md` · `office-art.md` · `accounts.md` · `flow.md`
- `web/src/main.tsx` — 로그인 또는 App (`legacyStorage.ts`·`copyLegacyStorage.ts` — 옛 localStorage 키 한 번 옮기기) · `App.tsx` — 3열 화면(목록·사무실·패널)·상태 표시줄·폰 한 열 · `sessionLink.ts` — 트레이 알림이 여는 `#session=<id>` 읽기 · `listCollapse.ts` — 목록 그룹 접기 저장 값·접힌 라벨 상태 요약 · `panelWidth.ts` — 사무실이 보일 때 끌어 바꾸는 패널 폭 · `types.ts` — 응답 타입·공통 문구 함수 · `contextSize.ts` — 입력 상자 아래 문맥 크기 글자("143k")·주의/경고 단계 · `handOver.ts` — 문맥 경고 단계 팀장·파트장의 패널 머리 Hand over(새 지시자 창 열기) 판정
- `web/src/theme.ts` — 테마·스타일 적용 · `appearance.ts`·`palettes.ts`·`AppearanceModal.tsx`·`ChatStyleTab.tsx` — 스타일 설정(팔레트·강조색·글자 크기·대화 모양) 계산·값·창 · `Modal.tsx` — 모달·세그먼트 · `Dialog.tsx`·`dialogQueue.ts` — 브라우저 confirm·alert·prompt 대신 쓰는 앱 안 확인·알림·입력 창 · `sessionMenu.ts` — 세션 줄 ⋯ 메뉴 · `sessionPosition.ts`·`PositionChip.tsx` — 역할·이름
- `web/src/NewTeamModal.tsx`·`FolderPicker.tsx`·`folderChoice.ts` — 팀 만들기 창(이 PC 면 폴더 고르기·git init 칸) · `web/src/TeamTodosModal.tsx`·`teamTodos.ts` — 팀 TODO · `web/src/TeamTasksModal.tsx`·`teamTasks.ts` — 팀 Tasks 창(팀원 task·들고 남 기록) · `ModelSettingModal.tsx`·`modelSetting.ts` — 모델·effort 변경 창
- `web/src/Chat.tsx`·`chatRows.ts`·`runningTools.ts`·`teamTools.ts` — 대화 탭(팀 MCP 도구 이름 옛·새 둘 다 알아보기) · `chatWindow.ts`·`chatReuse.ts`·`chatDelta.ts` — 최근 줄만 그리기·다시 받은 대화 재사용·바뀐 뒤쪽만 받기 · `Composer.tsx`·`composerText.ts` — 대화 입력 상자(글·첨부 state) · `BtwCard.tsx` — 곁가지 질문 카드 · `Markdown.tsx` — 마크다운 · `ChatImage.tsx`·`chatImageUrl.ts` — 대화 속 그림(이 PC 파일 경로 → 서버 그림 API, 크게 보기) · `ChatLink.tsx`·`chatLinkUrl.ts` — 대화 속 로컬 .html 링크(이 PC 의 Chrome 으로 열기, 다른 PC 는 흐림) · `markdownHighlight.ts` — 대화 마크다운 숫자·경로 강조 · `CopyButton.tsx`·`copyText.ts`·`codeText.ts` — 복사 버튼·클립보드·코드 글자 뽑기 · `Files.tsx` — 작업 파일 · `Shells.tsx` — shell 보기 · `Terminal.tsx` — xterm · `chatSearch.ts`·`ChatSearchBar.tsx`·`chatSearchPaint.ts` — 대화 탭 안 검색(찾기·막대·글자 칠하기) (→ `chat.md`)
- `web/src/FilesTab.tsx`·`CodeView.tsx`·`DiffView.tsx`·`codeLines.ts`·`codeSelection.ts`·`changes.ts`·`lineSelection.ts`·`workspaceTree.ts`·`composerDraft.ts`·`CodeEditor.tsx`·`codeMirrorEditor.ts`·`unsavedEdits.ts`·`CodeFindBar.tsx`·`codeFind.ts`·`codeViewDom.ts`·`SearchPanel.tsx`·`workspaceSearch.ts`·`workspaceApi.ts`·`HistoryPanel.tsx`·`commitHistory.ts`·`AddToChatIcon.tsx`·`FileName.tsx` — 세션 패널 Files 탭(트리·줄 번호 코드 보기·Changes 변경 목록·diff·History 커밋 히스토리·줄 고르기·Add to chat·빠른 찾기·CodeMirror 편집(동적 import), 코드 보기 안 찾기 Ctrl+F·작업 폴더 내용 찾기 Search Ctrl+Shift+F, 탭을 오가도 남는 입력칸 글·커서) (→ `workspace.md`)
- `web/src/Office.tsx` — PixiJS 사무실 · `officeLayout.ts` — 배치 · `officeFixtures.ts` — 고정 꾸미기 · `lounge.ts` — 라운지 자리 · `dotState.ts` — 인물 상태·라운지 판정 · `offDutyStreet.ts` — 퇴근 거리 배치 (→ `office.md`)
- `web/src/characterArt.ts`·`recolor.ts`·`headRect.ts`·`CharacterPicker.tsx` — 인물 그림·고르기·색·목록 아바타 머리 자리 · `host/src/dotCharacter.ts` — 인물 후보·해시·새 세션 자동 배정 규칙(화면·서버 공용, `@pray/host/dotCharacter`) · `tools/sprites/` — 스프라이트 파이프라인 · `web/public/office/` — 아틀라스 (→ `office-art.md`)
- `web/src/UsagePanel.tsx`·`Accounts.tsx`·`accountLabels.ts` — 사용량·계정 (→ `accounts.md`) · `FlowPanel.tsx` — 플로우 (→ `flow.md`)

## 어디서나 지킬 규칙

- **화면 글자는 영어, 대화 내용은 그대로.** 영어: 웹 화면의 버튼·라벨·카드·안내·확인·알림·입력 창(`Dialog.tsx`. 브라우저 confirm·alert·prompt 는 쓰지 않는다)·툴팁(title)·aria-label·placeholder, 화면에 뜨는 서버 오류 문구, 트레이 앱 메뉴·알림, 로그인 코드 메일. 그대로 둔다: claude 와의 대화 내용(말풍선, 자리 카드의 마지막 말처럼 claude·사람이 쓴 글 — 쓴 사람의 글이라 번역 대상이 아니다), 리드 지침(`server/src/lead.ts`)·MCP 도구 설명(`mcp/src`)·claude 에게 가는 훅 응답 문구(질문 취소·대화로 답하기 등 — 화면이 아니라 claude 가 읽는 입력이라 바꾸면 claude 의 판단이 바뀔 수 있고, 지침은 이미 떠 있는 리드에 반영되지도 않는다), 로그·코드 주석·문서·커밋 메시지, `<html lang>`(대화 내용이 한국어라). 용어: 팀장 Lead · 파트장 Part lead · 팀원 Member · 팀 Team · 파트 Part · 그룹 Group · 외부 세션 External session · 근무 On duty · 휴식 Break · 퇴근 Off duty · 종료 End · 중지 Stop · 다시 출근 Clock in · 기록 지우기 Delete record. 상태 이름은 `types.ts` 의 `statusLabel`, 지난 시각은 `formatAgo`("5m ago") 를 쓴다. 새 문구는 사용량 창·Shells 창 말투(짧게, 문장 첫 글자만 대문자)에 맞춘다
- **서버가 화면으로 보내는 `{ message }` 도 영어다** — `@pray/host/hq` 의 오류 문구는 한국어라 `error.message` 를 그대로 보내지 않는다 (→ `server-api.md`).
- **색은 `web/src/style.css` 맨 위 `:root`(라이트)·`:root[data-theme='dark']`(다크) 변수로만 쓴다** — literal 로 박지 말고 변수를 만들어 두 값을 다 넣고 `web/src/palettes.ts` 의 `DEFAULT_VARS` 에도 넣는다 (테스트가 같은지 본다). 테마·팔레트 규칙 전문 → `web-app.md`. 폰 전용 스타일은 `style.css` 끝 `@media (max-width: 768px)` 블록에만 둔다.
- **`hq.json` 은 호스트·서버 두 프로세스가 같이 읽고 쓴다.** `readHq` 는 모르는 키를 보존한다 (한쪽만 새 코드일 때 다른 쪽 데이터가 지워진 적이 있다). 쓰기는 같은 폴더 임시 파일에 다 쓴 뒤 `renameSync` 로 바꿔 끼우고, 파일이 있는데 읽기·해석에 실패하면 던져서 읽기·쓰기를 모두 막는다. 요청 처리 밖에서 hq 를 부르는 곳을 새로 만들면 예외를 잡아야 한다 (안 잡으면 서버가 죽고 트레이가 재시작을 반복하다 포기한다). 전문 → `host.md` 의 `host/src/hq.ts`.
- **계정 기능 시험 규칙.** 실제 `~/.claude/.credentials.json`·`~/.claude.json`·`~/.claude/pray/` 를 쓰지 않고, 실제 로그인을 끝내지 않고, 기본 폴더에서 실제 `claude auth logout` 을 하지 않는다. 시험 서버(아래 "화면 확인 방법")의 preload 로 전역 `fetch` 의 `https://api.anthropic.com/` 를 가짜 API 로 돌리고 가짜 토큰 파일을 둔다. 시험 서버가 띄우는 claude 의 외부 접속은 `HTTPS_PROXY` 를 CONNECT 를 막는 가짜 프록시로 줘서 막는다 (Claude Code 의 OAuth 주소는 `CLAUDE_CODE_CUSTOM_OAUTH_URL` 허용 목록 밖으로 못 돌린다). claude(Bun)의 홈이 `USERPROFILE` 을 따르는지 확인하지 않았으니 시험 서버에서도 기본 폴더 claude 는 띄우지 않는다 (`--claude=` 로 다른 실행 파일을 주고 확인한다)
- **Claude Code 세션 안에서 호스트를 띄우지 않는다** (위 "실행·확인").
- 설정 `~/.claude/pray/config.json` 의 SMTP 비밀번호는 커밋·출력하지 않는다 (위 "실행·확인").

## 핵심 개념 (공통)

- **세션 목록 순서는 생성순이고 활동으로 바뀌지 않는다.** 왼쪽 목록(Focus Zone·Off Duty·팀 카드·파트)과 사무실 책상·부스 자리 배정(`officeLayout.ts` 는 서버 순서를 filter 만 해서 그대로 쓴다)이 모두 같은 순서라, 작업을 해도 줄과 책상이 움직이지 않는다. 상태는 색 점·배지·아이콘으로 본다. 라운지(차례가 끝난 최근순)·퇴근 거리(최근 퇴근순)·Shells(시작 순)는 자기 순서가 따로 있다
- **세션 생존 판정**은 `~/.claude/sessions/*.json`의 pid 로 한다. jsonl 수정 시각은 쓰지 않는다 (비활성 세션도 파일은 남아 있어서 부정확)
- **근무·휴식·퇴근** (`Session.attendance`, 화면과의 약속): 근무(present) = pid 기록이나 호스트 목록에 있음. 휴식(break) = `hq.json.webSessions` 에 있는데 프로세스 없음 (호스트·트레이 재시작 중. 호스트가 다시 뜨면 `--resume` 으로 저절로 돌아온다). 퇴근(off) = 끝난 웹 세션 (`hq.json.offDuty`. 다시 출근할 수 있다). 목록에서 빠지는 것: 퇴근 기록 삭제(손·보관 기간: 팀장이 정리한 팀원(released) 6시간, 그 밖(exit·dismissed·error) 7일. released 는 팀장이 팀원을 계속 만들고 정리해서 쌓인다), 끝난 외부(터미널·IDE) 세션, 대화가 한 번도 없던 웹 세션
- **상태**는 훅 이벤트로만 바뀐다. `UserPromptSubmit`→working, `PermissionRequest`→needs-approval, `PostToolUse`→working(승인 해제), `Stop`→my-turn, `SessionEnd`→ended. 훅이 한 번도 안 온 세션은 `unknown`. **근무 중인데 ended 면 끝나기 직전(`statusBeforeEnd`)이 my-turn 이면 my-turn, 아니면 idle 로 보인다** (`displayStatus`): 호스트 재시작 때 claude 가 끝나며 SessionEnd 가 오고 `--resume` 으로 다시 떠도 SessionStart 훅이 오지 않아서다. 휴식·퇴근은 그대로 ended, 서버 재시작 뒤에는 훅 상태가 없어 unknown. **다만 이 unknown·idle 은 표시 상태에서 jsonl 의 마지막 차례(`TranscriptSummary.turn`)로 다시 만든다** (아래 "표시 상태"). **`workingSince`(이번 차례 시작 시각)는 `UserPromptSubmit` 때 정하고** `PostToolUse`·`PermissionRequest` 는 같은 차례라 잇고, 그 밖의 이벤트는 null. `updatedAt` 은 도구를 쓸 때마다 바뀌어 시작 시각으로 못 쓴다. 이전 값이 없는데 `PostToolUse` 가 오면(서버 재시작 직후) 지어내지 않고 null — 화면은 시간 없이 "Working" 만 띄운다. **예외: 웹 중지는 훅이 오지 않아(실측) 서버가 jsonl 로 멈춘 것을 확인하고 my-turn 으로 돌린다** (아래 작업 중지). 작업 중에 보낸 메시지는 대기열에 들어갈 때 UserPromptSubmit 이 온다(실측) — 그래서 그때 `workingSince` 가 새로 정해진다
- **표시 상태(`Session.status`)는 훅 상태에 waiting·done 을 더하고, 훅으로 차례를 알 수 없으면 jsonl 로 다시 만든 것이다** (`sessionStatus`). 훅 상태(`HookState.status`, `HookStatus`)는 그대로 두고 세션 목록이 내보낼 때만 계산한다.
  - **jsonl 의 마지막 차례 `turn`** (`transcript.ts`, 요약 캐시에 같이 든다): 주 대화 줄(사이드체인·메타·압축 요약·`<` 로 시작하는 글·synthetic 응답 제외)의 마지막 줄로 정한다. `ended` = 도구 호출 없고 `stop_reason` 이 `tool_use`·null 이 아닌 claude 응답(그 차례의 마지막 글 `text`, 글이 없었으면 null), `interrupted` = 중지 줄, 그 밖의 사람 입력(`queued_command` 포함)·도구 결과·도구 호출·스트리밍 조각은 차례 중간이라 그 뒤에 프로세스 경계 `cost-state` 가 있으면 `cut`, 없으면 `in-progress`, 대화 없음 `none`. 경계 판단은 shells.ts·대기열과 같다 (`cost-state` 는 프로세스가 세션을 떠날 때만 남는다)
  - **jsonl 을 쓰는 때**: 근무 중이고 ① 훅 상태가 없거나 unknown ② ended 인데 `statusBeforeEnd` 가 my-turn 이 아님(unknown·null·idle·working·needs-approval). 그 밖(훅 상태가 있는 평소 경우, `statusBeforeEnd` my-turn, 휴식·퇴근)은 jsonl 을 안 본다. 결과: `ended` → 그 차례의 마지막 글로 아래 turnEnd 규칙 / `interrupted`·`cut` → my-turn / `in-progress` → ①은 working(프로세스가 살아 있으니 일하는 중으로 본다. `workingSince` 는 null, 다음 훅이 고친다), ②는 my-turn(프로세스가 죽었다 다시 떠 차례가 끊겼고, 사람이 이어서 지시해야 한다) / `none` → ①은 unknown, ②는 idle
  - **turnEnd 규칙**: my-turn 인 근무 중 세션(훅 my-turn, 근무 중 ended 의 `statusBeforeEnd` my-turn 포함)과 위 `ended` 결과를 이 순서로 가른다 (`turnEnd.ts`): ① **waiting** — jsonl 에 안 끝난 백그라운드 MCP 호출·백그라운드 에이전트가 있다 (`hasWakingTask`). 끝나면 claude 가 알림으로 깨어 이어서 일한다. 백그라운드 shell 은 넣지 않는다 — dev 서버처럼 끝나지 않는 shell 이 많아 세션이 내내 waiting 으로 보였다 (shell 은 Shells 표시로 본다) ② **done** — 팀원(`role` member)의 가장 최근 task 가 done 이고 그 뒤 새 차례가 없다 (task 는 그 차례의 Stop 에서 끝나므로 `finishedAt` ≥ 마지막 UserPromptSubmit `lastPromptAt` 이면 같은 차례. `lastPromptAt` 을 못 봤으면 task 를 믿는다). 물음으로 끝나도 done — 팀원의 물음은 팀장이 team_wait 결과로 받는다 ③ **my-turn** — 웹 중지로 멈췄거나(`isInterrupted`) 마지막 말(`lastAssistantText`. jsonl 판정이면 그 차례의 글)이 없거나 빈 글 ④ **my-turn** — 마지막 말의 끝 6줄(끝의 `*_\`` ·공백을 떼고 빈 줄이 된 것은 세지 않는다) 안에 `?`·`？` 가 있다 ⑤ 그 밖은 **done**. 휴식·퇴근·훅이 있는 평소 working·needs-approval·idle 은 가르지 않는다
  - 대기 메시지 취소·중지·모델 변경 409·`modelChangeConflict` 같은 서버 판정은 훅 상태를 본다 (jsonl 판정을 쓰지 않는다). 바쁨(`isBusy`: 계정 전환 경고·전환 뒤 호스트 재시작 확인 `hasBusyWebSessions`)은 이 표시 상태를 따라 waiting 도 넣고 jsonl 로 working 이 된 세션도 센다. 물음표 규칙은 어림이다: "알려 주시면 진행하겠습니다" 처럼 물음표 없이 묻는 글은 done, 끝 6줄 코드·URL 의 `?` 는 my-turn 이 된다. task 는 `~/.claude/pray/team-tasks.json` 에 남아(끝난 것 7일) 서버를 재시작해도 ② 로 본다 (재시작 동안 running 이던 task 는 jsonl 로 메운다 → `team.md` 의 `teamState.ts`)
- 훅은 `type: "http"`로 서버에 직접 POST 한다. 서버가 꺼져 있으면 그 사이 이벤트는 유실되고 Claude Code 쪽엔 영향 없다 (non-blocking). timeout 2초 (질문 훅만 3600초)
- 훅 상태는 서버 메모리에만 있다. 서버 재시작 시 전부 `unknown`에서 다시 시작. 상태 표시에만 쓰고 목록에 넣는 기준은 아니다 (그래서 목록은 서버를 재시작해도 그대로다)
- **웹 세션 = 호스트 pty 목록에 있는 세션.** `--session-id`로 UUID를 넘겨 pty·jsonl·훅이 같은 키로 묶인다
- **그룹 → 팀 → 세션.** 그룹은 그래픽 공간일 뿐이고, 팀은 같은 폴더의 세션 묶음(= 그룹 안의 책상 섬), 세션은 팀 안의 책상이다. 세션의 팀은 저장하지 않고 **cwd 로 매번 판정**한다 (`normalizeCwd`: 소문자·`/`·끝 슬래시 제거, 정확히 같은 폴더만). 팀은 사람이 그룹 라벨 "+"(title "Add team to group")로만 만든다

## 화면 확인 방법 (headless)

화면은 **`npm run shot -- <url> --out <png>`** (`scripts/shot.mjs`, 의존성 없음)로 확인한다. `--help` 에 전체 옵션이 있다. 매번 CDP 스크립트를 새로 짜지 않는다.

```
npm run shot -- http://127.0.0.1:4710 --out scratchpad/a.png                 # 데스크톱 1600x900, 6초 기다린 뒤 캡처
npm run shot -- http://127.0.0.1:4710 --out scratchpad/p.png --phone         # 390x844 mobile·터치·hover:none
npm run shot -- <url> --out a.png --eval "document.title"                    # 캡처 직전 JS 결과를 JSON 으로 출력
npm run shot -- <url> --out a.png --steps steps.json                         # [{type: click|drag|key|eval|wait|shot, ...}]
```

- 포트는 비어 있는 것을 알아서 잡아 여러 팀원이 동시에 써도 겹치지 않는다 (`--port` 로 고정 가능). 캡처 파일은 `Read` 로 열어 본다.
- **기본으로 GET 이 아닌 `/api` 요청은 가짜 200 `{}` 로 막는다** — 실제 세션 터미널 탭을 열면 화면 폭으로 pty resize 가 POST 되고, 보내기·종료 버튼이 실제로 실행되기 때문이다. 쓰기까지 보려면 `--allow-writes`(실제 서버에 대고 쓰지 않는다. 시험 서버에 대고 쓴다).
- 콘솔 오류·예외는 끝에 목록으로 나온다 (종료 코드는 0). 실패(잘못된 URL·eval 예외)는 종료 코드 1.
- **정리는 스크립트가 한다**: 성공·실패·Ctrl+C·예외 어디서든 띄운 Chrome 의 PID 트리(`taskkill /PID <pid> /T /F`)만 끄고 임시 `--user-data-dir`(`%TEMP%\pray-shot-*`)를 지운다. 새 프로필은 하나에 수백 MB 라 안 지워서 `%TEMP%` 에 30GB 넘게·headless 프로세스 수백 개가 쌓인 적이 있고, `taskkill /IM chrome.exe`·`Stop-Process -Name chrome` 처럼 **이름으로 꺼서 사용자 Chrome 창까지 닫은 사고**가 있었다. 그래서 Chrome 을 직접 띄워야 할 때도 그 PID 만 끈다 (이름·`--user-data-dir` 경로가 든 명령줄 패턴 외로 끄지 않는다). 스크립트가 강제로 죽어(작업 관리자 등) 남은 `pray-shot-*` 는 그 폴더의 Chrome 이 없는 것을 확인하고 지운다.
- Vite dev 페이지는 SSE 때문에 `--virtual-time-budget` 방식이 멈추므로 쓰지 않는다 (shot 은 CDP 로 N초 뒤 캡처). dev 모드의 터미널 탭에서 나는 xterm `reading 'dimensions'` 예외는 StrictMode 이중 마운트 탓이고 빌드 결과에서는 안 난다. Vite 는 IPv6 `localhost:4711` 로 열린다.

새 서버 API 는 실행 중인 서버를 재시작하지 않고 시험 서버로 확인한다: 임시 홈(`USERPROFILE`·`HOME`)과 가짜 호스트 pipe 로 다른 포트에 띄운다. **`index.ts` 의 PORT 는 고치지 않는다** (고친 사이 트레이가 서버를 재시작하면 그 포트로 뜬다) — preload(`--import`)로 `net.Server.prototype.listen` 의 4710 과 `net.connect` 의 `\\.\pipe\pray-host` 를 바꾼다. 시험 **호스트**를 띄울 때는 listen 하는 `\\.\pipe\pray-host` 와, 시작 때 connect 해 보는 옛 pipe `\\.\pipe\jk-corp-host` 도 가짜 이름으로 돌린다 — 안 돌리면 옛 이름의 실제 호스트가 떠 있을 때 거기에 붙어 \"옛 호스트가 떠 있음\" 으로 끝난다. 비교가 어긋나면 시험 서버가 실제 호스트에 붙으므로 가짜 pipe 에 연결된 것을 확인한 뒤 시작한다. **`net.connect` 를 바꾼 뒤 `syncBuiltinESMExports()`(`node:module`)를 불러야 한다** — `hostClient.ts` 는 `import { connect } from 'node:net'` 라 안 부르면 바꾼 것이 안 걸려 실제 호스트에 붙는다 (실제로 붙었다). 백슬래시가 든 스크립트는 Bash heredoc 으로 쓰지 않는다 (`\\` 가 `\` 로 줄어 pipe 이름이 깨진다). 화면에서 새 API 를 볼 때는 CDP `Fetch.continueRequest` 의 `url` 로 그 경로만 시험 서버로 돌린다

실제 claude 동작은 node-pty 로 claude 를 직접 띄워 잰다 (Pray 호스트를 거치지 않는다. `CLAUDECODE`·`CLAUDE_*` 를 지운 env, 신뢰된 이 저장소 폴더, `--model haiku`). **훅이 실제 4710 서버로 가지 않게** `--setting-sources project,local`(사용자 settings.json 의 훅을 뺀다)에 `--settings <파일>` 로 http 훅을 기록 서버로 보내고 `--strict-mcp-config` 를 준다 (실제 서버 `/api/sessions` 에서 그 세션이 `unknown` 으로 남는 것으로 확인). `--permission-mode default` 를 준다 — 기본값이 auto mode 면 차례가 끝날 때 "Auto mode works better…" 창이 떠 다음 입력을 먹는다(그 창에서 Enter 가 들어가 `~/.claude.json` 의 `autoModeEnvSetup` 이 지워진 적이 있다). 오래 걸리는 명령은 `node -e "setTimeout(…, 45000)"` (Bash 도구가 `sleep 45` 단독 명령을 막는다). SessionStart http 훅은 오지 않아 입력칸(`❯`)이 그려지기를 기다린다. 화면은 `@xterm/headless` 로 그려 본다. 이 claude 도 `~/.claude/sessions` pid 기록을 남겨 실제 서버 목록에 외부 세션으로 잠깐 보인다
