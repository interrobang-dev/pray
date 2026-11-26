---
paths:
  - "android/**"
---

# 안드로이드 앱 (`android/`)

폰(S26)에서 Pray 를 앱으로 쓴다: 앱을 열면 네이티브 랜딩(Tailscale 상태·PC 카드)이 뜨고, 카드를 누르면 전체 화면 WebView 가 그 PC 의 Pray 웹을 그대로 띄우고, 포그라운드 서비스가 Tailscale 로 각 PC 의 알림 스트림(SSE)을 붙들어 안드로이드 알림을 띄운다. 설계 전문은 `docs/plans/2026-11-26-android-app-design.md`. 서버 쪽 스트림(`GET /api/notifications/stream`)은 `host.md` "알림 이벤트 스트림"·`server-api.md`. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

하지 않는 것: 공유하기(다른 앱 → 세션 첨부, 2단계) · 부팅 뒤 자동 시작(앱을 열면 서비스가 시작된다) · 스토어 배포·자동 업데이트 · 알림 판정(서버가 한다. 앱이 따로 판정하면 규칙이 두 벌이 된다) · 음성 입력(키보드 마이크로 된다).

## 구조

Kotlin 한 모듈 `app`, 패키지 `dev.interrobang.pray`, minSdk 29·targetSdk·compileSdk 35. 의존성은 `androidx.core`·`androidx.activity`·`androidx.swiperefreshlayout` 뿐 (HTTP·SSE 는 `HttpURLConnection`, JSON 은 안드로이드 내장 `org.json`).

- `Machines.kt` — (순수) `Machine`(name·url·hostName), 주소 정리(`normalizeAddress`: scheme 없으면 http, port 없으면 4710), `/api/machines` 해석, 저장 목록 합치기(`merge`), url → PC(`machineFor`), 링크를 앱 안에서 열지(`linkTarget`)
- `Sse.kt` — (순수) SSE 줄 해석(`SseParser`), notice data 해석(`Notices.parse`), 다시 붙는 간격(`reconnectDelayMs`)
- `NoticeText.kt` — (순수) 스트림 상태(`StreamState`), 채널, 알림 제목·누르면 열 주소·알림 ID, 상시 알림 글자
- `MachineStore.kt` — SharedPreferences `pray`(PC 목록·마지막에 본 PC·권한을 물었는지), `PrayHttp`(GET·WebView 쿠키 붙이기·`/api/machines` 받기·저장 목록 다시 받기·랜딩의 Pray 응답 확인 `probe`)
- `StreamWorker.kt` — PC 하나의 SSE 스레드: 붙기·읽기·끊기면 다시·`Last-Event-ID`
- `NotifyService.kt` — 포그라운드 서비스(specialUse): PC 마다 StreamWorker, 네트워크 콜백, 10분마다 목록 다시 받기, 알림 띄우기. `AppState.visibleMachineName`(앱이 앞에서 WebView 로 보고 있는 PC)·`AppState.streamStates`(PC 별 스트림 상태 사본, 랜딩이 읽는다)
- `PullRefresh.kt` — (순수) 당겨 새로고침을 막을지(`isBlocked`)·페이지에 넣는 touchstart 스크립트(`SCRIPT`)·브리지 이름 `PrayPull`
- `Landing.kt` — (순수) 랜딩 판정·글자: Pray 응답 해석·Tailscale 줄(`TailscaleBanner`)·카드 순서·작은 줄·상태 줄·뒤로 가기(`Screen`·`BackAction`)
- `LandingScreen.kt` — 랜딩 화면: 보이는 동안 PC 확인·네트워크 콜백·알림 상태 따라 다시 그리기·카드·Open Tailscale
- `MainActivity.kt` — 화면 셋(랜딩·주소 입력·웹) 오가기·뒤로 가기, WebView·당겨 새로고침·못 붙음 화면·첨부 고르기·권한 한 번 묻기·알림이 넘긴 주소 열기
- `res/layout/activity_main.xml` — `SwipeRefreshLayout`(`refresh`)로 감싼 WebView 위에 겹친 랜딩(`landing`, 역시 SwipeRefreshLayout)·주소 입력(`setup`)·못 붙음(`error`) 화면 · `landing_machine.xml` — PC 카드 하나 · `values/colors.xml`·`values-night/colors.xml` — 랜딩 색(`landing_*`, 라이트·다크) · `res/drawable/ic_launcher_*`·`ic_notification` — 로고 벡터 · `res/xml/network_security_config.xml` — cleartext 전부 허용

## 핵심 개념

- **PC 목록**: 첫 실행에 주소 하나(예 `http://2-office:4710`)를 넣으면 그 PC 의 `GET /api/machines` 로 `hasPray` 이고 url 이 있는 PC 를 저장한다 (넣은 짧은 주소는 그 PC 의 `isSelf` url, MagicDNS 전체 이름으로 바뀐다). 앱을 열 때(1분 안에 받았으면 건너뜀)·서비스가 10분마다 마지막에 본 PC 부터 차례로 물어 처음 답한 목록으로 고친다. **한 번 Pray 를 찾았던 PC 는 Tailscale 목록에 있는 한 남긴다** — Pray 확인이 1.5초 제한이라 한 번 못 찾았다고 빼면 알림·앱 안 열기가 들쭉날쭉해서다. 받은 목록이 비면(Tailscale 꺼짐) 그대로 둔다. 이름순. 401(같은 Tailscale 계정이 아님)이면 넣은 주소 하나로 열어 웹 로그인 화면을 따른다
- **링크 판정**: 저장한 PC(host·port 가 같거나 짧은 이름 `2-office` ↔ `2-office.xxx.ts.net`)는 WebView 안 — 웹의 PC 칩(`window.location.assign`)이 그대로 된다. 그 밖 http(s)(claude.ai 등)·mailto·intent 는 `ACTION_VIEW` 로 폰 브라우저·다른 앱. blob·data·about·javascript 는 앱 안. 새 창(`target=_blank`·`window.open`)은 여러 창을 끈 기본값이라 같은 판정을 거친다. `loadUrl` 은 이 판정을 거치지 않는다 (알림이 넘긴 주소)
- **마지막에 본 PC**: WebView 가 옮겨 간 주소가 저장한 PC 면(`onPageStarted`·`doUpdateVisitedHistory`) 그 PC 를 지금 PC·마지막 PC 로 둔다. 랜딩 카드에 "Last opened" 칩으로만 보인다 (다시 열어도 그 PC 로 바로 가지 않는다). 목록을 다시 받을 때 처음 물을 PC 이기도 하다
- **랜딩** (사용자 결정: 앱을 새로 열면 늘 랜딩): `onCreate` 에서 랜딩. 예외 둘 — 알림이 넘긴 주소(`EXTRA_URL`)는 랜딩을 건너뛰고 그 세션으로, 시스템이 뒤에서 Activity 를 지웠다 되살리면(`savedInstanceState` 의 웹 주소) 보던 웹으로. 뒤에서 앞으로 돌아오기(`onNewIntent`·런처로 살아 있는 태스크 열기·상시 알림 누르기)는 보던 화면 그대로. **Tailscale 줄**: 기본 네트워크가 VPN 이거나 VPN 네트워크가 하나라도 있으면 켜짐(`TRANSPORT_VPN`. Tailscale 이 tailnet 주소만 받아 기본 네트워크가 VPN 이 아닐 수 있어 둘 다 본다). 다른 VPN 과 구분할 수 없어 PC 응답과 같이 본다: 꺼짐 "Tailscale is off" / 켜졌는데 확인한 PC 가 모두 답하지 않음 "Connected, but no PC answers" / 그 밖 "Tailscale connected". 앞의 둘은 [Open Tailscale](`com.tailscale.ipn` 실행. 없으면 [Get Tailscale] → Play 스토어, manifest `<queries>` 필요). **PC 카드**: 저장 목록을 이름순(대소문자 무시, 웹 PC 메뉴와 같다), 이름 굵게·OS 이름(없거나 이름과 같으면 host:port) 작게·"● Pray answers / ○ No answer / ○ Checking…" · 알림 스트림 상태(Connected·not connected·update Pray·sign in). **확인**: 보일 때마다(`onResume`·랜딩으로 올 때)·당기기·↻·기본 네트워크나 VPN 이 바뀔 때(신호 세기 같은 capability 변화는 넘긴다) 모든 PC 에 `GET <url>/api/auth/me`(연결·읽기 각 1.5초, JSON `app === 'pray'`)를 동시에 묻는다. DNS 찾기는 제한에 안 들어 2초가 지나도 못 들은 PC 는 No answer 로 두고, 늦게 답하면 고친다. 같은 때 `PrayHttp.refreshMachines` 로 목록을 다시 받아, 바뀌면 서비스에 알리고 새 PC 만 묻는다. 확인 회차(generation)가 바뀌면 옛 답은 버린다. 응답 없는 PC 카드도 누를 수 있다 (못 붙으면 "Can't reach"). **Add PC** = 주소 입력 화면 (첫 실행도 랜딩 + 빈 목록 안내 + Add PC). Add PC 로 넣으면 있던 PC 도 아는 PC 로 넘겨 남기고(401 이면 그 PC 하나를 더한다), 그 PC 를 바로 연다. 목록에서 빼기는 없다. **뒤로**: 웹은 기록이 있으면 뒤로, 없거나 못 붙음 화면이면 랜딩, 주소 입력도 랜딩, 랜딩에서 앱 닫기. **뒤로 길게 누르기**(버튼 내비게이션)는 어느 화면(웹·주소 입력·못 붙음)이든 바로 랜딩(`Landing.longBack`), 랜딩에서는 아무것도 안 한다(앱을 닫지 않는다). 뒤로 키는 `dispatchKeyEvent` 에서 화면(WebView 포함)을 거치지 않고 `event.dispatch(this, decorView.keyDispatcherState, this)` 로 Activity 의 `onKeyDown`(`startTracking`)·`onKeyLongPress`·`onKeyUp` 에 바로 보낸다 — WebView 에 포커스가 있을 때 키가 Activity 까지 오는지 확신할 수 없어서다. 길게 누르기를 처리하면(랜딩에서도 true) 손을 뗄 때의 UP 이 `isCanceled` 로 와 짧은 뒤로가 다시 돌지 않고, `onKeyUp` 은 `isTracking && !isCanceled` 일 때만 짧은 뒤로(`onBackPressedDispatcher`)를 부른다. manifest 에 `enableOnBackInvokedCallback` 이 없어야 키 이벤트로 온다. 한계: 키보드가 열려 있으면 뒤로 키를 키보드(IME)가 먼저 먹어 닫기만 한다. 제스처 내비게이션(S26 스와이프)은 뒤로를 손 뗄 때 DOWN·UP 한 번에 보내 길게 누르기가 없어 쓸 수 없다 (대안은 앱 안 버튼 같은 따로 만든 길뿐, 만들지 않았다). 랜딩으로 나가면 WebView 를 `about:blank` 로 멈추고(뒤에서 SSE·폴링을 붙들지 않게), PC 를 열면 그 페이지가 끝날 때 기록을 지운다(뒤로가 전에 본 PC·about:blank 로 가지 않게). 웹에서 랜딩으로 가는 길은 뒤로 가기뿐이다 (다른 PC 로는 웹의 PC 칩이 있다). 랜딩만 라이트·다크를 따르고 주소 입력·못 붙음 화면은 전처럼 어두운 색이다
- **못 붙음**: 주 프레임 `onReceivedError` 면 WebView 위에 "Can't reach <name>" + 오류 글 + [Retry] + 다른 PC 버튼들 + "Use another address"(주소 입력 화면). 다음 페이지가 오류 없이 끝나면 숨긴다. HTTP 오류 응답(403 등)은 웹 페이지로 그대로 보인다
- **알림 스트림**: `GET <pc>/api/notifications/stream`, 이벤트 `id: <정수>` / `event: notice` / `data: {"id","kind","sessionId","title","body","place":{"team","part"}|null,"at"}`, 15초마다 `: ping`. 읽기 제한 45초(ping 이 3번 안 오면 죽은 연결). 다시 붙을 때 `Last-Event-ID`(메모리에만 — 서비스가 다시 뜨면 처음부터, 서버도 10분만 둔다). 끊기면 2초에서 두 배씩 60초까지(한 줄이라도 받으면 다시 2초부터), 기본 네트워크가 바뀌면(등록 직후 첫 콜백은 빼고) 붙어 있던 것도 끊고 바로. 앱을 열면(`ACTION_RELOAD`) 기다리던 PC 를 바로 다시 본다
- **옛 서버 판정 함정**: 스트림이 없는 옛 Pray 는 모르는 `/api/...` GET 에 404 가 아니라 **웹 index.html 을 200 text/html 로 준다** (실측, 이 PC 4710). 그래서 404 **또는 200 인데 Content-Type 이 `text/event-stream` 이 아니면** OUTDATED 로 보고 10분 뒤 다시 본다 — 안 그러면 "연결됨" 으로 보이며 2초마다 다시 붙는다. 401 은 UNAUTHORIZED 로 그 PC 알림을 끄고 10분 뒤(또는 앱을 열 때) 다시 본다
- **쿠키**: 스트림·`/api/machines` 요청에 WebView 의 쿠키(`CookieManager`, 메일 로그인 `jk_session`)를 붙인다. 같은 Tailscale 계정 기기는 쿠키 없이 열린다(→ `security.md`). 웹에서 로그인하면 다음 시도부터 붙는다
- **상시 알림**(채널 Connection, 낮음·소리 없음): 제목 "Connected · 1-home, 2-office"(붙은 PC 이름순, 없으면 "Not connected"), 본문 PC 별 문제 "2-office: update Pray"(OUTDATED)·"2-office: sign in"(UNAUTHORIZED). 누르면 앱
- **알림**: 채널 Needs approval(높음)·Done / My turn(보통)·Hand over(높음)·Reminders(높음), 모르는 kind 는 Done / My turn. 제목 "2-office · <서버 title>", 본문 body. 같은 PC·같은 세션은 알림 한 칸을 바꿔 쓴다(승인 대기 뒤 Done 이 오면 Done 만), 세션 없는 것(reminder)은 알림마다. 누르면 `<pc url>/#session=<id>`(없으면 그 PC 첫 화면)를 앱 안 WebView 로 연다 — 같은 PC 면 해시만 바뀌어 웹의 hashchange 가 패널을 연다 (`web/src/sessionLink.ts`). **앱이 앞에서 같은 PC 를 WebView 로 보고 있으면 띄우지 않는다** (`AppState.visibleMachineName`, onResume·onPause·이동·화면 바꿀 때 고친다. 랜딩·주소 입력 화면이면 null). 끈 종류는 서버가 이미 빼고 보낸다
- **권한**: 첫 페이지를 열 때 한 번만 알림 권한(API 33+) → 그 답 뒤 배터리 최적화 제외 요청(삼성은 제외하지 않으면 서비스를 끈다). 거절해도 다시 묻지 않는다 (폰 설정에서 바꾼다)
- **당겨 새로고침**: WebView 를 `SwipeRefreshLayout` 으로 감싸 당기면 `web.reload()`, `onPageFinished`·주 프레임 `onReceivedError` 에서 스피너를 멈춘다 (색 `logo_accent`, 바탕 `logo_background`). **함정: Pray 웹은 document 가 아니라 안쪽 요소(목록·대화·xterm `.xterm-viewport`·모달 본문)가 스크롤돼 `WebView.canScrollVertically(-1)` 이 늘 false** — 그대로면 대화 중간에서 아래로 당겨도 새로고침된다. 그래서 저장한 PC 페이지가 끝날 때마다(`onPageFinished`) `PullRefresh.SCRIPT` 를 넣는다(같은 문서엔 한 번): touchstart(capture·passive)에서 손가락 둘 이상·`.modal-overlay`(확인 창 `.dialog-overlay`·팔레트 포함, 창 안 글이 날아가지 않게)·document 가 내려감·터치 대상부터 위로 overflow-y auto/scroll/overlay 이고 `scrollTop > 0` 인 조상·`touch-action: none` 인 요소(목록 ⠿ 끌기 손잡이 — 맨 위 목록에서 아래로 끌면 새로고침됐다) 중 하나라도 있으면 막는다고 `PrayPull.report(boolean)` 로 알린다. `setOnChildScrollUpCallback` 이 그 값을 쓴다. **손짓 맞추기**: `dispatchTouchEvent` 의 ACTION_DOWN 에서 지난 값을 지우고(null = 아직 안 옴 → 막음), DOWN 을 넘기는 동안만은 막지 않는다 — SwipeRefreshLayout 은 DOWN 때 막히면 시작 위치를 안 잡아 그 손짓 전체가 안 된다. 당기기는 MOVE 에서 시작하므로 JS 답이 늦으면 몇 MOVE 늦게 시작할 뿐이다. 스크립트가 없는 페이지(다른 출처·스크립트 실패)는 답이 안 와 당기기가 안 된다. 브리지는 boolean 하나로 당기기를 막을지만 바꿔 다른 출처 frame 이 불러도 해가 없다. 웹 코드(`web/`)에는 이 기능이 없다 — 웹의 스크롤 class 를 바꿔도 조상 계산이라 영향이 없지만 `.modal-overlay` 이름을 바꾸면 창 위 당기기 막기가 빠진다
- **화면 칸**: targetSdk 35 는 화면이 상태 표시줄·내비 막대 밑까지 그려져서 root 에 그 높이와 키보드 높이만큼 안쪽 여백을 준다 — 웹의 `100dvh` 가 남는 칸이 된다. 테마가 DayNight 라 웹의 `prefers-color-scheme` 이 폰 다크 모드를 따른다. `configChanges` 로 회전·다크 모드 전환 때 Activity 를 다시 만들지 않는다(WebView 를 다시 불러오지 않게)
- **첨부**: `onShowFileChooser` → 웹 `accept` 대로의 파일 고르기 + 카메라(`ACTION_IMAGE_CAPTURE`, cache `camera/` 의 FileProvider `<패키지>.files` 파일). CAMERA 권한은 선언하지 않는다 (선언하면 받기 전에 카메라 앱 호출이 막힌다)
- **화면 글자는 영어** (루트 규칙과 같다). 디버그 빌드는 WebView 원격 디버깅이 켜진다 (USB 로 PC Chrome `chrome://inspect`)

## 빌드·설치

- JDK 21 `C:\Programs\jdk-21.0.7`(`JAVA_HOME`). Android SDK 명령줄 도구 `%LOCALAPPDATA%\Android\Sdk` (platform-tools·platforms;android-35·build-tools;35.0.0). `android/local.properties` 의 `sdk.dir` (gitignore, 이 PC 경로. properties 꼴이라 `C\:\\Users\\…` 로 이스케이프 — 안 하면 lint 오류)
- Gradle 8.14 wrapper(저장소에 jar·properties 있음) · AGP 8.10.1 · Kotlin 2.1.21
- `npm run android` (= `android\gradlew.bat -p android assembleDebug`. npm 스크립트 셸이 cmd 라 `/`·현재 폴더 실행이 안 되어 이 꼴) → `android/app/build/outputs/apk/debug/app-debug.apk`
- 테스트: `android\gradlew.bat -p android testDebugUnitTest` (루트 `npm test` 에는 없다). lint: `lintDebug`
- **서명은 이 PC 의 debug 키**(`~/.android/debug.keystore`, AGP 가 처음 빌드 때 만든다. 저장소에 넣지 않는다). 다른 PC 에서 빌드하면 키가 달라 덮어 설치가 안 되므로 **이 PC 에서만 빌드한다**
- 설치·업데이트: `tailscale file cp <apk> 3-mobile:`(Taildrop, 실행 전 매번 승인) → 폰에서 받은 파일을 눌러 설치. 덮어 설치하려면 `app/build.gradle.kts` 의 `versionCode` 를 올린다. 자동 업데이트 없음
- 화면·알림은 에뮬레이터 없이 사용자가 실제 폰에서 본다

## 함정 (빌드·테스트)

- `java.net.URI` 는 `2-office` 처럼 숫자로 시작하는 한 칸 이름의 host 를 null 로 줘서 주소 해석은 정규식으로 한다
- 단위 테스트의 android.jar 는 `org.json` 이 빈 껍데기라 `testImplementation("org.json:json")` 으로 진짜를 둔다. 컴파일 클래스패스도 android.jar 라 JDK `com.sun.net.httpserver` 가 안 보여 `StreamWorkerTest` 는 `ServerSocket` 으로 가짜 서버를 만든다. `CookieManager` 는 테스트에서 던지는데 `PrayHttp` 가 잡는다

## 확인하지 못한 것

- 실제 폰(S26) 전부: 랜딩(앱을 새로 열면 뜨는지·뒤에서 돌아오면 보던 웹 그대로인지·알림을 누르면 건너뛰는지, Tailscale 껐다 켜면 줄이 바뀌는지·VPN 이 기본 네트워크로 잡히는지, Open Tailscale·Get Tailscale, 카드 점·알림 상태 글자, 라이트·다크 색, 뒤로 가기 웹 → 랜딩 → 닫기, Add PC 로 넣은 뒤 목록), 당겨 새로고침(맨 위 목록에서 되는지·대화·목록·터미널 중간에서 안 되는지·창이 떠 있을 때 안 되는지·스피너가 멈추는지·JS 답이 늦어 당김이 굼뜨지 않은지), 설치, 아이콘 모양(adaptive·테마 아이콘), 주소 입력 → PC 목록, WebView 화면(상태 표시줄·키보드 여백·100dvh), PC 칩으로 옮겨 가기, claude.ai 링크가 브라우저로 가는지, 첨부(사진·카메라), 뒤로 가기, 못 붙음 화면
- 뒤로 길게 누르기: 이 기능을 만든 PC 에 JDK 21·Android SDK 가 없어 debug 빌드·단위 테스트(`LandingTest` 의 `longBack`)를 돌리지 못했다 (컴파일도 확인하지 못함). 실제 폰에서 길게 누르기가 오는지(삼성 내비 막대 뒤로 버튼이 `FLAG_LONG_PRESS` 를 보내는지 포함)·손 뗀 뒤 짧은 뒤로가 안 도는지·랜딩에서 앱이 안 닫히는지·짧은 뒤로가 그대로인지도 확인하지 못했다
- 실제 서버 스트림에 붙기: 이 앱을 만들 때 서버 스트림이 아직 없어 가짜 서버(`StreamWorkerTest`)와 옛 서버(HTML 200 → OUTDATED)만 확인했다. 실제 이벤트 꼴·`Last-Event-ID`·ping 은 서버가 올라간 뒤 확인
- 알림: 권한 묻기·배터리 최적화 요청 창, 채널 소리, 상시 알림 글자, 누르면 그 세션이 열리는지, 같은 PC 를 보고 있을 때 숨는지
- 오래 두기: 삼성 배터리 관리·Doze 에서 서비스가 살아 있는지, 화면이 꺼진 동안 SSE 로 알림이 바로 오는지, 와이파이 ↔ LTE 전환 뒤 다시 붙는지, 시스템이 서비스를 죽였다 `START_STICKY` 로 되살릴 때 뒤에서 포그라운드 시작이 허용되는지
- WebView 가 폰 다크 모드 전환을 Activity 재생성 없이 따라가는지 (`configChanges` 에 uiMode)
- 웹의 파일 내려받기(있다면) — 다운로드 처리를 넣지 않았다
