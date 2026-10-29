# 내부 이름 jk-corp → pray 이전 설계 (2단계)

상태: 결정됨 · 구현 전

## 목적과 범위

앱 이름을 Pray 로 바꾼다. 1단계(화면 글자·로고)는 커밋됐고(`0d9cd73`), 이 문서는 **2단계: 코드·실행 환경 안의 이름**이다.

- 범위 안: 패키지 이름, 호스트 pipe, 설정 폴더 `~/.claude/jk-corp/`, 환경변수 `JK_CORP_*`, MCP 서버·도구 이름과 이미 저장된 리드 실행 인자, mod 플러그인 이름, 작업 스케줄러 작업 이름, Electron 앱 데이터 폴더·알림 ID, localStorage 키, 임시 파일 접두사, 로그 파일 이름, 1단계에서 남은 글자(아래)
- 범위 밖 (그대로 둔다): 인증 쿠키 `jk_session`, 스프라이트 메타 키 `jkCorp`, 포트 4710·훅 주소, 저장소 폴더·GitHub 저장소·worktree 폴더·Claude Code 프로젝트 슬러그 (뒤 "범위 밖: 저장소 폴더" 에 나중에 할 일만 적는다)

### 1단계와의 경계

| 글자 | 상태 |
|---|---|
| 화면 제목 (`index.html` title·목록 헤더·로그인) | 처리됨 (1단계) |
| 트레이 창 제목·툴팁·오류 창 제목 | 처리됨 (1단계) |
| 메일 보낸 이·제목 (`"Pray"`·`[Pray] Login code`) | 처리됨 (1단계) |
| 트레이 알림 제목 `jk-corp · N sessions` (`desktop/src/main.ts`) | **이 작업** |
| 화면 오류 문구 `BTW_TIMEOUT_MESSAGE` "…the jk-corp mod loaded…" (`server/src/btw.ts`) | **이 작업** |
| 화면 안내 "a background jk_wait stops…" (`web/src/modelSetting.ts`) | **이 작업** (도구 이름이 리드마다 달라 "a background wait" 처럼 이름 없이) |
| 로그 첫 줄 `jk-corp host listening`·`jk-corp server http://…` | **이 작업** |
| claude 가 읽는 MCP 오류 글 "jk-corp 서버(…)에 연결 실패" 등 3 (`mcp/src/teamApi.ts`) | **이 작업** ("Pray 서버") |
| mod 설명·백그라운드 질문 description "jk-corp side question" | **이 작업** |
| 바탕화면 바로가기 파일 이름 `jk-corp.lnk` | 저장소 밖 — 사용자가 손으로 |

## 새 이름

| 갈래 | 지금 | 새 이름 |
|---|---|---|
| 루트 패키지 | `jk-corp` | `pray` (private, 배포 안 함) |
| 작업 공간 패키지 | `@jk-corp/{host,server,web,desktop,mcp}` | `@pray/…` (npm 에 `@pray` 범위가 있어도 workspace 가 먼저라 상관없다) |
| 호스트 pipe | `\\.\pipe\jk-corp-host` | `\\.\pipe\pray-host` |
| 설정 폴더 | `~/.claude/jk-corp/` | `~/.claude/pray/` (sprite-src 포함) |
| 로그 파일 | `jk-corp-host.log`·`jk-corp-server.log` | `pray-host.log`·`pray-server.log` |
| 환경변수 | `JK_CORP_SESSION`·`JK_CORP_CLAUDE`·`JK_CORP_TEAM_ID`·`JK_CORP_PART_ID`·`JK_CORP_SERVER` | `PRAY_SESSION`·`PRAY_CLAUDE`·`PRAY_TEAM_ID`·`PRAY_PART_ID`·`PRAY_SERVER` |
| MCP 서버 키 | `jk-corp` | `pray` (도구 전체 이름 `mcp__pray__<도구>`) |
| MCP 도구 | `jk_spawn_member`·`jk_assign`·`jk_wait`·`jk_status`·`jk_dismiss` | `team_spawn_member`·`team_assign`·`team_wait`·`team_status`·`team_dismiss` (D4) |
| mod 플러그인 | `jk-corp` | `pray` |
| 스케줄러 작업 | `jk-corp-host`·`jk-corp-server` | `pray-host`·`pray-server` |
| localStorage | `jk-corp.*` 7개 (#13) | `pray.*` 같은 뒷부분 |
| 임시 파일·폴더 | `<tmp>/jk-corp-account-*`, `.credentials.json.jk-corp.<pid>.tmp` | `pray-account-*`, `.pray.<pid>.tmp` |
| Electron 앱 데이터 | `%APPDATA%\@jk-corp\desktop` | `%APPDATA%\@pray\desktop` (D7) |
| Electron 알림 ID | `app.setAppUserModelId('jk-corp')` | `pray` (#17, 남은 일 1) |

`pray` 는 흔한 낱말이지만 위 이름들은 모두 이 PC 안에서만 쓰이는 이 앱 전용 자리(pipe·폴더·env·localStorage)다. 충돌이 문제 될 수 있는 곳은 MCP 도구 이름뿐인데, 도구는 서버 키로 이름공간이 나뉘어(`mcp__pray__…`) 다른 MCP 와 겹치지 않는다.

## 갈래별 조사

개수는 `git grep` 기준 (문서·`CLAUDE.md`·`.claude/rules`·`README.md` 제외, 줄 수, 2026-10-29 `ef309ba` 기준).

| # | 갈래 | 쓰는 곳 | 바꾸면 깨지는 것 | 결정 |
|---|---|---|---|---|
| 1 | 패키지 `@jk-corp/*` | package.json 6(web 이 `@jk-corp/host` 에 의존), import: server 12파일·web 4파일(`@jk-corp/host/dotCharacter`) — 모두 21파일 29줄, package-lock | `npm install` 전에는 import 가 안 풀려 서버가 못 뜨고 web 빌드가 실패한다. **Electron 앱 데이터 폴더가 바뀐다**(#12) | 한 번에. 끝나면 `npm install` |
| 2 | pipe | `host/src/protocol.ts` 1 (호스트 listen·서버 connect 둘 다 이 상수) | 호스트·서버 중 하나만 새 코드면 서버가 호스트에 못 붙는다. **옛 호스트가 살아 있는데 새 호스트가 뜨면 pipe 이름이 달라 둘 다 떠서 같은 웹 세션을 두 번 `--resume` 한다** | 한 번에 + 새 호스트·트레이는 옛 pipe 가 살아 있으면 뜨지 않는다 (D3) |
| 3 | 설정 폴더 | 경로를 직접 만드는 곳 4: `host/src/hq.ts`(hq.json), `server/src/config.ts`(config.json·auth-tokens.json·instructions.jsonl), `server/src/accountStore.ts`(accounts.json), `desktop/src/main.ts`(logs). 그 밖에 `scripts/install-startup.ps1`(logs), tools 문서·레시피 설명 13줄(sprite-src 경로 안내), 테스트 3 | 옮기지 않고 경로만 바꾸면 빈 폴더로 뜬다: 팀·그룹·세션 기록이 안 보이고, 휴식 웹 세션이 resume 되지 않고, 다른 PC 로그인이 풀리고(config 없음 = 127.0.0.1 전용), 계정 보관함이 비어 보인다 | 시작할 때 한 번 자동 이전 (D1·D2) |
| 4 | 환경변수 (호스트 → 자식) | `JK_CORP_SESSION`: ptyPool 1 → mod 4. `JK_CORP_CLAUDE`: ptyPool·accountLogin 2 (이 PC 사용자 환경에는 없음) | 호스트가 새 이름을 넣는데 mod 가 옛 이름만 읽으면 제안·대기 취소·곁 질문이 조용히 멈춘다. **mod 는 파일이 바뀌면 바로 다시 읽혀서** `git pull` 순간부터 호스트 재시작 전까지 어긋난다 | 한 번에. mod 는 한동안 둘 다 읽는다 (D6) |
| 5 | 환경변수 (리드 MCP) | `JK_CORP_TEAM_ID`·`PART_ID`·`SERVER`: lead.ts → mcp 4 | **이미 저장된 리드 `--mcp-config` 에 옛 env 가 박혀 있다** (#7). mcp 가 새 이름만 읽으면 옛 리드가 resume 될 때 MCP 가 "환경변수 필요" 로 바로 끝나 도구가 사라진다 | mcp 는 둘 다 읽고 받은 쪽으로 모드를 고른다 (D5) |
| 6 | MCP 서버 키·도구 이름 | 서버 키: lead.ts 1. 도구 등록·설명: mcp 약 10. 리드 지침 lead.ts. 화면 판정: `server/src/messages.ts` 접두사 1, `web/src/Chat.tsx` 상수 3 + 알림 요약 `(jk-corp/jk_wait)` 1, 테스트. 주석 약 10 (taskWait·turnEnd·shells·teamState 등) | 화면이 새 이름만 알면 **이미 쌓인 jsonl 의 옛 호출**(팀장 대화의 지시·보고 한 줄, 잘리지 않는 결과)이 도구 블록·잘린 결과로 돌아간다 — jsonl 은 지우지 않으니 옛 이름 읽기는 영구다 | 새 리드는 새 이름, 화면·서버는 두 이름 다 (D4·D5) |
| 7 | 저장된 리드 실행 인자 | 실제 hq.json(조사 때): webSessions 13 중 8, offDuty 19 중 4 가 `--mcp-config` 를 가진 리드. `--mcp-config` = 서버 키 `jk-corp` + node 경로 + **본 저장소 절대 경로**(`D:/workspace/@private/jk-corp/node_modules/tsx/…`·`mcp/src/index.ts`) + `JK_CORP_*` env. `--append-system-prompt` = "jk-corp 사무실" + `jk_*` 도구 이름 (지금 lead.ts 보다 옛 문구인 리드도 있다) | MCP 스크립트 경로가 **지금 저장소 파일**을 가리키므로 resume 하면 새 mcp 코드가 옛 env·옛 서버 키로 돈다. 그래서 mcp 코드만 바꿔도 옛 리드가 바로 영향을 받는다 | 손대지 않는다 (D5) |
| 8 | mod 플러그인 이름 | `mod/.claude-plugin/plugin.json` 1, `register.ts` `PLUGIN_NAME` 1, 테스트 | plugin.json 이름과 `PLUGIN_NAME` 이 다르면 자기 fill 을 못 알아봐 대기 취소가 stuck 이 된다. 둘은 같은 커밋 | 한 번에. `CLAUDE_CODE_PLUGIN_DIRS`(저장소\mod 절대 경로)는 그대로 |
| 9 | 훅 설치 | `hooks/install.mjs` 주석 1 | 없음. 실제 settings.json 의 훅 7개는 `http://127.0.0.1:4710/api/hook*` 주소로만 알아보고 `jk-corp` 글자가 없다 | 주석만 |
| 10 | 작업 스케줄러 | `scripts/*.ps1` 작업 이름 5줄, 로그 폴더 1 | 지금 등록된 작업은 없다(확인함). 등록했던 PC 라면 이름을 바꾼 뒤 stop·uninstall 이 옛 작업을 못 찾는다 | 이름 바꾸고 stop·uninstall 은 한동안 옛 이름도 지운다 |
| 11 | 로그인 시 자동 실행·바로가기 | 레지스트리 Run 값 이름은 `electron.app.Electron`, 값은 저장소 경로의 electron.exe. 바로가기 `jk-corp.lnk` 는 저장소 밖 | 패키지 이름으로는 안 깨진다 (경로만 본다). 알림 ID(#17)와 엮일 수 있다 | 그대로. 바로가기 파일 이름은 사용자가 손으로 |
| 12 | Electron 앱 데이터 | `desktop/package.json` 의 name 으로 정해지는 `%APPDATA%\@jk-corp\desktop` (트레이 창의 localStorage·캐시·single-instance 잠금) | 새 폴더로 바뀌어 **트레이 창의 화면 설정(#13)이 사라지고**, single-instance 잠금이 옛 트레이와 따로라 옛·새 트레이가 같이 뜰 수 있다 | 트레이가 뜰 때 한 번 폴더 이전 (D7) + D3 막이 |
| 13 | localStorage | 키 7개: `theme`·`appearance`·`appearanceBoot`(`appearance.ts`), `isOfficeHidden`·`collapsedGroups`·`isFocusZoneCollapsed`·`isOffDutyOpen`(`App.tsx`). `web/index.html` 인라인 스크립트가 `theme`·`appearanceBoot` 를 읽는다. 테스트 `appearance.test.ts` | 키만 바꾸면 브라우저마다 테마·Appearance·접기 상태가 기본값으로 돌아간다. index.html 스크립트를 빼먹으면 첫 화면이 번쩍인다 | 새 키가 없으면 옛 값을 복사, 옛 키는 남김 (D8) |
| 14 | 인증 쿠키 `jk_session` | server index.ts 1, 테스트 2 | 바꾸면 다른 PC 가 모두 로그아웃된다 (토큰 30일) | 유지 |
| 15 | 스프라이트 메타 `jkCorp` | 아틀라스 JSON 12, web·tools·server 수십 줄. `meta.app` 문구 `jk-corp tools/sprites/build.py` | 바꾸면 아틀라스 JSON 을 다시 만들거나 손으로 고쳐야 하고, "옵션을 더해도 기존 결과는 바이트 단위로 같다" 는 build.py 약속을 깬다. 얻는 것이 없다 | 유지 (`meta.app` 문구도) |
| 16 | 임시 이름 | accountStore 접두사 2 (`jk-corp-account-`, `.jk-corp.<pid>.tmp`), 테스트의 `mkdtemp` 접두사 여럿 | 로그인 관리자는 뜰 때 15분 넘은 `jk-corp-account-*` 폴더(토큰이 들어 있을 수 있음)를 지운다. 접두사만 바꾸면 서버가 죽어 남은 옛 폴더를 영영 안 지운다 | 바꾸고 한동안 옛 접두사도 지운다. 테스트 접두사는 기능과 무관해 같이 바꾼다 |
| 17 | Electron 알림 ID | `desktop/src/main.ts` `app.setAppUserModelId('jk-corp')` 1 (조사 뒤 추가된 코드) | Windows 알림 기록·알림 설정(끄기 등)이 이 ID 에 묶여 바꾸면 처음 상태가 된다. Electron 은 로그인 항목의 기본 이름에 이 ID 를 쓸 수 있어 "Launch at login" 체크 표시가 기존 Run 값을 못 찾을 수 있다 (확인 안 함) | 남은 일 1 |

### 실제 설정 폴더 (읽기만 함)

`~/.claude/jk-corp/`: hq.json 64KB(+ 손으로 남긴 `.bak-*` 2개), instructions.jsonl 1MB, accounts.json, auth-tokens.json, config.json(SMTP 비밀번호), logs/(host·server·desktop-launch 로그), sprite-src/ 353MB(v0~v6 생성 원본). 누가 쓰는지:

| 파일 | 읽기 | 쓰기 |
|---|---|---|
| hq.json | 호스트·서버 | 호스트·서버 (임시 파일 + rename) |
| config.json | 서버 | 사람 |
| auth-tokens.json | 서버 | 서버 |
| accounts.json | 서버 | 서버 |
| instructions.jsonl | 서버 | 서버 (덧붙이기) |
| logs/ | 사람 | 호스트·서버(트레이·스크립트가 경로를 `--log` 로 넘김, 열어 둔 채 쓴다) |
| sprite-src/ | tools (`--source-dir` 로 손으로 넘김) | 사람·tools |

## 결정 사항

### D1. 설정 폴더는 시작할 때 한 번 `renameSync` 로 옮긴다 — 결정

선택지는 ① 시작할 때 자동 이전 ② 옛 폴더를 계속 대체로 읽기 ③ 손으로 옮기는 스크립트였고 **①로 정했다**. 같은 드라이브 rename 이라 sprite-src 353MB 까지 같이 옮겨도 바로 끝나고 원자적이다. ②는 두 경로를 영원히 들고 다니고, ③은 잊으면 빈 폴더로 뜬다.

규칙 (`dataDir()` 하나로. 호스트 패키지에 두고 서버가 import, 트레이는 CommonJS 라 같은 규칙을 따로 둔다 — 두 곳을 같이 고친다):

| 상태 | 동작 |
|---|---|
| `pray/` 있음 | `pray/` 를 쓴다. `jk-corp/` 도 있으면 로그에 경고만 (합치지 않는다) |
| `pray/` 없음, `jk-corp/` 있음 | `renameSync(jk-corp, pray)`. EPERM·EBUSY·EACCES 면 50ms 간격 5번 재시도 |
| rename 이 ENOENT | 다른 프로세스가 먼저 옮겼다 → `pray/` 를 쓴다 |
| 재시도 뒤에도 실패 | **이번 실행은 `jk-corp/` 를 쓴다** + 로그 경고 |
| 둘 다 없음 | `pray/` (지금처럼 없으면 기본값) |

파일 상태만 보고 정하므로 여러 프로세스가 같은 답을 낸다: 하나가 옮기면 나머지는 `pray/` 만 보고, 모두 실패하면 모두 `jk-corp/` 를 본다. 실측(Windows, Node 24): 다른 프로세스가 안의 파일을 열어 두면 폴더 rename 은 EPERM, 닫으면 성공. 세 프로세스가 동시에 rename 하면 하나만 성공하고 나머지는 ENOENT.

### D2. 트레이가 먼저, 호스트·서버도 같은 규칙으로 옮긴다 — 결정

- **트레이**: 호스트·서버를 띄우기 전에 옮긴다 (`--log` 경로를 새 폴더로 넘기기 위해). 트레이를 Quit 한 뒤 켜면 폴더를 쥔 프로세스가 없어 rename 이 성공한다
- **호스트·서버**: 시작하자마자, hq.json·로그를 열기 전에 같은 규칙을 부른다 (`npm run dev`·스케줄러처럼 트레이 없이 뜰 때)
- 실패 시 되돌리기: rename 은 성공 아니면 아무 변화 없음이라 되돌릴 것이 없다. 반쯤 옮겨진 상태가 없다
- 함정: 옛 트레이가 살아 있는 채 새 코드의 호스트만 "Restart host" 하면 옛 트레이가 넘긴 옛 `--log` 경로(`jk-corp/logs/…`)로 로그를 열어 `jk-corp/` 가 다시 생긴다. 규칙상 `pray/` 를 쓰므로 데이터는 갈리지 않지만, 그래서 **이전은 트레이 Quit 뒤에만** 한다 (이전 순서)

### D3. 옛 호스트·옛 트레이와 같이 뜨지 않게 막는다 — 결정

pipe 이름(#2)과 Electron 잠금 폴더(#12)가 바뀌면 옛·새가 서로를 못 본다. 둘 다 hq.json 의 같은 webSessions 를 resume 하면 **한 세션에 claude 가 둘** 붙는다 (jsonl 이 섞인다).
새 호스트는 시작할 때 옛 pipe `\\.\pipe\jk-corp-host` 에 connect 해 보고 붙으면 로그를 남기고 **종료 코드 0**(트레이가 다시 띄우지 않는 "의도한 중지")으로 끝난다. 새 트레이도 같은 확인 뒤 붙으면 "Quit the old tray first" 창을 띄우고 끝낸다. 이 막이는 호환 코드라 지울 때는 남은 일 2.

### D4. MCP 서버 키는 `pray`, 도구는 `team_*` — 결정

선택지는 ① `pray_*` ② `team_*` ③ 접두사 없음(`assign`·`wait`…)이었고 **②로 정했다**. 도구는 서버 키로 이미 이름공간이 나뉘어(`mcp__pray__team_wait`) 제품 이름을 또 넣을 필요가 없고, 넣으면 이름이 또 바뀔 때 도구까지 바꿔야 한다. ③은 지침 글("wait 로 결과를 받고")에서 낱말과 도구가 구분되지 않고, ①은 뜻이 이상하게 읽히고 화면 표시가 `pray/pray_wait` 로 겹친다.

화면·서버는 **두 이름을 모두** 읽는다 (영구 — 옛 jsonl 때문):

- `messages.ts` 자르지 않는 결과: 접두사 `mcp__jk-corp__`·`mcp__pray__` 둘 다
- `Chat.tsx`: 도구를 서버·이름으로 따로 본다 — 서버는 `jk-corp`·`pray` 중 하나, 이름은 `jk_spawn_member`·`team_spawn_member` 중 하나 (D5 로 섞인 꼴 `mcp__jk-corp__team_*` 은 생기지 않지만 받아도 해가 없다). 백그라운드 알림 요약 `(jk-corp/jk_wait)`·`(pray/team_wait)` 둘 다
- `runningTools.ts` 는 이름을 그대로 보이므로 손댈 것 없다

### D5. 이미 저장된 리드는 옛 이름으로 계속 돈다 — 결정

선택지는 A 이전 때 hq.json 의 리드 extraArgs 를 새로 쓰기, B MCP 가 받은 env 로 모드 고르기, C 옛 리드를 정리하고 새로 만들기였고 **B 로 정했다**. A 는 호스트가 resume 하기 전에 돌 곳이 따로 필요하고 대화 중간에 지침이 바뀌며 대화 기록의 옛 도구 호출과 새 도구 이름이 어긋난다. C 는 리드 대화 맥락을 잃는다.

- `PRAY_TEAM_ID` 가 있으면 새 모드: 도구 `team_*`, 설명 안의 도구 이름도 `team_*`
- 없고 `JK_CORP_TEAM_ID` 가 있으면 옛 모드: 도구 `jk_*` (`PART_ID`·`SERVER` 도 같은 접두사 쪽을 읽는다)
- 둘 다 없으면 지금처럼 오류로 끝난다
- hq.json 의 리드 기록은 건드리지 않는다. 옛 리드는 지침·도구·대화 기록이 그대로 맞는다
- 새 리드 지침은 "Pray 사무실" + `team_*` 도구 이름. 새로 만드는 리드부터다 (지금 규칙과 같다)
- 옛 모드 코드는 hq.json 의 webSessions·offDuty 에 `JK_CORP_TEAM_ID` 를 가진 기록이 없을 때 지운다 (남은 일 2)

### D6. 환경변수·pipe·패키지·mod 이름은 한 번에 — 결정

한 번에 바꾸고 재시작한다. 예외 둘: 리드 MCP env 는 D5, mod 의 `JK_CORP_SESSION` 은 한동안 `PRAY_SESSION` 다음 대체로 읽는다 (`$.env.get` 은 리터럴만 받으므로 두 번 부른다) — `git pull` 순간 mod 가 다시 읽혀 호스트 재시작 전까지 어긋나는 틈을 없앤다.

### D7. Electron 앱 데이터 폴더는 `@pray\desktop`, 트레이가 시작할 때 옮긴다 — 결정

선택지는 ① 패키지 이름을 따라 `@pray\desktop` + 옛 폴더 rename ② `app.setName('Pray')` 로 `%APPDATA%\Pray` ③ `app.setPath('userData')` 로 옛 폴더 계속 쓰기였고 **①로 정했다**. D1 과 같은 규칙(새 폴더가 없을 때만 rename)을 `requestSingleInstanceLock` 전에 한다. 옛 트레이가 살아 있으면 잠금 파일 때문에 rename 이 실패하고, 그때는 D3 이 막는다.

### D8. localStorage 는 복사, 옛 키는 남긴다 — 결정

키 7개(#13) 모두 같은 규칙: 새 키가 없고 옛 키가 있으면 옛 값을 새 키에 쓴다. 읽고 쓰는 곳이 `appearance.ts`·`theme.ts`·`App.tsx` 로 흩어져 있으므로 옮기기는 앱 시작 때 한 번(`main.tsx` 에서 렌더 전)에 모아 한다. `web/index.html` 인라인 스크립트는 React 보다 먼저 돌므로 `pray.theme`·`pray.appearanceBoot` 가 없으면 `jk-corp.*` 를 읽는다 (안 그러면 첫 화면이 번쩍인다 — 그 스크립트와 appearance 규칙은 같이 고친다). 옛 키를 지우지 않아 코드를 되돌려도 설정이 남는다. 트레이 창은 D7 로 폴더째 옮겨지므로 같은 규칙으로 따라온다.

### D9. 유지하는 것 — 결정

쿠키 `jk_session`(#14), 스프라이트 `jkCorp`·`meta.app`(#15), 포트·훅 주소(#9), 지난 설계 문서(`docs/plans/2026-10-2*`)의 옛 이름 — 그때의 기록이라 고치지 않는다. `CLAUDE.md`·`.claude/rules/*.md`·`README.md`·`tools/sprites/README.md`·레시피 설명의 이름·경로는 지금 상태 문서라 고친다.

## 이전 순서

커밋은 기능 단위로 나누고, **main 반영은 두 번**에 나눈다 (결정): 데이터를 건드리는 1차(설정 폴더)를 먼저 따로 확인하고, 나머지를 2차로 한꺼번에. 각 커밋은 그 갈래의 `CLAUDE.md`·`.claude/rules` 줄을 같이 고친다.

| 차 | 커밋 | 내용 | 반영 뒤 사용자가 할 일 |
|---|---|---|---|
| 0 | — | (코드 없음) | `~/.claude/jk-corp/` 의 sprite-src 를 뺀 파일을 따로 백업 (zip 하나). config.json·accounts.json 에 비밀이 있으니 저장소·공유 폴더에 두지 않는다 |
| 1차 | `feat(data-dir): 설정 폴더를 ~/.claude/pray 로 옮기고 시작 때 한 번 자동 이전` | D1·D2 규칙, hq.ts·config.ts·accountStore.ts·트레이 logDir·install-startup.ps1, 로그 이름 `pray-*.log`, tools 문서·레시피 설명의 sprite-src 경로 | 트레이 Quit → main 반영 → `npm run build --workspace desktop` → 트레이 켜기 → `~/.claude/pray/`(sprite-src 포함) 생김·`jk-corp/` 사라짐·팀·세션·로그인·계정 그대로인지 확인 |
| 2차 | `refactor(*): 패키지 이름을 @pray/* 로 바꾸기` | package.json·import(server·web)·package-lock, D7 트레이 앱 데이터 이전 | (2차 끝에 한꺼번에) |
| 2차 | `refactor(host): 호스트 pipe·환경변수 이름을 pray 로 바꾸기` | pipe, `PRAY_SESSION`·`PRAY_CLAUDE`, D3 막이(호스트·트레이), mod 의 env 대체 읽기, 로그 첫 줄 | |
| 2차 | `refactor(mod): 플러그인 이름을 pray 로 바꾸기` | plugin.json 이름·설명·`PLUGIN_NAME`·곁 질문 description·테스트, `btw.ts` 시간 초과 문구 | |
| 2차 | `feat(mcp): MCP 서버 pray·도구 team_* 로 바꾸고 옛 리드는 옛 이름으로` | D4·D5: mcp 모드·teamApi 오류 글, lead.ts, messages.ts, Chat.tsx, modelSetting.ts 안내, 테스트·주석 | |
| 2차 | `feat(web): localStorage 키를 pray.* 로 옮기기` | D8 | |
| 2차 | `refactor(desktop): 알림 ID·알림 제목을 pray 로 바꾸기` | #17 (남은 일 1 이 정해진 뒤), 알림 제목 `Pray · N sessions` | |
| 2차 | `chore(scripts): 스케줄러 작업 이름을 pray-* 로 바꾸기` | #10, 옛 이름도 지우기 | |
| 2차 | `chore(*): 임시 이름·주석의 jk-corp 정리` | #16, 남은 주석, `hooks/install.mjs` 주석 | |
| 2차 반영 | — | — | 트레이 Quit → main 반영 → `npm install` → `npm run build` → `npm run build --workspace desktop` → 트레이 켜기 → 웹 세션이 `--resume` 되고 제안·대기 취소·곁 질문이 되는지, 옛 팀장 하나에게 `jk_status` 를 시켜 도구가 살아 있는지, 새 팀장을 만들어 `team_*` 가 보이는지, 트레이 창 테마·Appearance 가 남았는지, 알림이 뜨는지. `jk-corp.lnk` 이름은 원하면 손으로 |

주의: **2차 커밋들을 main 에 따로따로 반영하지 않는다** — 반영하는 순간 mod 가 다시 읽히고, 트레이 메뉴의 호스트·서버 재시작이 새 코드를 섞어 띄운다(pipe 가 다른 호스트·서버). 반영은 늘 트레이 Quit 상태에서 하고 다 끝난 뒤 켠다. 다른 worktree(파트)의 리드도 MCP 는 본 저장소 `mcp/src/index.ts` 를 띄우므로 기준은 본 저장소 main 이다.

## 되돌리기

| 대상 | 방법 |
|---|---|
| 코드 | 트레이 Quit → `git revert` → 위 빌드 → 켜기 |
| 설정 폴더 | 옛 코드는 `jk-corp/` 만 보므로 **코드를 되돌리기 전에** 트레이 Quit 상태에서 `~/.claude/pray` 를 `~/.claude/jk-corp` 로 손으로 rename 한다 (`jk-corp/` 가 다시 생겨 있으면 안을 보고 로그 외에 없으면 지운다). 안 하면 옛 코드가 빈 폴더로 떠 휴식 세션이 resume 되지 않는다 — 기록은 `pray/` 에 남아 있어 잃지는 않는다 |
| Electron 앱 데이터 | `%APPDATA%\@pray\desktop` → `%APPDATA%\@jk-corp\desktop` (안 하면 트레이 창 설정만 기본값) |
| localStorage | 옛 키가 남아 있어 할 일 없음 |
| 이전 뒤 만든 리드 | `PRAY_*` env 로 저장돼 옛 mcp(옛 env 만 읽음)에서는 MCP 가 바로 끝난다 → 그 리드들은 새로 만들어야 한다. 되돌릴 가능성이 있으면 2차 반영 뒤 며칠은 새 리드를 만들지 않는다 |
| 백업 | 0단계 zip |

## 확인 방법

- 단위 테스트: `dataDir()` 표의 다섯 상태(임시 홈, rename 실패는 파일을 연 자식 프로세스로), 동시 세 프로세스 경쟁; mcp 모드 고르기(env 별 등록 도구 이름); `Chat.tsx`·`messages.ts` 의 옛·새 이름 판정(옛 jsonl 꼴 그대로의 가짜 메시지); localStorage 옮기기 순수 함수와 index.html 인라인 스크립트(`appearance.test.ts` 의 `runInline` 에 옛 키만 넣은 경우)
- 시험 서버 (CLAUDE.md "화면 확인 방법"): 임시 홈에 실제 `~/.claude/jk-corp/` 의 hq.json·config.json·instructions.jsonl 을 복사(accounts.json·auth-tokens.json 은 가짜로, sprite-src 는 빈 폴더로)하고 새 코드 서버·호스트를 띄워 이전 결과를 본다. preload 로 바꾸는 pipe 이름은 **새 이름 `pray-host` 와 옛 이름 `jk-corp-host` 둘 다** 가짜로 돌린다 — 안 돌리면 D3 막이가 실제 옛 호스트를 보고 끝나거나, 시험 호스트가 실제 호스트 pipe 에 붙는다
- D3: 가짜 옛 pipe 를 열어 둔 채 새 호스트를 띄워 종료 코드 0 으로 끝나는지
- 옛 리드: 시험 서버 + 옛 꼴 `--mcp-config`(서버 키 `jk-corp`, `JK_CORP_*` env, 이 worktree 의 mcp)로 node-pty claude(Haiku)를 띄워 `/mcp` 화면에서 도구 이름이 `jk_*` 인지, 새 꼴이면 `team_*` 인지. 실제 hq.json 의 리드는 쓰지 않는다
- 화면: Vite dev + CDP 가짜 `/api` 로 옛 이름·새 이름 팀장 대화가 둘 다 지시·보고 한 줄로 보이는지, 옛 localStorage 키만 넣고 새로고침해 테마·Appearance·접기 상태가 이어지는지
- 실제 반영 확인은 "이전 순서" 표의 사용자 확인 항목

## 범위 밖: 저장소 폴더·GitHub·worktree

이번에 빼는 이유: 폴더 경로가 **사용자 데이터에 절대 경로로** 박혀 있어 이름 바꾸기와 다른 종류의 이전이다.

- hq.json: `teams[].cwd`, 파트 `worktree.cwd`, webSessions·offDuty 의 `cwd`(조사 때 본 저장소 8 + worktree 7), 리드 `--mcp-config` 안 tsx 로더·mcp 스크립트 경로. 호스트는 **폴더가 없는 휴식 세션을 resume 하지 않고 기록을 지운다** — 폴더만 옮기면 리드·팀원 기록이 사라진다
- Claude Code 프로젝트 슬러그 `~/.claude/projects/D--workspace--private-jk-corp*`(jsonl 과 **사용자 자동 메모리 `memory/`**). 서버는 jsonl 을 모든 프로젝트 폴더에서 세션 ID 로 찾지만, claude `--resume` 이 다른 cwd 에서 옛 슬러그의 jsonl 을 찾는지는 확인하지 않았다
- `~/.claude.json` 신뢰 키 `projects["D:/workspace/@private/jk-corp…"]`
- git worktree 등록 경로(`git worktree repair` 필요), worktree 폴더 이름 `jk-corp.worktrees`(worktree.ts 가 저장소 폴더 이름에서 만든다)
- 바탕화면 바로가기·레지스트리 Run 값의 electron.exe 경로
- GitHub `interrobang-dev/jk-corp`: 이름을 바꾸면 GitHub 가 옛 주소를 넘겨주지만 `origin` 은 고친다. 조직 이름 규칙(제품명만, 소문자)으로는 `pray`

나중에 할 때 필요한 것: 모든 프로세스 정지 → 폴더 이동 → worktree repair → hq.json 의 경로 일괄 치환(위 다섯 곳) → 프로젝트 슬러그 폴더 이동(메모리 포함) → `~/.claude.json` 신뢰 키 추가 → 바로가기·자동 실행 다시 등록 → 원격 주소 변경. 별도 설계 문서로 한다.

## 남는 위험

- 옛 이름 읽기 코드가 영구로 남는다 (화면·서버의 MCP 이름 판정). mcp 옛 모드는 옛 리드가 정리될 때까지
- 2차를 트레이 Quit 없이 반영하면 옛·새가 섞여 뜬다. D3 막이가 세션 중복은 막지만 서버가 호스트에 못 붙는 상태는 사용자가 트레이를 다시 켜야 풀린다
- `jk-corp/` 와 `pray/` 가 둘 다 있는 상태(되돌렸다 다시 올릴 때 등)는 합치지 않고 `pray/` 를 쓴다 — `jk-corp/` 에만 있는 새 기록은 손으로 옮겨야 한다
- 조사 뒤에도 코드가 계속 바뀌고 있다 (조사 사이에 localStorage 키 4개·알림 ID·곁 질문이 늘었다). 구현 첫 단계에서 `git grep -i "jk-corp\|jk_corp\|JK_CORP\|jk_"` 을 다시 돌려 이 표와 맞춘다

## 남은 일

1. **알림 ID(#17)를 바꿀지 정한다.** 바꾸면 Windows 알림 설정·기록이 처음 상태가 되고 "Launch at login" 표시가 어긋날 수 있다. 바꾸기 전에 `setLoginItemSettings` 가 이 ID 를 이름으로 쓰는지 확인하고, 쓰면 `name` 을 기존 값으로 명시한다. 정해지기 전에는 `jk-corp` 그대로 두고 그 커밋만 미룬다
2. 옛 이름 호환 코드를 지울 시점 (나중에 정하기로 함): mcp 옛 모드(D5), D3 막이, 옛 임시 폴더 접두사 지우기, 스케줄러 옛 이름 지우기, mod 의 `JK_CORP_SESSION` 대체 읽기. 화면·서버의 옛 MCP 이름 판정은 지우지 않는다 (옛 jsonl)
3. 바탕화면 바로가기 `jk-corp.lnk` 이름 바꾸기 (사용자 손)

## 확인하지 못한 것

- 폴더 rename 실측은 임시 폴더에서 Node 로만 했다 (열린 파일 EPERM, 동시 rename 하나만 성공). Electron 이 잠금 파일을 쥔 userData 폴더 rename 은 재지 않았다
- `app.setAppUserModelId` 가 로그인 항목(Run 값) 이름에 쓰이는지, 바꾸면 알림 설정이 어떻게 되는지
- 실행 중인 웹 세션에서 mod 의 plugin.json 이름이 바뀔 때 Claude Code 가 그대로 다시 읽는지 (다른 플러그인으로 보고 옛 것을 남기는지)
- `claude --resume` 이 cwd 와 다른 프로젝트 슬러그의 jsonl 을 찾는지 (범위 밖 저장소 이전 때 필요)
- npm 레지스트리에 `@pray` 범위가 있는지 (배포하지 않아 영향 없다고 판단)
