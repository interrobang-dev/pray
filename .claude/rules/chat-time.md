---
paths:
  - "web/src/chatTime*.ts"
  - "web/src/Chat.tsx"
---

# 대화 탭의 보낸 시각·날짜 구분선

대화 탭 말풍선마다 붙는 보낸 시각 "14:05" 와 날짜가 바뀌는 자리의 가운데 회색 줄 "Today"·"Yesterday"·"Nov 12, 2026" 을 다룬다. `chat.md` 가 4만 자에 닿아 나눈 것이다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

다른 파일에 있는 항목:
- 대화 줄·작업 묶음·최근 줄만 그리기·검색·마크·터치 버튼 → chat.md
- 켜기·끄기 옵션 Timestamps(설정 창 Chat 탭·`data-chat-timestamps`) → theme.md "대화 모양"

## 구조

- `web/src/chatTime.ts` — 순수 함수 (`chatTime.test.ts`): 줄마다 보낸 쪽·시각(`RowStamp`) → 그 줄의 시각 글자·앞 구분선 글자(`rowTimes`), 구분선 글자 `dateDividerLabel`, 날짜 키 `localDayKey`, "14:05" `formatTimeOfDay`. 모두 이 PC 시각. 파일 이름이 `ChatTime.tsx` 와 겹치지 않게 그 이름의 컴포넌트 파일은 만들지 않는다 (Windows 가 대소문자를 가리지 않는다)
- `web/src/Chat.tsx` 의 `rowStamp`·`MessageTime`·`DateDivider` 와 `allRowTimes` — 줄을 `RowStamp` 로 바꾸고, 그린다

## 핵심 개념

- **시각을 붙이는 곳**: claude 답(`text` 줄)·내 말(사람 쪽 user, 대기 중·압축 요약·중지 줄 제외)·팀원 쪽 지시 말풍선(`from`). 보낸 쪽 키는 `'claude'`·`'me'`·`'relay:<지시자 이름>'`. **붙이지 않는 곳**: 작업 묶음 줄(걸린 시간이 있다)·펼친 묶음 안 설명 글·진행 중 묶음의 설명 글 말풍선(묶음의 일부라)·대기 중(`isQueued`)·보내는 중(pending, 따로 그린다)·system 글·알림 한 줄·relay 한 줄·질문 기록 카드 — 이것들은 보낸 쪽이 null 이다
- **연속 메시지는 마지막 것에만**: 바로 다음 줄이 같은 보낸 쪽이고 같은 분(이 PC 시각)이며 그 사이에 구분선이 없으면 붙이지 않는다. 보낸 쪽이 null 인 줄(작업 묶음 등)이 끼면 끊긴다. 그래서 claude 답은 보통 앞뒤로 묶음·relay 가 끼어 거의 늘 붙는다
- **날짜 구분선**: 시각이 있는 줄 중 날짜(이 PC)가 앞 줄과 바뀌는 줄 앞, 그리고 대화 첫 줄 앞. 작업 묶음은 첫 메시지 시각, relay 한 줄·질문 기록은 그 도구 호출이 든 메시지 시각으로 날짜를 본다 (Chat 이 도구 ID → 메시지 시각 지도를 만든다). 글자: 오늘 "Today", 어제 "Yesterday", 그 밖(미래 포함) `toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })` "Nov 12, 2026"
- **구분선은 독립 줄이 아니다** — `MessageRows` 가 그 줄의 `ChatRowView` 앞에 같은 Fragment(줄 키)로 붙여 그린다. 그래서 `chatWindow.ts` 의 줄 수(150)·점프·검색·마크의 줄 키·`rowIndexOfJumpKey` 가 그대로다. 구분선·시각은 **전체 줄로 한 번 정하고** 그리는 범위만큼 잘라 넘긴다 (`allRowTimes` → `visibleTimes`) — 그리는 범위의 첫 줄에 억지로 구분선을 넣지 않아, 위로 더 그릴 때 위치 보정 기준 요소(`.earlier-rows` 다음 요소 = 구분선이나 첫 줄)가 사라지지 않는다. 대신 그린 범위가 날짜 중간에서 시작하면 맨 위에 그 날짜 구분선이 없다 ("Earlier messages" 위로 올리면 나온다)
- **"Today" 는 줄(`rows`)이 바뀔 때 다시 정한다** — 타이머가 없어 자정이 지나도 다음 대화 갱신 전까지는 어제 것이 "Today" 로 남는다
- **memo**: 줄에는 시각 글자(문자열 또는 null)만 넘겨 줄 memo 가 그대로다. 같은 분에 같은 쪽 메시지가 새로 오면 바로 앞 줄의 시각이 null 로 바뀌어 그 줄 하나만 다시 그린다. 구분선은 `ChatRowView` 밖이라 줄을 다시 그리지 않는다
- **모양** (style.css `.msg-time`·`.date-divider`, `calc(11px * var(--font-scale))`·`--muted`, 시각은 말풍선 안 `--font-scale` 을 따라 Chat font size 로 바뀐다. title = `formatDateTime` 전체 날짜·시각): 마우스 기기 — 오른쪽에 붙은 내 말(Bubble·Plain)·지시 말풍선은 말풍선 왼쪽 아래 바깥(메신저 꼴), claude 답 Plain 은 답 아래 왼쪽(아래 간격 16px), Card 는 카드 오른쪽 아래 바깥, Bar 내 말은 아래 오른쪽(아래 간격 16px). 터치 기기(`hover: none`) — 복사·마크·인용 버튼이 늘 보여: claude 답은 답 아래 버튼 줄 바로 오른쪽(인용 버튼이 있으면 114px, 없으면 76px), 내 말·지시 말풍선은 왼쪽 바깥이 버튼 자리라 말풍선 아래 오른쪽(아래 간격 16px), Bar 내 말은 아래 버튼 줄(마크·인용) 바로 오른쪽. 구분선은 양옆 `--line` 1px 선 + 가운데 글자
- **검색·복사에 끼지 않는다**: 시각은 `data-search-skip`(칠하기 제외, 검색 대상 글은 원래 메시지 글이라 시각이 들지 않는다)·`user-select: none`, 구분선은 `[data-jump-key]` 밖이고 `user-select: none`. 복사 버튼은 `message.text` 를 복사해 무관하다
- **숨기기**: 대화 모양 Timestamps Hide(`<html data-chat-timestamps="hide">`)는 CSS 로만 `.chat-scope` 안 시각·구분선을 `display: none` 하고 아래 간격도 뺀다 — 렌더를 빼지 않아 바꿔도 대화 줄이 다시 그려지지 않는다. 설정 창 미리보기(`.chat-preview`)에도 구분선 "Today"·시각 둘이 있어 같이 숨는다

## 확인하지 못한 것

- 같은 분 연속 메시지가 한 번만 붙는 것은 단위 테스트로만 봤다 — 실제 서버의 세션들에 같은 분에 연달아 보낸 내 말이 없었다 (남긴 이유: 실제 세션에 보내야 한다. 시험 서버·가짜 대화로 볼 수 있다)
- 자정을 넘기는 순간 "Today" 가 바뀌는 것, 위로 더 그리기로 날짜 경계를 지나는 순간의 위치 보정은 화면으로 보지 못했다 (코드로는 구분선을 전체 줄로 정해 그려 둔 요소가 그대로다)
- 트레이 창·실제 폰·hover 모양·다른 팔레트, 마크한 말풍선·작업 묶음 안(펼침)과의 자리는 보지 못했다. 폰 390 에서 시각이 버튼·다른 말풍선과 겹치지 않는 것은 headless 로 요소 위치를 재 봤다 (Plain·Card 답, Bubble·Bar 내 말, 지시 말풍선)
