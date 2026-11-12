---
paths:
  - "web/src/ChatImage.tsx"
  - "web/src/chatImageUrl*.ts"
  - "web/src/ChatLink.tsx"
  - "web/src/chatLinkUrl*.ts"
  - "web/src/ChatPath.tsx"
  - "web/src/chatPathTarget*.ts"
  - "web/src/openPath*.ts"
---

# 대화 속 그림·링크·경로 열기

대화 탭 마크다운(`Markdown.tsx` 의 `isChat`) 안에서 이 PC 파일을 가리키는 것 — 그림, 로컬 .html 링크(Chrome 으로 열기), 경로·경로 링크·URL 인라인 코드(Files 탭·작업 파일 창·탐색기로 열기) — 의 화면 쪽을 다룬다. `chat.md` 가 4만 자에 닿아 나눈 것이다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

다른 파일에 있는 항목:
- 마크다운 렌더러·숫자·경로 강조(`markdownHighlight.ts`)·작업 파일 창(`Files.tsx`) → chat.md
- 서버 그림 API 꼴·범위 → server-api.md `chatImage.ts`·security.md "대화 속 그림 API 의 범위"
- .html 을 Chrome 으로 열기·경로 열기 서버 규칙(이 PC 전용 갈래) → security.md `openInChrome.ts`·`openPath.ts`
- Files 탭이 경로 열기 요청을 처리하는 법 → workspace.md

## 구조

- `web/src/ChatImage.tsx`·`chatImageUrl.ts` — **대화 속 그림** (claude 가 `![캡처](C:\…\a.png)` 처럼 이 PC 파일을 링크한다). 주소(`chatImageTarget`, 순수 `chatImageUrl.test.ts`): http(s)·`data:image/` 는 그대로, 드라이브 문자 절대 경로·`file:///C:/…`·상대 경로는 `GET /api/sessions/:id/image?path=`(→ server-api.md), 그 밖(다른 프로토콜·`//호스트`·`/` 로 시작)은 실패 카드. **주소는 파서 값이 아니라 마크다운 원문에서 그 그림 자리(hast `position` 오프셋)를 잘라 꺼낸다** (`imageDestinationOf`) — 파서는 `\` 뒤 문장 부호를 이스케이프로 먹고(`D:\workspace\@private` → `D:\workspace@private`) `\` 를 `%5C` 로 바꾼다. 그래서 `MarkdownText` 가 원문을 context `MarkdownSource` 로, Chat 이 세션 ID 를 context `ChatImageSession` 으로 준다 (대화 목록은 `loadedSessionId` — 세션을 바꾼 직후 messages 는 앞 세션 것, 곁가지 질문 카드는 `sessionId`. 없으면 이 PC 파일 그림은 실패 카드). 공백 든 경로는 `<…>` 로 감싸야 그림이 된다(마크다운 규칙). 모양: 말풍선 폭·최대 높이 360px(폰 300px)·비율 유지, 둥근 모서리·옅은 테두리·투명 체크무늬, 아래 작은 설명(alt, 없으면 파일 이름). 불러오는 중엔 320×180 회색 칸, 실패하면 "Image not available · a.png" 카드(title 에 전체 경로). 누르면 크게 보기 = `Modal`(`.image-viewer`, body 로 portal — React 이벤트가 말풍선으로 올라가지 않게 click 을 멈춘다. 화면 가득·폰 전체 화면, Esc·바깥 클릭·× 로 닫힘, 제목 = 설명, 부제 = 경로, "Open original" 새 탭). 요소는 span·button 뿐이다 (마크다운 그림은 `<p>` 안)
- `web/src/ChatLink.tsx`·`chatLinkUrl.ts` — **대화 속 로컬 .html 링크** (`[보고서](C:…\report.html)`). 주소는 그림처럼 원문에서 링크 자리를 잘라 꺼낸다(`rawLinkUrl`. 링크 글에 그림이 들 수 있어 마지막 `](` 부터, 못 꺼내면 파서 값). 꼴(`localHtmlPath`, 순수 `chatLinkUrl.test.ts`)은 그림과 같은 이 PC 경로(드라이브 절대·`file:///C:/…`·cwd 상대)이고 `.html`·`.htm` 으로 끝날 때만 (`a.html#x` 는 보통 링크). 이 PC 화면(context `IsLocalPage` = `/api/auth/me` isLocal, main.tsx 가 준다)이면 href 없는 a(`.local-link`, 손가락 커서, title "Open in Chrome · <경로>", Enter 로도)이고 누르면 `POST /api/sessions/:id/open-in-chrome`(→ security.md) — 실패는 알림 창 "Couldn't open in Chrome: <서버 message>". 다른 PC·세션 ID 가 없으면 흐리게(`.is-disabled`, opacity 0.5) title "Opens in Chrome only on this PC", 눌러도 아무것도 안 한다. .html 이 아닌 이 PC 경로 링크는 경로 열기(아래 `ChatPath.tsx`, `a.local-link.is-openable`. 세션을 모르는 곳은 보통 링크), 그 밖의 링크는 파서 값을 기본 변환(`defaultUrlTransform`)해 새 탭
- `web/src/ChatPath.tsx`·`chatPathTarget.ts`·`openPath.ts` — **대화 속 경로·URL 열기**. 누를 수 있는 곳은 대화 목록뿐이다: Chat 이 context `OpenChatPath` 를 `loadedSessionId` 로 준다(세션을 바꾼 직후 messages 는 앞 세션 것) — 곁가지 질문 카드·설정 창 미리보기에는 없어 눌리지 않는다. **눌리는 것** (꼴은 서버가 받는 것만 — `isOpenablePath`: 드라이브 절대·cwd 상대, `:줄`·`:줄:열` 허용, `/…`·`~/…`·UNC 는 안 눌린다): ① 숫자·경로 강조의 `span.path`(`ChatPathSpan`, 경로 색 그대로. 글자는 파서 값이라 `\@` 처럼 마크다운이 이스케이프로 먹은 경로는 틀린 경로가 된다 — 그림·링크처럼 원문에서 꺼내지 않았다) ② 인라인 코드 전체가 `findHighlights` 의 경로 규칙으로 한 경로(`inlineCodeTarget`, 코드 칩 모양 그대로) ③ .html 이 아닌 이 PC 경로 링크 `[x](C:\…)`·`[x](docs/a.md)`(`localLinkPath` — 원문 주소는 `rawLinkUrl`, `#`·`?` 가 든 것은 보통 링크, .html 은 Chrome 그대로). 셋 다 class `is-openable`(손가락 커서·hover 밑줄·포커스 링, `role="link"`·tabIndex·Enter, title "Open <경로>"), 클릭은 `preventDefault`·`stopPropagation`(말풍선·묶음 여닫기로 안 올라가게)이고 그 요소 안에서 글자를 끌어 고른 중이면 열지 않는다. **URL**: 인라인 코드 전체가 http(s) URL 이면 새 탭 링크 `a.code-link`(`noopener noreferrer`, 코드 칩 그대로). 코드 블록은 건드리지 않고 백틱 밖 URL 은 remark-gfm 링크 그대로. **누르면** `openChatPath` 가 `POST /api/sessions/:id/open-path`(→ security.md `openPath.ts`)를 부르고 `openPathAction`(순수) 대로: files → App `onOpenInFiles` → 저장 안 한 편집 확인(`whenLeavingAllowed`) 뒤 Files 탭 + `filesRequest`(세션 ID·path·line·isDirectory·번호, 보고 있는 세션일 때만) → FilesTab 이 처리하고 비운다 (→ workspace.md), work-files → Chat 의 `workFilesRequest` → 폴더 버튼(`FilesButton`)이 그 폴더(파일이면 든 폴더 + 미리보기)로 작업 파일 창을 연다(이미 열려 있으면 새로), explorer → 아무것도 안 한다, 403 "Opens only on this PC"(다른 PC 에서 cwd·scratchpad 밖) → 누른 글자를 `copyText` 로 복사하고 알림 창 "Opens only on this PC. Path copied: …"(가벼운 "Copied" 표시가 버튼 안 state 뿐이라 알림 창으로 정했다. 복사 실패면 "Couldn't copy the path"), 그 밖(404·다른 403·네트워크) → 알림 창 "Couldn't open: <서버 message>". 순수 함수 테스트 `chatPathTarget.test.ts`·`openPath.test.ts`·`chatLinkUrl.test.ts`(`localLinkPath`). 파일 이름이 `chatPath.ts` 가 아닌 것은 Windows 가 대소문자를 가리지 않아 `./ChatPath` 와 겹쳐서다 (tsc 가 실제로 막았다)

## 확인하지 못한 것

- 대화 속 .html 링크는 Vite + 시험 서버(가짜 jsonl, LAN IP 로 붙인 Vite 로 다른 PC 화면)로 데스크톱 다크·폰(이 PC)만 봤다: 링크 모양·흐림, 없는 파일 404 알림 창. 트레이 창·라이트·실제 claude 가 쓴 링크는 보지 못했다 (남긴 이유: 위 그림과 같다)
- 대화 속 그림은 Vite + 시험 서버의 가짜 jsonl 로 데스크톱·폰 다크만 봤다 (불러오는 중 칸은 클래스를 붙여 흉내). 실제 claude 가 쓴 그림 링크·트레이 창·라이트 테마·다른 PC 는 보지 못했다 (남긴 이유: 실제 세션·서버를 건드리게 된다)
- 대화 속 경로 열기 화면은 Vite(4791) + 실제 서버 대화(GET 만, 퇴근 세션)로 데스크톱 다크만 봤다: 대화의 눌리는 경로(그 세션 137개)·인라인 코드 클릭 → (open-path 는 페이지 fetch 를 덮은 가짜 응답) Files 탭 파일 + 42줄 고름·트리 표시, 폴더 → 트리 `web/src` 펼침, work-files → 작업 파일 창 + 미리보기, 403·404 알림 창. 403 의 경로 복사는 headless 의 JS click 이라 사용자 동작이 아니어서 실패 문구로만 봤다. hover 밑줄·키보드 Enter·폰·라이트·`span.path`·경로 링크 클릭·URL 코드 링크 클릭·다른 PC 의 http 복사(fetch 뒤라 사용자 동작 시간 안인지)는 보지 못했다
