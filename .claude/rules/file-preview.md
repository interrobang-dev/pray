---
paths:
  - "web/src/filePreview*.ts"
  - "web/src/FilesTab.tsx"
  - "server/src/workspaceFiles*.ts"
  - "server/src/scratchpad*.ts"
---

# Files 탭 파일 미리보기 (그림·SVG·HTML·PDF·동영상·소리)

세션 패널 Files 탭 오른쪽 `FileView` 가 글 코드 보기 대신 파일을 그 모양대로 보이는 것과, 그것이 받는 서버 raw 주소 두 꼴(`/file/raw?path=`·`/raw/<경로>`)을 다룬다. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

다른 파일에 있는 항목:
- Files 탭 전체(트리·위 막대·코드 보기·편집·Changes·Search·History) → workspace.md. md 문서 미리보기(`MarkdownDocument`)도 workspace.md
- 작업 폴더 API 공통 규칙(`workspaceRootOf`·`resolveWorkspaceRequest`·`isValidRequestPath`·`resolveWorkspacePath`·인증) → server-api.md
- 이 PC 의 Chrome 으로 열기 API(`POST …/open-in-chrome`, `openInChrome.ts`)·Host·Origin 검사 → security.md
- 작업 파일 창(scratchpad, `Files.tsx`)의 미리보기는 다른 기능이다 → chat.md

## 구조

- `web/src/filePreview.ts` — 확장자 → 미리보기 종류 `previewKindOf`(image·svg·html·pdf·video·audio. 서버 `contentTypeOf` 와 맞춘다)·원본 전환이 있는 종류 `hasSourceView`(svg·html)·글을 안 받는 종류 `isRawOnlyKind`·경로가 주소에 든 raw 주소 `rawPathUrl`(칸마다 `encodeURIComponent`, `/` 는 그대로) (`filePreview.test.ts`)
- `web/src/FilesTab.tsx` 의 `FileView`·위 막대 — 종류별로 그리기, 미리보기 ↔ 원본 전환, Open in Chrome 버튼 (아래 핵심 개념)
- `server/src/scratchpad.ts` — `contentTypeOf`(확장자 → Content-Type, 글꼴 woff·woff2·ttf·otf 포함)·`isPreviewType`(`image/*`·`video/*`·`audio/*`·`application/pdf`)·`isRawAssetType`(그것 + HTML·CSS·`font/*`)
- `server/src/workspaceFiles.ts` 의 `rawRequestPath` — `/raw/<경로>` 의 경로 칸(Express 가 칸마다 % 를 푼 배열) → 기준 상대 경로 (`workspaceFiles.test.ts`)
- `server/src/index.ts` 의 `GET /api/sessions/:id/file/raw?path=`·`GET /api/sessions/:id/raw/*path` (아래 "raw 주소")

## 핵심 개념

- **미리보기 종류** (`filePreview.ts`): 그림(png·jpg·jpeg·gif·webp·bmp·ico·avif)은 `<img>`(`.ws-image` 체크무늬). **SVG** 는 기본이 `<img>` 그림(안의 스크립트가 돌지 않는다. 서버도 CSP sandbox). **HTML**(html·htm)은 기본이 문서 미리보기(아래). **PDF** 는 `<iframe>`(Chrome 내장 뷰어, `.ws-frame`) — 폭 768px 이하·`(hover: none)`(`NO_PDF_FRAME_QUERY`. 안드로이드 Chrome·WebView 는 내장 뷰어가 없다)이면 "No PDF preview on phone". **동영상**(mp4·m4v·webm·ogv·mov)·**소리**(mp3·wav·ogg·oga·m4a·aac·flac·opus)는 `<video controls>`·`<audio controls>`(`.ws-media`, 칸 안에 비율대로, 소리는 폭 480px 까지), 탐색은 서버 Range(206). 그림·PDF·동영상·소리는 글을 받지 않아(`isRawOnlyKind`) 크기·시각은 트리 목록 값이고 연필·Ctrl+F 가 없다. 모두 ↻ 마다 `v=` 로 다시 받는다
- **미리보기 ↔ 원본 전환 (SVG·HTML)**: 위 막대의 md 와 같은 전환 버튼(`.ws-md-toggle`, 눈 "Show preview" ↔ 꺾쇠 "Show source")으로 원본(`CodeView` — 편집·Ctrl+F·줄 고르기)이 된다. 그래서 둘은 글도 받아 둔다. 원본 여부는 `sessionViews` 의 `sourceViews`(`{ svg, html }`, md 의 `isMarkdownSource` 와 따로)에 종류마다 남는다. 미리보기 중(`isRenderedPreview`)에는 md 미리보기처럼 줄이 없어 경로 표시줄 ":12"·Add to chat 줄이 없고 Ctrl+F 를 가로채지 않는다. 글로 못 받은 것(1MB 초과·NUL)은 원본을 보일 수 없어 늘 미리보기다. Search 결과 줄·대화 속 `경로:줄` 로 열면 원본으로 바꾼다
- **HTML 미리보기**: `<iframe class="ws-html-frame" sandbox="allow-same-origin">` 가 `rawPathUrl` 주소(`/api/sessions/<id>/raw/site/index.html?v=0`)를 연다. **sandbox 에는 `allow-same-origin` 하나만 — allow-scripts·allow-forms·allow-popups·allow-top-navigation 등은 넣지 않는다**. 스크립트가 돌면 로컬 접속은 무인증이라 문서가 `/api` 를 불러 세션 조작까지 된다. 서버도 이 주소의 HTML 에 `Content-Security-Policy: sandbox allow-same-origin` 을 붙여 주소를 새 탭으로 직접 열어도 스크립트가 돌지 않는다 (Chrome 콘솔 "Blocked script execution … 'allow-scripts' permission is not set"). **`allow-same-origin` 을 주는 이유**: 출처가 null(opaque)이면 메일 로그인한 다른 PC 에서 문서가 부르는 CSS·그림·글꼴 요청에 SameSite=Lax 쿠키 `jk_session` 이 안 붙어 401 이었다 (문서 요청 자체는 앱 화면이 연 iframe 이라 붙는다). 같은 출처여도 스크립트·폼·팝업·위 창 이동이 막혀 있어 문서가 할 수 있는 것은 `<img>`·`<link>` 같은 GET 뿐이고, GET 은 상태를 바꾸지 않는다 (→ security.md "CSRF 막기의 범위"). 문서 안 iframe·`<meta http-equiv=refresh>` 로 옮겨 간 문서도 같은 sandbox 를 물려받는다. 그래서 앱 쪽에서 `contentDocument` 를 읽을 수 있다 (시험·확인용). 작업 파일 창(`Files.tsx`·scratchpad raw)의 HTML 은 따로 `sandbox=""`·CSP `sandbox` 그대로다. 주소에 경로가 그대로 들어 있어 문서 안 상대 경로(`css/site.css`·`img/a.png`·`../logo.svg`·CSS 안 `url(../fonts/x.woff2)`)가 같은 꼴 주소로 풀려 불러와진다. `/` 로 시작하는 경로(`/style.css`)는 앱 주소 맨 위로 풀려 안 된다. 바탕은 다크에서도 흰색 `#fff`(HTML 은 흰 바탕을 전제 — 작업 파일 미리보기와 같은 테마 예외, → theme.md). 폴더 주소(`/raw/site/`)는 400 이라 `index.html` 을 저절로 찾지 않는다
- **Open in Chrome** (위 막대 `.ws-open-chrome`, 상자 밖 화살표 아이콘, title "Open in Chrome: <Windows 전체 경로>"): HTML 파일을 Files·Search 쪽에서 볼 때, **이 PC 화면(`isLocal`)에만** 있다 — 다른 PC·폰은 Show in folder 처럼 그리지 않는다. 대화 속 .html 링크와 같은 `openInChrome`(web `openPath.ts`) → `POST …/open-in-chrome` `{ path: <cwd 상대 경로> }`(서버 규칙 → security.md `openInChrome.ts`). 실패는 알림 창 "Couldn't open in Chrome: …". 스크립트까지 돌려 봐야 하는 문서는 이것으로 연다 (file:// 로 열려 이 앱과 무관하다)

### raw 주소

- **`GET /api/sessions/:id/file/raw?path=`** — Files 탭 그림·SVG·PDF·동영상·소리(`isPreviewType`). 그 밖 404 "No preview for this file type"
- **`GET /api/sessions/:id/raw/<경로>`** — HTML 미리보기용, 경로가 주소 칸에 그대로 든 꼴. 내주는 종류 `isRawAssetType` = HTML(CSP `sandbox allow-same-origin`)·CSS·글꼴(woff·woff2·ttf·otf)·미리보기 종류. **JS 는 내주지 않는다**(404): iframe 이 sandbox 라 어차피 돌지 않고, 내주면 다른 사이트가 `<script src="http://127.0.0.1:4710/api/…/raw/x.js">` 로 이 PC 의 소스를 끼워 실행할 길만 생긴다 (nosniff 라도 JS 형식이면 돈다). JSON·md·글 파일도 같은 이유로 404 — 문서가 부를 일이 없다. 거절 순서: 경로 칸 `rawRequestPath`(빈 칸 `//`·`.`·`..`·`\`·NUL·콜론 — Express 가 푼 `%2e%2e`·`%2F`·`%5C` 도 다시 나눠 본다) + `isValidRequestPath` 가 틀리면·세션 ID 꼴 400 → 기준 폴더 없음 404 "Session folder not found" → `resolveWorkspacePath`(realpath 가 기준 밖 — 링크·junction 포함)·종류 아님·파일 아님 404 "Not found". 종류는 realpath 의 확장자로 본다 (안쪽 링크 `a.html` → `b.js` 도 404). 기준 폴더·인증은 다른 작업 폴더 API 와 같다(GET 이라 Origin 은 안 본다)
- 두 꼴 모두 머리는 scratchpad raw 와 같다: `X-Content-Type-Options: nosniff`, SVG 는 `Content-Security-Policy: sandbox`(`/raw/<경로>` 의 HTML 만 `sandbox allow-same-origin`), `Cache-Control: no-cache, no-transform`(압축을 꺼 Range 206 이 깨지지 않게). **CORS 머리는 없다** — 문서가 앱과 같은 출처라 글꼴(`@font-face`, 늘 CORS 요청)도 같은 출처 요청이다 (출처가 null 이던 때는 글꼴에 `Access-Control-Allow-Origin: *` 가 필요했다)

## 확인하지 못한 것

- 다른 PC 의 HTML 미리보기는 시험 서버(`bind 0.0.0.0`·로그인 쿠키)를 LAN 주소로 연 headless 페이지에 같은 iframe 을 넣어서만 봤다: 문서·CSS·그림·`../logo.svg`·글꼴 모두 쿠키가 붙어 200, 글꼴 loaded, `<script>` 안 돎. 실제 다른 PC·Tailscale 기기의 화면은 보지 못했다 (다른 PC 가 필요해 남긴다)
- raw 주소는 단위 테스트와 시험 서버(임시 홈·가짜 pipe·4792, scratchpad 샘플 폴더의 휴식 세션)로만 확인했다: `/file/raw` 의 svg·pdf·mp4·mov·mp3·wav 200·글·없음·`../` 404·Range 206(바이트 같음, 압축 없음), `/raw/<경로>` 의 html·css·png·woff2·svg·pdf·mp4·한글·`#`·공백 이름 200, js·json·txt·폴더·없음·밖을 가리키는 junction 404, `..`·`%2e%2e`·`..%2F`·`..%5C`·`//`·`./`·`C:`·`%00` 400, HTML CSP `sandbox allow-same-origin`·SVG `sandbox`·CORS 머리 없음. 실행 중인 서버는 보지 못했다 (재시작 전이라 라우트가 없다)
- 미리보기 종류·HTML 화면은 시험 서버 + 시험 Vite 의 headless 데스크톱·S26 다크로만 봤다 (HTML: CSS·그림·글꼴·`../` 그림이 붙고 `<script>` 가 안 돎. raw 주소를 직접 열어도 안 돎). 실제 폰·안드로이드 WebView·트레이 창(Electron)의 PDF·HTML iframe, Open in Chrome 을 실제로 눌러 Chrome 이 뜨는 것(대화 .html 링크와 같은 API 라 404 경로로 상대 경로 꼴이 받아지는 것만 봤다), 진짜 QuickTime .mov(샘플은 H.264 mp4 를 이름만 바꾼 것 — H.264 가 아닌 mov 는 Chrome 이 못 틀 수 있다)·큰 영상 탐색, 라이트 테마는 보지 못했다
