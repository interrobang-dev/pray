---
paths:
  - "server/src/flow*.ts"
  - "web/src/FlowPanel.tsx"
---

# 플로우(flow.team) 알림

플로우 공식 API 클라이언트·폴러와 화면의 Flow 버튼·알림 패널을 다룬다.

원래 루트 `CLAUDE.md` 한 파일이던 내용을 옮긴 것이다. 본문의 "위·아래 …"·"핵심 개념 …" 은 그때의 말이라 가리키는 항목이 다른 파일에 있을 수 있다. 어디서나 지킬 규칙·근무·휴식·퇴근·표시 상태·실행 방법은 루트 `CLAUDE.md`, 다른 영역은 루트의 문서 지도를 본다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

## 구조

- `server/src/flow.ts` — 플로우(flow.team) 공식 API 클라이언트(`https://api.flow.team`, 헤더 `x-flow-api-key`, fetch·시계 주입)와 폴러. 키는 `~/.claude/flow-key.env` 의 `FLOW_API_KEY=` 줄을 **요청마다** 읽는다 (파일을 바꾸면 재시작 없이 반영. 키 값은 로그·응답에 넣지 않는다). 응답은 `{ response: { success, data | error } }` 로 감싸져 오고 실패는 모두 `FlowError(상태코드, 영어 문구)`: 키 없음 503, 연결 실패·해석 실패·그 밖의 플로우 오류 502, 플로우 401(키 거부)도 502 (화면에서 401 은 "Login required" 라서), 429 는 429. 알림(`/user/alarms`)의 cursor 는 순번, 채팅(`/user/chats`)의 cursor 는 쪽 번호지만 둘 다 `lastCursor` 를 다음 cursor 로 넘기고 `hasNext` 로 멈춘다 (마지막 쪽의 lastCursor 는 -1). 쿼리에 모르는 키를 넣으면 플로우가 400 이다 (알림은 readYn·filters·cursor·size, 채팅은 cursor·size. size 1~100). 프로젝트 이름(`/user/projects/participants`)은 메모리 캐시이고 모르는 projectId 가 나와도 60초에 한 번까지만 다시 받는다. 폴러는 index.ts 에서 30초마다(+시작 때) 안 읽은 알림 수(`readYn=N` 끝까지)와 채팅방 `unreadCount` 합계를 세어 `FlowStatus { isConfigured, unreadAlarmCount, unreadChatCount, checkedAt, error }` 로 두고(오류면 수·checkedAt 은 앞 성공 값, 키 없음이면 전부 비움. 서버가 막 떠 첫 확인 전은 `UNCHECKED_FLOW_STATUS` = isConfigured true·수 null 이라 키 없음과 갈린다), checkedAt 말고 바뀐 게 있을 때만 전역 SSE `flow` 이벤트로 보낸다 (`/api/events` 접속 때도 지금 상태를 한 번 보낸다). serialRunner 로 감싸 던지지 않는다. 경로(인증 미들웨어 안): `GET /api/flow`(상태), `GET /api/flow/alarms?readYn=Y|N&cursor=`(50개 한 쪽 → `{ alarms, hasNext, nextCursor }`, 항목에 `projectName`·`registeredAt`(ISO `+09:00`)·`isRead` 등. 꼴이 틀리면 400), `POST /api/flow/alarms/:alarmId/read`·`POST /api/flow/alarms/read-all`(PATCH 중계 뒤 바로 다시 세어 SSE 로 알리고 새 `FlowStatus` 를 응답)
- `web/src/FlowPanel.tsx` — 플로우 알림 보기와 읽음 처리. App 의 `FlowRow`(툴바 세 번째 버튼. 모양은 New Group·New Session 과 같고 플로우 로고(`web/public/flow-logo.png` = 사용자가 준 플로우 로고를 48px 로 줄인 것. `/flow-logo.png` 를 img 로 16px, 각진 사각형이라 CSS 모서리 4px 로 자른다) · "Flow" · 버튼 오른쪽 끝에 [종] N · [말풍선] N (`AlertsIcon`·`ChatsIcon`, 12px 인라인 SVG `currentColor`, `role="img"` + aria-label "Alerts"·"Chats". 말풍선은 `ChatTabIcon` 과 같은 그림). 요약은 둘 다 0 이면 회색, 하나라도 있으면 빨강·굵게(아이콘도 같은 색). 패널이 열려 있으면 버튼이 초록 바탕·테두리. 상태를 아직 못 받았거나 못 셌으면 "…", `isConfigured: false` 면 "No key", 수 없이 오류면 빨강 "Check failed", 앞 수가 있는 오류면 수 + ⚠. 수를 셌으면 title 이 "Show Flow alerts · Alerts N · Chats N", 오류면 전문)는 전역 SSE `flow` 만 듣는다 (`/api/flow` 를 따로 부르지 않는다. 서버 첫 확인 전은 수가 null 이라 "…"). 패널: 머리 "Flow alerts" + 닫기(폰 ←), 그 아래 세그먼트 "Unread | All"(기본 Unread = `readYn=N`) · "Unread chats N"(채팅 내용은 공식 API 에 없다) · ↻. 항목은 안 읽음 점(파랑)·굵기, 프로젝트 이름(없으면 "Project <id>") · Mention·Assigned 배지 · 시각("just now"·"Nm ago" = types.ts `formatAgo`, 그보다 오래면 Chat.tsx `formatClock` 의 "10:12"·"10/21 10:12"), 문구 = message(없으면 content), 둘 다 있으면 content 를 회색 한 줄 말줄임, 보낸 사람. 실제 플로우 알림은 message 가 "OO님의 댓글 등록" 이고 content 가 댓글 글이거나, message 가 null 이고 content 가 글 제목이다. `hasNext` 면 [Load more](nextCursor, 받은 것과 겹치는 alarmId 는 뺀다). 안 읽은 알림 수(SSE)·세그먼트·↻ 가 바뀌면 첫 쪽부터 다시 받고, 늦게 온 옛 응답은 요청 번호로 버린다. 503 은 "No FLOW_API_KEY in ~/.claude/flow-key.env", 그 밖은 서버 `message`. 사무실 숨김 화면에서는 목록·세그먼트 줄이 대화처럼 가운데 960px 열이다. **읽음 처리**: 안 읽은 항목의 보낸 사람 오른쪽 [Mark read](`POST /api/flow/alarms/:alarmId/read`), 머리의 [Mark all read](안 읽은 알림이 1개 이상일 때만, 확인 창 [Mark all read] 뒤 `POST /api/flow/alarms/read-all`). 진행 중에는 버튼이 비활성 "…", 응답의 새 FlowStatus 로 플로우 줄 숫자를 바로 바꾸고(App `onStatus`), 실패는 항목 아래(Mark all read 는 세그먼트 줄 아래) 빨강 한 줄로 서버 문구. [Mark read] 은 그 항목만 읽음 표시로 바꾸고 목록을 다시 받지 않는다 (안 읽음 보기에서도 읽은 항목이 다음 새로고침까지 남는다. 더 보기로 받은 쪽·스크롤을 지키려고) — 서버가 읽음 처리 뒤 다시 세어 SSE `flow` 를 응답보다 먼저 보내므로, [Mark read] 이 진행 중인 동안의 수 변화와 응답이 먼저 와 바꾼 수는 "다시 받기" 에서 뺀다. [Mark all read] 은 수가 바뀌어 첫 쪽부터 다시 받는다

## 확인하지 못한 것

- 플로우 알림 화면에서 안 읽은 알림이 있는 실제 상태와, 앞 수가 남은 채 확인이 실패한 상태(수 + ⚠)는 보지 못했다 (안 읽음 화면은 시험 서버의 가짜 플로우 응답으로, 키 없음은 키 파일을 지워서, 실제 플로우는 안 읽은 것 0 개의 "안 읽은 알림이 없습니다"·"전체" 목록까지 확인했다)
- 플로우 읽음 처리(`PATCH /user/alarms/read`·`/read/all`)는 실제 플로우에 보내 보지 않았다 (가짜 fetch 시험만. body `{ alarmId }` 의 alarmId 를 문자열로 보내는 것과 성공 응답 꼴은 미확인). 안 읽은 알림이 있을 때의 실제 개수 세기도 보지 못했다 (확인 때 안 읽은 알림·채팅이 0 이었다)
