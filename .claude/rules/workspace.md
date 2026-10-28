---
paths:
  - "web/src/FilesTab.tsx"
  - "web/src/CodeView.tsx"
  - "web/src/codeLines*.ts"
  - "web/src/workspaceTree*.ts"
---

# Files 탭 (세션 작업 폴더 보기)

세션 패널의 세 번째 탭 Files — 고른 세션의 cwd 를 IDE 처럼 본다. **지금은 읽기만 한다.** 이어질 단계: 2단계 위치 공유(줄 고르기·Add to chat), 3단계 git/SVN 변경 보기(Changes), 4단계 편집(127.0.0.1 접속에서만 허용할 예정). 각 단계가 붙을 자리는 아래 "다음 단계 자리".

다른 파일에 있는 항목:
- 서버 API 꼴·경로 검증·숨김 목록·찾기 점수·인코딩 → server-api.md (`index.ts` 의 "세션 작업 폴더(cwd) API", `workspaceFiles.ts`)
- 패널 탭 세그먼트·`shownTab` → web-app.md (`App.tsx`)
- scratchpad 작업 파일 모달(대화 오른쪽 아래 폴더 버튼, `Files.tsx`)은 다른 기능이다 → chat.md. `formatSize` 만 그 파일 것을 쓴다

## 구조

- `web/src/FilesTab.tsx` — Files 탭 전체. 위 막대 `.ws-toolbar`: ←(폰에서 파일을 볼 때만, title "Back to files") · 빠른 찾기 `QuickFind` · 경로 표시줄(기준 폴더 이름 / 폴더들 / **파일 이름**, 좁으면 폴더 부분만 말줄임되고 파일 이름은 남는다, 툴팁은 Windows 전체 경로) · 크기 · 지난 시각(툴팁 `formatDateTime`, EUC-KR 이면 " · EUC-KR") · ↻(title "Reload": 기준 폴더·펼친 폴더 목록과 고른 파일을 다시 받는다). 아래 `.ws-body` grid: 왼쪽 트리 칸 `.ws-side`(`clamp(160px, 32%, 300px)` — 사무실이 보이는 520px 패널에서 160px, 사무실 숨김 넓은 화면에서 300px) + 오른쪽 `FileView`. 트리: 폴더를 펼칠 때 `tree?path=` 를 받는다(지연 로딩). 줄은 ▸/▾ + 이름(말줄임, 툴팁 경로), 들여쓰기 14px × 깊이, 고른 파일은 `--accent-soft`. 펼친 폴더 끝에 회색 한 줄 "Loading…"·실패 문구(빨강 `--error`)·"Empty folder"·"Showing the first 2,000 items"·"N hidden"(툴팁이 숨기는 종류). `FileView`: 고른 것 없음 "Select a file to view it", 그림(png·jpg·jpeg·gif·webp·bmp·ico·avif)은 `file/raw` 를 `<img>` 로(체크무늬 바탕, ↻ 마다 `&v=` 로 다시), 그 밖은 `file?path=` → 글이면 `CodeView`, binary "Binary file · 12 KB · No preview", too-large "Too large to show · 3.2 MB (limit 1 MB)", 실패 "Couldn't open the file: <서버 message·HTTP 코드·Network error>". SVG 는 글(xml 강조)로 본다
- `QuickFind`(같은 파일) — 입력칸 placeholder "Go to file"(title "Go to file (Ctrl+P)"). 앞뒤 공백 뺀 글을 150ms 모아 `find?q=` 로 보내고 글이 바뀌면 앞 요청을 끊는다. 결과는 입력칸 아래 뜨는 목록(최대 100, 이름 굵게 + 폴더 회색, 폭 520px·높이 360px 안 스크롤)과 끝의 회색 한 줄("Searching…"·"No matching files"·"Showing 100 of 342 · type more to narrow"·"Searched only the first 50,000 files"·"Search failed: …"). ↑↓ 로 고르고(끝에서 돈다, 마우스를 올려도 고른다) Enter·클릭으로 연다 — 조상 폴더를 펼치고(안 받은 것은 받는다) 그 파일을 고르고 트리에 그 줄이 그려지면 트리만 스크롤해 보이게 한다(`scrollIntoView` 는 overflow hidden 인 패널까지 움직여서 `offsetTop` 으로. 그래서 `.ws-tree` 가 `position: relative`). 열면 입력칸을 비우고 포커스를 뺀다. Esc 는 글이 있으면 지우고 없으면 닫는다 (이벤트를 멈춘다). 목록은 `mousedown` 기본 동작을 막아 입력칸 blur 로 먼저 닫히지 않는다. 한글 조합 중 키는 무시
- `web/src/CodeView.tsx` — 읽기 전용 코드 보기 (`memo`). highlight.js(`highlight.js/lib/common` — rehype-highlight 가 쓰는 lowlight 와 같은 코어·언어 모듈이라 번들이 두 벌 되지 않는다)로 칠하고 색은 style.css 의 `.hljs-*` 규칙(`--hl-*` 변수, 팔레트·다크를 따른다). 서버 `language` 가 없거나 highlight.js 가 모르거나 글이 512K 자(`HIGHLIGHT_MAX_CHARS`)를 넘으면 강조 없이 이스케이프만. 줄은 접지 않고 `.code-view` 가 가로·세로 스크롤한다
- `web/src/codeLines.ts` — 줄 만들기 순수 함수 (`codeLines.test.ts`): `normalizeText`(CR 지움, 끝 줄바꿈 하나 뒤 빈 줄은 줄로 세지 않는다 — GitHub 처럼. 편집기의 마지막 빈 줄 번호와는 하나 다르다), `splitHighlightedLines`(highlight.js 결과 HTML 을 줄로 나누며 줄을 넘는 span 은 줄 끝에서 닫고 다음 줄 앞에서 다시 연다), `plainLines`·`escapeHtml`, `codeLinesHtml`(`<div class="code-line" data-line="N">` 들을 글 하나로)
- `web/src/workspaceTree.ts` — 트리 순수 함수 (`workspaceTree.test.ts`): 폴더 받은 상태 `FolderState`(loading·error·ok), 펼친 폴더만 따라 화면 줄로 펴기 `treeRows`(기준 폴더는 늘 펼친 것), `ancestorFolders`·`joinPath`·`nameOf`

## 핵심 개념

- **모든 세션에 탭이 있다** (근무·휴식·퇴근·외부). 읽기만 해서 pty·claude 와 무관하다. 기준 폴더는 서버가 세션 목록과 같은 규칙으로 정한 cwd 다
- **세션별 기억**: 모듈 전역 Map(`sessionViews`)에 세션마다 받은 폴더 목록·펼친 폴더·고른 파일을 둔다 — 탭을 바꾸거나 다른 세션을 보고 와도 그대로이고(받은 목록을 먼저 보이고 열 때 다시 받는다), 페이지를 새로고침하면 사라진다. 폰에서 보기 칸을 띄웠는지(`isViewing`)는 기억하지 않아 다시 열면 트리부터다
- **줄은 React 요소가 아니라 innerHTML 한 번이다** — 몇 천 줄을 요소로 만들지 않으려고. 줄 번호는 `.code-line::before { content: attr(data-line) }`(sticky left, 패널 바탕)라 선택·복사에 끼지 않고 가로 스크롤해도 왼쪽에 붙어 있다. 번호 칸 폭은 줄 수 자릿수(`--gutter-digits` × 1ch). 측정(Vite dev·React 개발 빌드, headless 1400×900, 고르기 → 줄이 그려지고 두 번째 rAF, 받기 포함): App.tsx 1,962줄 약 220ms, style.css 5,104줄 약 250ms, package-lock.json 5,949줄 약 355ms. Node 에서 강조만: 84KB 54ms, 252KB 93ms, 420KB(9,810줄) 124ms. 1MB 가까운 파일의 화면 그리기는 재지 않았다
- **받은 파일에는 경로가 붙어 있다**(`FileState.path`). 지금 고른 것과 다르면 받는 중으로 본다 — 고른 직후 한 번 그릴 때 앞 파일 내용이 새 경로 아래 보이던 것을 막는다. ↻ 로 같은 파일을 다시 받는 동안은 앞 내용을 둔다
- **Ctrl+P(맥 Meta+P)는 Files 탭이 열려 있고 `.modal-overlay` 가 없을 때만** window keydown 에서 `preventDefault` 하고 빠른 찾기에 포커스(글 전체 선택)한다 — 브라우저 인쇄를 가로챈다 (CDP 키 입력으로 keydown 의 `defaultPrevented` true 까지 확인. 실제 OS 키로 인쇄 창이 안 뜨는지는 보지 않았다). 한글 자판에서도 되게 `code === 'KeyP'` 로도 본다. 다른 탭·세션 미선택·모달에서는 브라우저 그대로다 (컴포넌트가 마운트된 동안만 리스너가 있다)
- **함정: 트리 칸을 `<aside>` 로 만들지 않는다** — style.css 의 `aside` 규칙(왼쪽 목록용, 폰은 패널이 열리면 `aside` 를 숨긴다)이 걸려 폰에서 트리가 사라졌다
- 폰(768px 이하): 한 장씩 — 트리(위 막대는 찾기·↻) → 파일을 누르면 보기(위 막대는 ←·경로·↻, 찾기·크기 숨김) → ← 로 트리. 찾기 입력칸 16px(아이폰 확대 방지)·40px, 트리 줄·결과 줄 40px, 버튼 40×40. 폰 스타일은 style.css 끝 폰 블록에만

## 다음 단계 자리 (기능은 아직 없다)

- **2단계 줄 고르기·Add to chat**: `CodeView` 의 줄 요소 `.code-line[data-line]` 에 붙는다 (줄 번호로 선택 범위를 정한다). 버튼은 위 막대(↻ 옆)나 보기 칸 위에 둔다. 보낼 경로는 위 막대 경로 표시줄과 같은 기준 상대 경로
- **3단계 Changes**: 왼쪽 칸 `.ws-side` 위에 Files·Changes 전환이 들어가고(`FilesTab.tsx` 주석 자리) Changes 는 변경 파일 목록을 같은 칸에 그린다. 형상관리 판정은 서버 `vcs.ts`(팀 폴더 → git·SVN 루트)를 쓸 수 있다
- **4단계 편집**: `FileView` 가 글 파일일 때 `CodeView` 자리를 편집기로 바꾼다. 저장 요청에 읽을 때의 `hash`(sha1)를 실어 서버가 지금 파일과 다르면 거절하고, `encoding` 이 `utf-8-bom` 이면 BOM 을 붙여 쓰고 `euc-kr` 이면 편집을 막는다 (→ server-api.md `workspaceFiles.ts`)

## 확인하지 못한 것

- 화면은 Vite dev(4797) + headless Chrome + CDP 로만 봤다: 세션 목록·대화는 실행 중인 4710(GET 만, GET 아닌 요청은 0개), tree·file·file/raw·find 만 `Fetch.continueRequest` 로 시험 서버(4796)의 가짜 세션(이 저장소가 cwd)으로 돌렸다 — 그래서 휴식·퇴근 세션 화면의 경로 표시줄 기준 이름은 실제 세션 폴더 이름인데 내용은 이 저장소다. 본 것: 1400×900(사무실 보임, 520px 패널) 라이트·다크, 1920×1080 사무실 숨김(퇴근 세션, 탭 Chat·Files 만), 폰 390×844 라이트·다크(트리 → 파일 → ←), 폴더 펼치기, 빠른 찾기 결과·Enter·Esc 두 번(패널 유지), 찾기로 연 파일까지 트리 스크롤, 가로 스크롤 중 줄 번호 고정, 그림 보기, 탭을 바꿨다 돌아와 고른 파일 유지, 콘솔 오류 없음
- 빌드 결과·트레이 앱 창·실제 서버(트레이)·실제 폰 터치, 1MB 가까운 파일, EUC-KR 실제 소스 화면, 한글 조합 중 찾기 입력, 권한 없는 폴더의 실패 줄, 폴더 2,000개 넘는 잘림 줄은 보지 못했다
