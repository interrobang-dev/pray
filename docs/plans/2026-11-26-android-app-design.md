# Pray 안드로이드 앱 설계

폰(S26)에서 Pray 를 브라우저 대신 앱으로 쓴다. 얻으려는 것: 푸시 알림, 앱처럼 실행(홈 화면·주소창 없음), PC 고르기, 폰 전용 기능.

## 방식

**네이티브 껍데기 + 지금 웹 화면.** Kotlin 앱의 WebView 가 지금 Pray 웹을 그대로 띄우고, 알림은 앱의 포그라운드 서비스가 Tailscale 로 각 PC 의 Pray 에 SSE 를 붙여 받는다.

고르지 않은 것:
- PWA + Web Push — HTTPS(`tailscale serve`)가 필요하고, PC 마다 origin 이 달라 PC 마다 앱이 따로 깔려 PC 고르기와 맞지 않는다. 공유하기도 제한된다
- FCM(Firebase) 푸시 — 상시 연결·상시 알림이 없어지지만 Firebase 프로젝트·키·서버의 외부 전송이 개인 도구에 과하다. 배터리가 실제로 문제가 되면 다시 본다

인증은 같은 Tailscale 계정 기기 무인증(`4f5dc81`, → `.claude/rules/security.md`)으로 로그인 없이 붙는다.

## 서버: 알림 이벤트 스트림

알림 판정을 서버로 옮긴다. 앱이 Kotlin 으로 따로 판정하면 규칙이 두 벌이 되어 어긋난다.

- `desktop/src/notify.ts` 의 판정 순수 함수(`diffSessions`·`noticeTitle`·`noticeBody` 와 이름·역할 규칙)를 `host/src/sessionNotice.ts`(`@pray/host/sessionNotice`)로 옮겨 서버가 쓴다. 규칙은 트레이와 같다: 팀원 아닌 세션의 working·waiting → done·my-turn, 새 needs-approval(모든 세션), 리드 문맥 15만 새로 넘음 → hand-over. 트레이는 지금 사본을 그대로 둔다 (desktop 은 CommonJS 빌드라 사본 관례가 있다. 트레이를 스트림으로 옮기는 것은 나중)
- **`GET /api/notifications/stream`** (SSE): 구독자가 있을 때만 서버가 3초마다 세션 목록을 만들어 직전 기준과 비교하고 새 알림을 보낸다. 이벤트 `{ id, kind, sessionId, title, body, place, at }` — kind 는 done·my-turn·needs-approval·hand-over·reminder(알림이 울릴 때), place 는 팀·파트 이름
- 알림 설정(`notifications.json`, 설정 창 Notifications 탭)에서 끈 종류는 서버가 빼고 보낸다 — 트레이와 폰이 같은 설정을 따른다
- 놓친 것 다시 받기: 최근 이벤트 50개를 10분까지 메모리에 두고 `Last-Event-ID` 뒤 것을 준다. 서버 재시작·10분 지난 것은 버린다 (오래 끊겼다 붙을 때 쏟아지지 않게)
- 15초마다 keep-alive. 인증은 다른 `/api` 와 같다

## 안드로이드 앱 (`android/`)

- Kotlin 한 모듈, minSdk 29·targetSdk 35, 패키지 `dev.interrobang.pray`, 이름 Pray, 아이콘은 지금 로고(U-2). cleartext 허용 (주소가 Tailscale 이름·IP 라 도메인별로 못 나눈다)
- **MainActivity**: 전체 화면 WebView. JS·localStorage 켬. 저장한 PC 목록의 주소는 WebView 안에서(웹의 PC 칩 이동이 그대로 된다), 그 밖(claude.ai 등)은 폰 브라우저로. 첨부는 `onShowFileChooser`(사진·카메라). 뒤로 가기 = WebView 기록, 없으면 닫기. 못 붙으면 "Can't reach 2-office" + [Retry] + 다른 PC 목록
- **PC 목록**: 처음 한 번 PC 주소 하나를 넣으면 그 PC 의 `/api/machines` 로 나머지를 찾아 저장. 앱을 열 때·10분마다 다시 받는다. 다시 열면 마지막에 보던 PC
- **NotifyService**: 포그라운드 서비스(type `specialUse`, 스토어에 올리지 않는다). `hasPray` PC 마다 SSE 하나. 끊기면 2초→60초 간격을 늘려 다시, 네트워크가 돌아오면 바로. 상시 알림 "Connected · 1-home, 2-office"(소리 없는 낮은 채널)
  - 채널: Needs approval(높음)·Done·My turn(보통)·Hand over·Reminders(높음). 소리·진동은 안드로이드 설정에서
  - 머리에 PC 이름: `2-office · [FE] Sujin · Done`. 누르면 그 PC 의 `#session=<id>` 를 앱에서 연다 (웹이 이미 처리)
  - 앱이 앞에 있고 같은 PC 를 보고 있으면 띄우지 않는다 (화면 배지로 보인다)
  - 처음 켤 때 알림 권한과 배터리 최적화 제외를 한 번 요청 (삼성은 제외하지 않으면 서비스를 끈다)
- 오류: 스트림 404(옛 서버)면 그 PC 는 화면만 쓰고 상시 알림에 "2-office: update Pray". 401 이면 그 PC 알림을 끄고 웹 로그인 화면을 따른다

## 단계

1. 서버 알림 스트림
2. 앱 1단계: WebView·PC 목록·알림 서비스
3. 앱 2단계: 공유하기 (다른 앱의 사진·글 → 세션 고르기 → 첨부. 웹 쪽 세션 고르기 창이 필요하다). 음성 입력은 키보드 마이크로 지금도 되어 만들지 않는다

## 빌드·설치·확인

- Android SDK 명령줄 도구를 `%LOCALAPPDATA%\Android\Sdk` 에 (platform-tools·platforms;android-35·build-tools;35.0.0, 약 1GB). JDK 21 은 있다. `android/` 에 Gradle wrapper, 루트 `npm run android`(`gradlew assembleDebug`)
- 서명은 이 PC 의 debug 키 (`~/.android/debug.keystore`, 저장소에 넣지 않는다). 다른 PC 에서 빌드하면 키가 달라 덮어 설치가 안 되므로 이 PC 에서만 빌드한다
- 설치·업데이트: `tailscale file cp <apk> 3-mobile:`(Taildrop, 실행 전 매번 승인) → 폰에서 설치. versionCode 를 올려 덮어 설치. 자동 업데이트 없음
- 확인: 서버는 단위 테스트(판정·이벤트 버퍼)와 시험 서버 SSE(상태 변화 → 이벤트, `Last-Event-ID`). 앱은 Kotlin 순수 로직(이벤트 해석·재연결 간격·링크 판정) JUnit, 화면·알림은 실제 S26 에서 사용자가 본다. 못 본 것은 `.claude/rules/android.md` 의 "확인하지 못한 것"에
- 문서: 새 `.claude/rules/android.md`, 서버 쪽은 `server-api.md`·`host.md`, 루트 `CLAUDE.md` 의 표·구조에 한 줄씩
