---
paths:
  - "web/src/quickReplies*.ts"
  - "web/src/QuickRepliesSettings.tsx"
---

# 빠른 답 칩 (Quick replies)

세션이 결정을 물으면 대화 탭 입력 상자 바로 위에 한 줄로 뜨는 둥근 칩("진행"·"보류"·"수정…")과 그 설정(설정 창 Chat 탭 "Quick replies" 절)을 다룬다. 서버 변경은 없다 — 표시 상태(`Session.status`)와 이미 받은 대화만 쓴다.

다른 파일에 있는 항목:
- 입력 상자·보내기·Sending 임시 말풍선 → chat.md (`Composer.tsx`·`Chat.tsx`)
- 표시 상태 my-turn 판정(turnEnd 규칙) → 루트 `CLAUDE.md` "표시 상태"
- 설정 창 Chat 탭 전체 → theme.md "대화 모양"

## 구조

- `web/src/quickReplies.ts` — 칩 목록 저장소와 순수 함수 (`quickReplies.test.ts`): 저장 꼴 `parseQuickReplies`·`serializeQuickReplies`·정리 `normalizeQuickReplies`, 채우기 칩 `isFillReply`·`fillTextOf`·라벨 `quickReplyLabel`, 대화 끝 판정 `endsWithClaudeText`, 띄울 차례 `isQuickRepliesVisible`, 저장소 `quickReplies`·`setQuickReplies`·`subscribeQuickReplies`(`useSyncExternalStore` 용, 같은 값이면 같은 배열)
- `web/src/QuickRepliesSettings.tsx` — 설정 창 Chat 탭 맨 아래 `[Reset chat style]` 위 "Quick replies" 절
- 칩 줄 그리기·누르기는 `Composer.tsx`, 띄울지 계산은 `Chat.tsx` (`quickReplies` prop, `suggestion` prop 과 같은 방식), `isMyTurn`·`isMember` 는 App 이 Chat 에 준다

## 핵심 개념

- **띄우는 조건** (모두 참일 때만): ① 근무 중인 웹 세션(`isWritable`)이고 팀원(`role === 'member'`)이 아님 — 팀장·파트장·팀 밖 웹 세션 (팀원의 물음은 팀장이 `team_wait` 로 받는다) ② 표시 상태 `my-turn` (App: 근무 중이고 `status === 'my-turn'`) ③ 불러온 대화가 지금 세션 것(`loadedSessionId`)이고 마지막 메시지(대기 중 제외)가 글이 있는 claude 메시지 — 중지 줄(`isInterrupt`)·빈 응답·사람 말·system 이면 안 뜬다 ④ 작업 중·승인 대기·질문 중·인계 중이 아니고 확인 안 된 Sending 임시 말풍선이 없음 (누른 직후 칩이 숨어 두 번 안 보내지고, 보내기가 실패하면 "Send failed" 와 함께 다시 보인다) — ①~④ 는 Chat 의 `isQuickRepliesVisible` ⑤ 입력칸 글이 `''` 이고 첨부 칩·인용 칩이 없음 — 이 state 는 Composer 안이라 Composer 가 본다 (글을 치면 숨고 지우면 다시 보인다). 외부·휴식·퇴근은 Composer 가 그려지지 않아 저절로 없다. 칩 목록이 비어 있으면 줄을 그리지 않는다
- **물음인지는 화면에서 다시 정하지 않는다** — 서버 turnEnd 규칙(끝 6줄 안의 `?`·`？`)을 그대로 쓴다. 그래서 어림이다: 물음표 없이 묻는 글("알려 주시면 진행하겠습니다")은 done 이라 칩이 안 뜨고, 끝 6줄 코드·URL 의 `?` 는 my-turn 이라 묻지 않아도 뜬다. 서버를 재시작한 뒤 jsonl `cut` → my-turn 으로 보이는 세션에도 뜰 수 있다 (해롭지 않아 둔다)
- **누르면**: 보내기 칩은 Chat 의 `send(text)` 그대로 바로 보낸다 (입력칸이 빈 때만 보이므로 섞일 글이 없다. Sending 임시 말풍선·보내기 줄 세움·실패 표시 모두 입력칸 보내기와 같다). 마우스 기기는 보낸 뒤 입력칸에 포커스, 터치 기기(`(hover: none)`)는 가상 키보드가 뜨지 않게 포커스하지 않는다. **`:` 로 끝나는 칩**(기본 `수정:`)은 보내지 않고 `fill` 로 입력칸에 `수정: ` 을 넣고 커서를 끝에 둔다 (터치도 포커스 — 이어서 쓴다). 라벨은 `:` 를 `…` 로 바꾼 `수정…`
- **화면 글자** (영어): 칩 줄 `role="group"` aria-label "Quick replies", 보내기 칩 title·aria-label `Send “진행”`, 채우기 칩 `Fill the input with “수정: ”`. 칩 글자 자체는 claude 에게 가는 대화 내용이라 한국어 그대로
- **모양**: 입력 상자 카드 바로 위 한 줄(`.quick-replies`, 양옆은 입력 상자와 같은 `var(--chat-gutter, 16px)`, 아래 8px, 넘치면 가로 스크롤), 칩 `.quick-reply` = `--accent-soft` 알약 + `--line` 테두리 + `--accent-text` 글자, hover 테두리 `--accent`. 폰 블록: 칩 높이 40px. Composer 는 `<>칩 줄<form/></>` 로 그린다
- **설정** (`QuickRepliesSettings.tsx`): 줄마다 입력칸(maxLength 40)과 ×, `[Add reply]`(6줄이면 비활성)·`[Restore defaults]`, 안내 "Shown above the input when a session asks you to decide. End with “:” to fill the input instead of sending.", 다 비면 "No replies · quick replies are off". 줄은 창의 state 라 빈 줄·중복 줄도 고치는 동안 남고, 고칠 때마다 정리한 목록(trim·40자·빈 것과 중복 빼기·6개까지)을 바로 저장해 대화 탭에 곧장 보인다 (`subscribeQuickReplies`). 창을 열기만 해서는 저장하지 않는다 (고른 적 없으면 기본 칩을 따른다)
- **저장**: localStorage `pray.quickReplies` = `{ format: 1, replies: string[] }` (이 브라우저만, 읽기·쓰기 try/catch). 키가 없거나 못 읽는 꼴이면 기본 `진행`·`보류`·`수정:`, 저장한 빈 배열은 꺼짐 그대로. **`pray.appearance`(ChatStyle)에 넣지 않았다** — Reset chat style 이 칩을 건드리지 않게, 대화 모양 기본값 비교·첫 화면 boot 계산과 무관하게. 새 키라 `legacyStorage.ts` 목록에는 없다

## 확인하지 못한 것

- 화면은 빌드 결과(4710, GET 만 — 쓰기는 shot 이 가짜 200 으로 막음) headless 로만 봤다: my-turn 팀장 세션의 칩 3개·title, 글을 치면 숨고 지우면 보임, `수정…` → `수정: `·포커스, 보내기 칩 → Sending 말풍선·칩 숨김·포커스(데스크톱), 폰 390 다크·라이트(칩 40px, 보내기 칩 뒤 포커스 없음, `/input` 실패를 흉내 내면 "Send failed" 와 칩 다시 보임), done 팀장·working 팀장·done 팀원 세션엔 칩 없음, 설정 창 추가·고치기(trim·중복)·×·전부 지우기(꺼짐 안내)·6줄 한도·Restore defaults·Reset chat style 이 칩을 안 건드림·고치면 대화 탭 칩이 바로 바뀜. **my-turn 인 팀원 세션**(그때 실제 세션이 없었다 — 단위 테스트만), 외부 세션, 실제 claude 에게 보내지는 것(실제 세션에 보내지 않는다), 실제 폰·트레이 창·hover 모양은 보지 못했다
