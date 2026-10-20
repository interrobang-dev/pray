# jk-corp

Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰만 한다. 설계 전문: `docs/plans/2026-10-20-session-office-design.md`.

## 실행·확인

```
npm install
npm run hooks:install     # ~/.claude/settings.json 에 http 훅 6개 추가 (한 번만. 기존 훅은 안 건드림)
npm run dev               # host(named pipe) + server(4710) + web(4711) 동시 실행
```

브라우저: `http://localhost:4711` (Vite가 IPv6 localhost로 열려 `127.0.0.1`로는 안 열림). `/api`는 Vite 프록시로 서버에 전달.
서버 코드는 `tsx watch`라 저장하면 재시작되고, 세션 호스트는 별도 프로세스라 서버 재시작에 영향받지 않는다. 호스트는 watch 가 아니다 (재시작하면 웹 세션이 다 죽으므로 일부러). 훅은 Claude Code가 settings.json을 핫리로드하므로 세션 재시작 없이 반영된다.

테스트: `npm test` (host·server의 vitest).

**Claude Code 세션 안에서 호스트를 띄우지 말 것.** 띄우더라도 `ptyPool.ts`가 `CLAUDECODE`·`CLAUDE_*` 환경변수를 지우고 자식을 실행한다. 안 지우면 자식 claude가 중첩 실행으로 판단해 종료 코드 1로 죽는다.

## 구조

- `host/src/index.ts` — named pipe `\\.\pipe\jk-corp-host` 서버. 연결된 모든 클라이언트에 모든 세션 출력을 보낸다 (구독 관리 없음)
- `host/src/ptyPool.ts` — node-pty로 `claude.exe --session-id <uuid>` 실행, 세션별 200KB 링버퍼
- `host/src/protocol.ts` — pipe 메시지 타입과 줄 단위 JSON 프레이밍. 서버가 `@jk-corp/host/protocol`로 import
- `host/src/hq.ts` — `~/.claude/jk-corp/hq.json`의 `webSessions` 기록 (spawn 시 추가, kill 시 제거)
- `server/src/index.ts` — Express. 세션 목록·전역 SSE·훅 수신 + 웹 세션 생성/입력/크기/종료/터미널 스트림
- `server/src/hostClient.ts` — pipe 클라이언트. 끊기면 3초마다 재연결
- `server/src/sessions.ts` — 살아 있는 세션 + 훅 상태 + 호스트 목록 + 대화 요약을 합쳐 `Session[]` 생성
- `server/src/liveSessions.ts` — `~/.claude/sessions/<pid>.json` 읽고 pid 생존 확인
- `server/src/hookState.ts` — 훅 이벤트 → 상태 매핑 (순수 함수)
- `server/src/transcript.ts` — jsonl → 제목·마지막 시각·마지막 assistant 텍스트 (순수 함수)
- `server/src/messages.ts` — jsonl → 채팅 메시지 배열. assistant 는 `message.id` 로 묶고 tool_result 를 tool_use 에 붙인다 (순수 함수)
- `server/src/transcriptWatcher.ts` — `~/.claude/projects` 재귀 감시 → 전역 SSE `transcript {sessionId}` (300ms 디바운스)
- `web/src/App.tsx` — 좌측 세션 목록, 우측 패널 (대화 탭 / 터미널 탭. 터미널은 웹 세션만)
- `web/src/Chat.tsx` — 말풍선 뷰. 입력칸은 `텍스트` 후 `\r` 을 터미널 입력 API 로 보낸다. 승인 버튼은 Enter(승인)/Esc(거부) 키 전송
- `web/src/Terminal.tsx` — xterm.js. 출력은 세션별 SSE, 입력·크기는 POST
- `hooks/install.mjs` — settings.json 훅 설치 스크립트

## 핵심 개념

- **세션 생존 판정**은 `~/.claude/sessions/*.json`의 pid 로 한다. jsonl 수정 시각은 쓰지 않는다 (비활성 세션도 파일은 남아 있어서 부정확)
- **상태**는 훅 이벤트로만 바뀐다. `UserPromptSubmit`→working, `PermissionRequest`→needs-approval, `PostToolUse`→working(승인 해제), `Stop`→my-turn, `SessionEnd`→ended. 훅이 한 번도 안 온 세션은 `unknown`
- 훅은 `type: "http"`로 서버에 직접 POST 한다. 서버가 꺼져 있으면 그 사이 이벤트는 유실되고 Claude Code 쪽엔 영향 없다 (non-blocking). timeout 2초
- 훅 상태는 서버 메모리에만 있다. 서버 재시작 시 전부 `unknown`에서 다시 시작
- 세션 제목은 jsonl의 `ai-title` 줄에서 가져온다
- **웹 세션 = 호스트 pty 목록에 있는 세션.** `--session-id`로 UUID를 넘겨 pty·jsonl·훅이 같은 키로 묶인다
- 터미널 스트림은 `attach` 요청에 호스트가 링버퍼 스냅샷을 한 번 주고(`snapshot` 이벤트, 화면 reset 후 그림), 이후 `output`을 잇는다. 서버만 재시작해도 브라우저가 SSE 재연결하면 같은 경로로 복원된다
- 새 폴더에서 claude를 띄우면 신뢰 확인 대화상자가 뜨고 **기본 선택이 "No, exit"**다. 사용자가 터미널에서 ↓ Enter를 눌러야 한다. 자동 테스트에서 Enter만 보내면 종료 코드 1로 죽는 게 정상이다
- 호스트 자체가 죽으면 웹 세션도 죽는다. 허용한 설계
- 채팅 뷰는 별도 API 없이 **터미널 키 입력**으로 지시를 보낸다. 슬래시 명령은 자동완성이 Enter 를 먼저 먹어 두 번 눌러야 할 수 있다

## 남은 일 (설계서 구현 순서)

- hq.json `webSessions`에서 claude가 스스로 종료한(exit) 세션 기록을 지울지, 재부팅 resume 대상으로 남길지 미정. 지금은 kill 때만 지운다
4. 픽셀 사무실
5. 재부팅 resume + 작업 스케줄러
6. 메일 로그인
