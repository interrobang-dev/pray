---
paths:
  - "server/src/dailyReport*.ts"
  - "server/src/dayCommits*.ts"
  - "server/src/dayUsage*.ts"
---

# 오늘 한 일 (Today 창의 서버 쪽)

팀마다 그날 한 일(커밋·끝난 task·토큰·끝낸 할 일·팀원 들고 남)과 내 책상의 끝낸 할 일을 한 응답으로 주는 `GET /api/daily` 와 그 출처별 읽기를 다룬다. 화면(목록 툴바 Today 줄·팀 ⋯ 메뉴 Today·검색 명령 "Today's work" 가 여는 창)은 toolbar.md 다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

다른 파일에 있는 항목:
- task·운영 기록 저장과 보관 기간(`teamTaskFile.ts`)·task usage(`taskUsage.ts`) → team.md
- 커밋 명령 규칙(`run`·`GIT_BASE`)·History 탭의 `parseLog` → workspace.md
- 팀 할 일 저장 규칙 → host.md

## 구조

- `server/src/index.ts` 의 `GET /api/daily?date=YYYY-MM-DD` — 빼면 오늘. 꼴이 틀리거나 없는 날짜·오늘보다 뒤·7일 전보다 앞이면 400 "Invalid date", hq·세션 목록을 못 읽으면 500 "Couldn't read teams or sessions", 조립 중 예외 500 "Couldn't build the daily report". `Cache-Control: no-store`, 인증은 다른 `/api` 와 같다 (읽기만이라 로그인한 다른 PC 도 된다). 응답 `{ today, oldestDate, date, from, to, myDesk: { todosDone }, teams: TeamDaily[] }` — `teams` 는 hq 배열 순서 그대로(화면이 목록 순서로 다시 줄 세운다), 팀마다 `{ teamId, name, commits: { kind: git·svn·none, items: [{ hash, shortHash, subject, authorName, at, partId }], isTruncated, error }, tasks: DailyTask[], tokens: { lead, members, other, sessions: [{ sessionId, name, position, kind, usage, model }] }, todosDone: [{ id, text, priority, doneAt }], events: { joined, released } }`. 팀마다 커밋·토큰을 동시에 읽는다
- `server/src/dailyReport.ts` — 날짜·조립 순수 함수 (`dailyReport.test.ts`): `parseDayParam`·`dayRangeOf`(로컬 자정 `new Date(y, m, d)` ~ 다음 날 자정. +24h 로 계산하지 않는다)·`localDateKey`·`oldestDateOf`(`DAILY_MAX_DAYS_BACK` 7), `firstLine`(빈 줄이 아닌 첫 줄, 200자 `DAILY_HEAD_LIMIT` 에서 "…"), `dailyTasksOf`(끝난 시각이 그날인 task, running 은 지시 시각이 그날인 것, 그 시각 최근순. 지시·결과는 첫 줄만 `instructionHead`·`resultHead`, 오류는 `hasError` 만. 지금 Today 창은 task 수와 지시·끝난 시각만 쓰고 줄·전문은 보이지 않는다 — 전문은 Tasks 창 API `GET /api/team/:teamId/tasks/:taskId`), `dailyTodosOf`(`doneAt` 이 그날인 완료, 최근순), `dailyEventsOf`(그날 spawn·dismiss 수), 토큰 가르기 `leadIdsOf`·`tokenKindOf`·`dailyTokensOf`(세션 줄은 출력 많은 순)
- `server/src/dayCommits.ts` — 그날 커밋 (`dayCommits.test.ts`, 실제 임시 git 저장소·worktree. git 이 없으면 그 묶음만 건너뛴다). `listFolderDayCommits`: `detectVcs` 가 svn 이면 `kind: 'svn'`, 없으면 `none`(명령을 안 돌린다), git 이면 `log -z --format=…%cI… --since=@<from 초> --until=@<to 초 − 1> --max-count=201 HEAD -- .` 를 `parseLog` 로 읽고 범위로 한 번 더 거른다 (`--since` 는 시계가 어긋난 커밋 몇 개를 지나칠 수 있다). 200개(`DAY_COMMIT_LIMIT`)에서 자르고 `isTruncated`. 실패는 커밋이 없는 저장소(`rev-parse --verify HEAD` 가 1)면 빈 목록, 아니면 `error`(영어). `makeDayCommitsCache`: (폴더 `normalizeCwd` + 범위) 키로 60초(`DAY_COMMITS_TTL_MS`), 같은 키를 동시에 물으면 도는 것 하나, 실패한 것은 기억하지 않는다. `teamDayCommits`: 팀 폴더가 git 이 아니면 그 kind 만 주고 파트 폴더는 보지 않는다. 팀 폴더 HEAD 커밋을 먼저 넣고(`partId` null) worktree 파트 폴더 HEAD 에만 있는 커밋을 그 파트로 넣는다 (해시로 겹침 제거, 시각 최근순) — 파트 브랜치는 만들 때의 팀 HEAD 를 품고 있어 파트를 먼저 보면 그 앞의 팀 커밋이 파트 것이 된다. 파트 오류는 "Part <이름>: …" 로 잇는다
- `server/src/dayUsage.ts` — 그날 토큰 (`dayUsage.test.ts`, 임시 jsonl). `dayFilesOf(<projects>/<projectSlug(폴더)>)`: 수정 시각이 그날 자정 이후인 `<세션ID>.jsonl` 과 그 세션의 `<세션ID>/subagents/*.jsonl`(역시 그날 바뀐 것). 폴더는 팀 폴더와 worktree 파트 폴더 (slug 는 `leadHandoff.ts` 의 `projectSlug` — 긴 경로를 줄인 Claude Code 이름은 따르지 않는다). `parseUsageLine`: `"assistant"` 가 든 줄만 JSON.parse, `type: assistant`·`<synthetic>` 아님·`message.usage` 있음, 범위 앞·뒤는 before·after. **사이드체인 줄도 센다**. `makeDayUsageReader`: 파일(경로 + 범위)마다 `{ scanned, byId(message.id → 마지막 줄 usage), anonymous, model }` 를 서버 메모리에 두고 — 처음에는 마지막 줄바꿈까지를 끝에서 1MB 씩 거꾸로 읽어 그날보다 앞선 응답 줄을 만나면 멈추고(처음 본 줄 = 그 응답의 마지막 줄), 그 뒤에는 늘어난 바이트만 앞으로 읽는다(나중 줄이 같은 id 를 덮는다. 덜 쓰인 끝 줄은 넣지 않는다). 파일이 줄었으면 처음부터. 같은 키 동시 요청은 하나, 2,000개 넘으면 오래된 것부터 버린다. 읽기는 덩어리마다 비동기라 이벤트 루프를 오래 막지 않는다. `dayUsageOfDirs`: 파일 4개씩(`FILE_CONCURRENCY`) 읽어 세션마다 더한다 (서브에이전트 파일은 그 세션 몫, model 은 세션 jsonl 의 것). 못 읽은 파일은 건너뛴다

## 핵심 개념

- **날짜는 서버 PC 의 로컬 자정 기준이다.** 화면은 응답의 `today`·`date`·`oldestDate` 를 쓰고 자기 시계로 오늘을 정하지 않는다 (다른 PC 의 시간대가 다르면 하루가 어긋난다). 고를 수 있는 범위는 오늘부터 7일 전까지 — task 보관이 7일이라 그보다 앞은 task 가 비어 있다
- **토큰 기준이 Tasks 창의 task usage 와 다르다.** 여기는 그날 시각(jsonl 응답 줄의 timestamp)의 응답을 세션마다 세고, **사이드체인·서브에이전트 파일까지 그 세션 몫에 넣는다** (실제로 쓴 토큰이라서). Tasks 창 task usage(`taskUsage.ts`)는 지시 뒤 주 대화 응답만이고 사이드체인·서브에이전트를 빼며 날짜를 넘겨 task 하나에 통째로 센다. 그래서 task usage 합과 Tokens 의 Members 가 맞지 않는다 — 둘을 더하지 않고, Today 창의 토큰(숫자 칸·팀 막대)은 모두 Tokens(jsonl)를 쓴다 (task usage 는 응답에 있지만 창이 쓰지 않는다). 비용($)은 계산하지 않는다
- **Lead·Members·Other 가르기** (`tokenKindOf`, 리드가 먼저): Lead = 지금 팀장·파트장(`leadSessionId`) + 팀·파트 폴더의 웹 기록(근무·휴식 `webSessions`·퇴근 `offDuty`)의 extraArgs 에 `--mcp-config` 가 있는 세션 (Hand over 로 끝난 옛 리드도 퇴근 기록이 남아 있는 동안은 Lead), Members = 세션 목록의 role member + 이 팀 task 의 `memberSessionId` + 운영 기록의 세션, Other = 그 밖 (사람이 팀 폴더에서 직접 띄운 세션·외부 세션·기록이 지워진 옛 리드). 이름은 세션 목록(근무·휴식·퇴근)의 name → title → ID 앞 8자리, 목록에 없으면 null
- **출처별 한계.** task 7일(`finishedAt`)·운영 기록 30일(`teamTaskFile.ts`), 끝낸 할 일은 "Clear done" 으로 지우면 사라진다, 퇴근 기록은 released 6시간·그 밖 7일 뒤 지워져 이름·Lead 판정이 Other·ID 로 바뀐다, jsonl 은 Claude Code `cleanupPeriodDays`(기본 30일)에 지워진다. git 은 HEAD 에서 닿고 그 폴더(`-- .`)를 건드린 커밋만 — 체크아웃하지 않은 브랜치는 안 보이고, 날짜는 커미터 시각이라 어제 커밋을 오늘 amend·rebase 하면 오늘 것이다, squash 병합은 해시가 달라 파트 커밋과 팀 커밋이 둘 다 보인다, 작성자는 거르지 않는다(pull 해 온 남의 커밋도 커미터 시각이 그날이면 보인다). **SVN 팀 커밋은 첫 판에서 보이지 않는다** (`kind: 'svn'` 만. `svn log` 는 사내 서버에 붙어야 해 느리고 사내망 밖에서 실패한다)
- **비용** (실측, 이 PC 의 실제 hq.json 팀 10개를 읽기만 하는 스크립트로): 오늘 첫 요청 766ms(이벤트 루프 최대 지연 약 18ms)·두 번째 18ms, 어제 첫 853ms, 7일 전 첫 2,086ms(그날 이후 바뀐 파일을 모두 거꾸로 읽는다)·두 번째 10ms. 캐시는 서버 메모리라 서버를 다시 켜면 첫 요청이 다시 무겁다. 커밋은 폴더당 약 30ms

## 확인하지 못한 것

- 실행 중인 서버(트레이)에는 아직 반영하지 않아 실제 4710 응답을 보지 못했다 (서버 재시작이 필요하다). 시험 서버(임시 홈·가짜 pipe·포트 4791 — git 팀·worktree 파트·SVN 흉내 폴더·형상관리 없는 팀, 리드·옛 리드·팀원·서브에이전트·사람 세션 jsonl)로 오늘·어제·7일 전 응답, 400(꼴·범위·배열), jsonl 에 줄을 덧붙인 뒤 늘어난 만큼만 더해지는 것을 봤다. 실제 데이터 비용은 위 스크립트로만 쟀다
- 실제 SVN 작업 사본 팀(`kind: 'svn'`), 긴 경로라 Claude Code 가 slug 를 줄인 팀 폴더, Claude Code 가 jsonl 을 다시 써서 크기가 줄어드는 경우(처음부터 다시 읽는 것은 단위 테스트만)는 보지 못했다
