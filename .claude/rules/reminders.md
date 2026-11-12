---
paths:
  - "host/src/reminder*.ts"
  - "web/src/RemindersButton.tsx"
  - "web/src/reminders*.ts"
---

# 알림 (Reminders)

정한 시각에 **사람에게 한 번** 울리는 알림. 반복은 없고, 팀장·파트장 세션에 메시지를 보내지 않는다 (사람에게만). 등록 경로는 화면 사이드바(사람)와 팀장·파트장 MCP 도구(예정) 둘이다. 저장·API·울리기(서버)와 화면(목록 툴바 Reminders 보기)이 있고 MCP 도구·트레이 Windows 알림은 아직 없다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

## 구조

- `host/src/reminder.ts` — 꼴·판정 순수 함수 (`@pray/host/reminder`, 테스트 `reminder.test.ts`). `Reminder { id, text, at, createdAt, createdBy, firedAt, isLate?, acknowledgedAt }`·`ReminderCreator`(`{ kind: 'user' }` 또는 `{ kind: 'lead', teamId, partId, sessionId }` — 리드 세션 ID 는 MCP 가 모르니 서버가 등록 때 지휘 단위의 `leadSessionId` 로 채운다), 시각 검증 `parseReminderAt(value, now)` → `{ at }`(UTC ISO) 또는 `{ error: format·past·too-far }`, 울리기·정리 `fireDue(reminders, now)` → `{ reminders, fired, prunedCount }`(넘긴 배열은 안 바꾼다)
- `host/src/hq.ts` 의 최상위 `reminders` (넣은 순서. 정렬은 화면이 한다) — `listReminders`·`addReminder(text, at, createdBy)`(끝에 넣는다)·`acknowledgeReminder(id, isAcknowledged)`(값이 그대로면 안 쓴다. 없음 `ReminderNotFoundError`, 안 울림 `ReminderNotFiredError`)·`removeReminder(id)`(울렸든 아니든)·`fireDueReminders()`(바뀐 게 없으면 안 쓴다). 옛 파일에 키가 없으면 [] 로 읽고 `readOffice` 결과에 싣는다. 서버만 쓴다 — 호스트는 이 키를 몰라도 `readHq` 가 모르는 키를 보존해 지우지 않는다
- `server/src/index.ts` 의 알림 API·울리기 (아래 핵심 개념)
- `web/src/RemindersButton.tsx` — **목록 툴바 "Reminders" 버튼과 사이드바 보기** (툴바 줄·`sidebarView` → web-app.md, 같은 꼴의 Needs you·All TODOs → toolbar.md). 버튼: All TODOs 뒤·Lead models 앞, 알람시계 SVG `currentColor`, title·aria-label "Reminders". 배지 = 울렸고 확인 전 개수만 빨강(`.needs-you-count.urgent`). 예정만 있으면 배지 없이 보통, 하나도 없으면 흐리지만(opacity) disabled 아님 (등록하러 들어가야 해서). 누르면 사이드바가 보기로 바뀌고 같은 버튼·머리줄(`SideViewHead`: ← · "Reminders" · Fired+Upcoming 개수) ← 로 돌아간다. 보기: 맨 위 글 칸 "Remind me about…"(Enter 로도 보냄, 한글 조합 중 무시, `maxLength` 없음 — 길이는 서버) + `<input type="datetime-local">`(min = 지금 분, App 의 1분 시계) + Add(글·시각이 다 있어야 켜짐, 보내는 동안 "Adding…"). 글 칸 Enter 때 시각이 비었으면 시각 칸에 포커스만. 보낼 때 `localInputToIso`(= `new Date(값).toISOString()`, Z 꼴)로 `POST /api/reminders`, 응답 항목을 `applyReminder` 로 App 의 office(`changeReminders`)에 먼저 넣는다 (SSE office 로도 온다). 기다리는 사이 바꾼 칸은 남긴다. "Fired" 구역(있을 때만) = 울렸고 확인 전, `firedAt` 최근순: 체크 = `PATCH {isAcknowledged:true}`(응답을 넣으면 확인한 것이라 숨는다) · 글(두 줄까지, 전문 title) / "Due 14:00"(오늘이면 시각만, 아니면 아래 꼴) · 주의색 "Late"(`isLate`) · 만든 이 · ×(`DELETE`). "Upcoming" 구역 = 안 울림, `at` 이른 순: 글 / "Today 15:30"·"Tomorrow 09:00"·"Nov 14 09:00"(해가 다르면 "Jan 3, 2027 09:00", 이 PC 시각) · 만든 이 · × (체크 없음 — 안 울린 것 확인은 서버 409). 둘 다 없으면 "No reminders". 확인한 것은 보이지 않는다(서버가 7일 뒤 지운다). 만든 이 = "You" 또는 "[Lead] 이름 · 팀"·"[Part lead] 이름 · 팀 › 파트"(`createdBy.sessionId` 로 세션 목록에서 찾고, 못 찾으면 이름 없이 "[Lead] 팀 › 파트", 팀도 없으면 "[Lead]"). 기다리는 동안 그 줄의 체크·× 비활성. 실패는 제목 아래 빨간 한 줄(All TODOs 와 같은 `.all-todos-error`, 서버 `message`, 다음 요청 때 지운다). 폰: 버튼 40px, 입력칸·Add·줄·× 44px, 입력 글자 16px, 체크박스 22px
- `web/src/reminders.ts` — 그 순수 함수 (`reminders.test.ts`): `remindersOf`(옛 응답 [])·`reminderSections`·`unacknowledgedCount`·`applyReminder`·`removeReminder`·`formatDue`·`formatFiredDue`·`toLocalInputValue`·`localInputToIso`·`creatorLabel`. 타입 `Reminder`·`ReminderCreator` 는 `web/src/types.ts` 에 손으로 맞춘 사본 (`Office.reminders?`)

## 핵심 개념

- **꼴.** `id` = `randomUUID` 앞 8자리. `text` = 할 일 글과 같은 규칙(`parseTodoText`: 줄바꿈마다 공백, trim, 1~500자). `at` = UTC ISO(`toISOString`). `firedAt` = 서버가 울린 시각(아직이면 null). `isLate` = 울릴 때 정하는 `firedAt − at > 90초`(`REMINDER_LATE_MS`, 서버가 30초마다 보므로 넉넉히) — 화면·트레이가 같은 값을 읽게 저장한다. 울리기 전에는 키가 없다. `acknowledgedAt` = 사람이 확인한 시각 (boolean 을 따로 두지 않는다 — 보관 기간을 이 시각으로 센다)
- **시각 검증 (`parseReminderAt`).** 받는 꼴 `YYYY-MM-DDTHH:mm[:ss[.sss]][Z|±hh:mm]`. 오프셋이 없으면 **이 PC 시각**(JS `Date.parse` 규칙)이고, 날짜만 있는 꼴은 JS 가 UTC 로 읽어 헷갈려 거절한다. 없는 날짜·시각(2026-02-31·25:00·:60)은 칸을 되짚어 거절(Date 는 넘친 칸을 다음 달로 넘긴다). 1분(`REMINDER_PAST_GRACE_MS`) 넘게 과거면 past(입력하는 사이 지난 몇 초는 받아 다음 회차에 울린다), 366일(`REMINDER_MAX_AHEAD_MS`, 연도 오타 막기) 넘게 뒤면 too-far. 화면은 브라우저에서 `toISOString()` 으로 바꿔 Z 꼴만 보낼 것 (폰 등 다른 시간대 기기에서도 같은 절대 시각)
- **울리기.** 서버가 시작할 때(이전 작업들 뒤) 한 번, 그 뒤 30초마다(`REMINDER_TICK_MS`) `fireReminders()` → `fireDueReminders`: `at ≤ 지금` 이고 안 울린 것에 `firedAt`·`isLate`, **확인한 지 7일(`REMINDER_RETENTION_MS`, 퇴근 기록·task 와 같은 7일) 넘은 것은 지운다** (경계 시각은 남긴다. 확인 전인 것은 지우지 않는다). 그래서 서버가 꺼져 있던 사이 지난 알림은 켜질 때 늦음으로 한 번 울린다. 울린 것이 있으면 `broadcastOffice()`. 요청 처리 밖이라 던지지 않는다 — hq.json 을 못 읽으면 그 회차만 건너뛰고 로그는 실패·복구로 바뀔 때만. 화면 입력이 분 단위라 30초 간격이면 충분하다 (늦어도 30초 안에 울린다)
- **API** (인증·Origin 은 다른 `/api` 와 같다. 오류는 `{ message }` 영어): `GET /api/reminders` → `{ reminders }`(트레이 폴링용. 화면은 `GET /api/office`·`office` SSE 의 최상위 `reminders` 로 받는다) · `POST /api/reminders` `{ text, at }` → `{ reminder }`(사람 등록 `createdBy: user`. 글 400 "Text must be 1 to 500 characters", 시각 400 "Time must be a date and time like …"·"Time must be in the future"·"Time must be within a year") · `PATCH /api/reminders/:reminderId` `{ isAcknowledged }` → `{ reminder }`(boolean 아님 400, 없음 404 "Reminder not found", 안 울림 409 "This reminder hasn't fired yet" — 지우기는 DELETE) · `DELETE /api/reminders/:reminderId` → `{}`(없음 404). 바뀌면 `office` SSE. team_status 에는 싣지 않는다
- 시각은 서버 PC 시계 하나로 본다 (`firedAt` 을 서버가 적어 트레이가 같은 PC 시계로 "켠 뒤 울린 것" 을 고를 수 있다 — 트레이 단계에서 쓴다)

## 확인하지 못한 것

- 화면(Reminders 보기)은 Vite dev + 시험 서버(임시 홈·가짜 pipe) headless 로만 봤다: 데스크톱 다크 — 배지·구역·Late·[Part lead] 만든 이·등록 → 1~2분 뒤 SSE 로 Fired 로 옮겨 배지 2→3 → 체크 → 2·× 삭제, 과거 시각 400 빨간 줄, 다 지우면 흐린 버튼(disabled 아님) / 데스크톱 라이트 / 폰 390 다크 — 44px·16px·체크박스 22px·가로 넘침 없음. 실제 서버(트레이)·한글 조합 중 Enter 는 보지 못했다. 날짜 칸 안 글자("연도-월-일")·달력은 브라우저 기본 컨트롤이라 브라우저 언어를 따른다 (화면 글자 영어 규칙의 예외로 둔다)
- 저장·API·울리기는 단위 테스트(`reminder.test.ts`·`hq.test.ts`)와 시험 서버(임시 홈·가짜 pipe·포트 4793)로만 확인했다: 시작 때 과거 at 한 건이 늦음(`isLate: true`)으로 울리고 확인한 지 8일 된 건은 지워지고 6일 된 건은 남음, 모르는 키 보존, office 응답에 `reminders`, 400(글 없음·공백·501자·at 없음·날짜만·2월 31일·낱말·2분 전·367일 뒤), 오프셋 없는 `2026-12-01T15:30` → `06:30Z`(이 PC KST), 안 울린 것 확인 409·boolean 아님 400·없음 404, 확인·확인 취소·삭제 200, 다른 Origin POST 403, at = 지금+40초가 53초 뒤 office SSE 로 `firedAt`·`isLate: false`. 실행 중인 서버(트레이)에서 실제 hq.json 에 쓰는 것과, 그 순간 호스트가 같은 파일을 쓰는 경쟁은 보지 못했다 (실제 서버를 재시작해야 해서 사용자가 반영한다)
