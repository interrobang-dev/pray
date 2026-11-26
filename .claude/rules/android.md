---
paths:
  - "android/**"
---

# 안드로이드 앱 (`android/`)

폰(S26)에서 Pray 를 앱으로 쓴다: 전체 화면 WebView 가 지금 Pray 웹을 그대로 띄우고, 포그라운드 서비스가 Tailscale 로 각 PC 의 알림 스트림(SSE)을 붙들어 안드로이드 알림을 띄운다. 설계 전문은 `docs/plans/2026-11-26-android-app-design.md`. 서버 쪽 스트림(`GET /api/notifications/stream`)은 `host.md` "알림 이벤트 스트림"·`server-api.md`. 이 영역을 고치면 이 파일의 그 줄을 고쳐 쓴다.

하지 않는 것: 공유하기(다른 앱 → 세션 첨부, 2단계) · 부팅 뒤 자동 시작(앱을 열면 서비스가 시작된다) · 스토어 배포·자동 업데이트 · 알림 판정(서버가 한다. 앱이 따로 판정하면 규칙이 두 벌이 된다) · 음성 입력(키보드 마이크로 된다).

## 구조

Kotlin 한 모듈 `app`, 패키지 `dev.interrobang.pray`, minSdk 29·targetSdk·compileSdk 35. 의존성은 `androidx.core`·`androidx.activity` 뿐 (HTTP·SSE 는 `HttpURLConnection`, JSON 은 안드로이드 내장 `org.json`).

- `Machines.kt` — (순수) `Machine`(name·url), 주소 정리(`normalizeAddress`: scheme 없으면 http, port 없으면 4710), `/api/machines` 해석, 저장 목록 합치기(`merge`), url → PC(`machineFor`), 링크를 앱 안에서 열지(`linkTarget`)
- `Sse.kt` — (순수) SSE 줄 해석(`SseParser`), notice data 해석(`Notices.parse`), 다시 붙는 간격(`reconnectDelayMs`)
- `NoticeText.kt` — (순수) 스트림 상태(`StreamState`), 채널, 알림 제목·누르면 열 주소·알림 ID, 상시 알림 글자
- `MachineStore.kt` — SharedPreferences `pray`(PC 목록·마지막에 본 PC·권한을 물었는지), `PrayHttp`(GET·WebView 쿠키 붙이기·`/api/machines` 받기·저장 목록 다시 받기)
- `StreamWorker.kt` — PC 하나의 SSE 스레드: 붙기·읽기·끊기면 다시·`Last-Event-ID`
- `NotifyService.kt` — 포그라운드 서비스(specialUse): PC 마다 StreamWorker, 네트워크 콜백, 10분마다 목록 다시 받기, 알림 띄우기. `AppState.visibleMachineName`(앱이 앞에서 보고 있는 PC)
- `MainActivity.kt` — WebView·첫 실행 주소 입력·못 붙음 화면·첨부 고르기·권한 한 번 묻기·알림이 넘긴 주소 열기
- `res/layout/activity_main.xml` — WebView 위에 겹친 주소 입력(`setup`)·못 붙음(`error`) 화면 · `res/drawable/ic_launcher_*`·`ic_notification` — 로고 벡터 · `res/xml/network_security_config.xml` — cleartext 전부 허용

## 핵심 개념

- **PC 목록**: 첫 실행에 주소 하나(예 `http://2-office:4710`)를 넣으면 그 PC 의 `GET /api/machines` 로 `hasPray` 이고 url 이 있는 PC 를 저장한다 (넣은 짧은 주소는 그 PC 의 `isSelf` url, MagicDNS 전체 이름으로 바뀐다). 앱을 열 때(1분 안에 받았으면 건너뜀)·서비스가 10분마다 마지막에 본 PC 부터 차례로 물어 처음 답한 목록으로 고친다. **한 번 Pray 를 찾았던 PC 는 Tailscale 목록에 있는 한 남긴다** — Pray 확인이 1.5초 제한이라 한 번 못 찾았다고 빼면 알림·앱 안 열기가 들쭉날쭉해서다. 받은 목록이 비면(Tailscale 꺼짐) 그대로 둔다. 이름순. 401(같은 Tailscale 계정이 아님)이면 넣은 주소 하나로 열어 웹 로그인 화면을 따른다
- **링크 판정**: 저장한 PC(host·port 가 같거나 짧은 이름 `2-office` ↔ `2-office.xxx.ts.net`)는 WebView 안 — 웹의 PC 칩(`window.location.assign`)이 그대로 된다. 그 밖 http(s)(claude.ai 등)·mailto·intent 는 `ACTION_VIEW` 로 폰 브라우저·다른 앱. blob·data·about·javascript 는 앱 안. 새 창(`target=_blank`·`window.open`)은 여러 창을 끈 기본값이라 같은 판정을 거친다. `loadUrl` 은 이 판정을 거치지 않는다 (알림이 넘긴 주소)
- **마지막에 본 PC**: WebView 가 옮겨 간 주소가 저장한 PC 면(`onPageStarted`·`doUpdateVisitedHistory`) 그 PC 를 지금 PC·마지막 PC 로 둔다. 다시 열면 그 PC
- **못 붙음**: 주 프레임 `onReceivedError` 면 WebView 위에 "Can't reach <name>" + 오류 글 + [Retry] + 다른 PC 버튼들 + "Use another address"(주소 입력 화면). 다음 페이지가 오류 없이 끝나면 숨긴다. HTTP 오류 응답(403 등)은 웹 페이지로 그대로 보인다
- **알림 스트림**: `GET <pc>/api/notifications/stream`, 이벤트 `id: <정수>` / `event: notice` / `data: {"id","kind","sessionId","title","body","place":{"team","part"}|null,"at"}`, 15초마다 `: ping`. 읽기 제한 45초(ping 이 3번 안 오면 죽은 연결). 다시 붙을 때 `Last-Event-ID`(메모리에만 — 서비스가 다시 뜨면 처음부터, 서버도 10분만 둔다). 끊기면 2초에서 두 배씩 60초까지(한 줄이라도 받으면 다시 2초부터), 기본 네트워크가 바뀌면(등록 직후 첫 콜백은 빼고) 붙어 있던 것도 끊고 바로. 앱을 열면(`ACTION_RELOAD`) 기다리던 PC 를 바로 다시 본다
- **옛 서버 판정 함정**: 스트림이 없는 옛 Pray 는 모르는 `/api/...` GET 에 404 가 아니라 **웹 index.html 을 200 text/html 로 준다** (실측, 이 PC 4710). 그래서 404 **또는 200 인데 Content-Type 이 `text/event-stream` 이 아니면** OUTDATED 로 보고 10분 뒤 다시 본다 — 안 그러면 "연결됨" 으로 보이며 2초마다 다시 붙는다. 401 은 UNAUTHORIZED 로 그 PC 알림을 끄고 10분 뒤(또는 앱을 열 때) 다시 본다
- **쿠키**: 스트림·`/api/machines` 요청에 WebView 의 쿠키(`CookieManager`, 메일 로그인 `jk_session`)를 붙인다. 같은 Tailscale 계정 기기는 쿠키 없이 열린다(→ `security.md`). 웹에서 로그인하면 다음 시도부터 붙는다
- **상시 알림**(채널 Connection, 낮음·소리 없음): 제목 "Connected · 1-home, 2-office"(붙은 PC 이름순, 없으면 "Not connected"), 본문 PC 별 문제 "2-office: update Pray"(OUTDATED)·"2-office: sign in"(UNAUTHORIZED). 누르면 앱
- **알림**: 채널 Needs approval(높음)·Done / My turn(보통)·Hand over(높음)·Reminders(높음), 모르는 kind 는 Done / My turn. 제목 "2-office · <서버 title>", 본문 body. 같은 PC·같은 세션은 알림 한 칸을 바꿔 쓴다(승인 대기 뒤 Done 이 오면 Done 만), 세션 없는 것(reminder)은 알림마다. 누르면 `<pc url>/#session=<id>`(없으면 그 PC 첫 화면)를 앱 안 WebView 로 연다 — 같은 PC 면 해시만 바뀌어 웹의 hashchange 가 패널을 연다 (`web/src/sessionLink.ts`). **앱이 앞에 있고 같은 PC 를 보고 있으면 띄우지 않는다** (`AppState.visibleMachineName`, onResume·onPause·이동 때 고친다). 끈 종류는 서버가 이미 빼고 보낸다
- **권한**: 첫 페이지를 열 때 한 번만 알림 권한(API 33+) → 그 답 뒤 배터리 최적화 제외 요청(삼성은 제외하지 않으면 서비스를 끈다). 거절해도 다시 묻지 않는다 (폰 설정에서 바꾼다)
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

- 실제 폰(S26) 전부: 설치, 아이콘 모양(adaptive·테마 아이콘), 주소 입력 → PC 목록, WebView 화면(상태 표시줄·키보드 여백·100dvh), PC 칩으로 옮겨 가기, claude.ai 링크가 브라우저로 가는지, 첨부(사진·카메라), 뒤로 가기, 못 붙음 화면
- 실제 서버 스트림에 붙기: 이 앱을 만들 때 서버 스트림이 아직 없어 가짜 서버(`StreamWorkerTest`)와 옛 서버(HTML 200 → OUTDATED)만 확인했다. 실제 이벤트 꼴·`Last-Event-ID`·ping 은 서버가 올라간 뒤 확인
- 알림: 권한 묻기·배터리 최적화 요청 창, 채널 소리, 상시 알림 글자, 누르면 그 세션이 열리는지, 같은 PC 를 보고 있을 때 숨는지
- 오래 두기: 삼성 배터리 관리·Doze 에서 서비스가 살아 있는지, 화면이 꺼진 동안 SSE 로 알림이 바로 오는지, 와이파이 ↔ LTE 전환 뒤 다시 붙는지, 시스템이 서비스를 죽였다 `START_STICKY` 로 되살릴 때 뒤에서 포그라운드 시작이 허용되는지
- WebView 가 폰 다크 모드 전환을 Activity 재생성 없이 따라가는지 (`configChanges` 에 uiMode)
- 웹의 파일 내려받기(있다면) — 다운로드 처리를 넣지 않았다
