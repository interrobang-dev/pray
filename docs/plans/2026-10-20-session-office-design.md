# jk-corp: AI 회사 세션 관제판 설계

Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰한다.
참고: https://github.com/gyoomun/claude-session-hq (macOS·tmux 전용). tmux·launchd 자리를 세션 호스트·작업 스케줄러로 대체한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 핵심 목적 | 세션 관제판 |
| 실행 환경 | Windows PC (이 PC) |
| 세션 범위 | 웹 세션은 조작, 외부 세션은 훅 관찰만 |
| 메인 화면 | 픽셀 가상 사무실 (방=업무, 책상=세션) |
| 스택 | Node 서버 + React/Vite + 브라우저. PixiJS, xterm.js, node-pty |
| MVP | 픽셀 사무실, 채팅 뷰, 세션 유지, 원격 접속(메일 인증) |
| 세션 유지 | 서버와 세션 호스트 분리 (named pipe) |
| 로그인 | 로컬 무인증, 원격은 메일 6자리 인증번호 → 30일 쿠키 |

## 1. 전체 구조

```
브라우저 (React/Vite, PixiJS 사무실, xterm.js)
    │ HTTP + SSE(출력 스트림) + POST(키 입력)
서버 (Node, HTTP)  ← 재시작 자유
    │ named pipe (\.\pipe\jk-corp-host)
세션 호스트 (Node, node-pty 풀)  ← 상시 실행
    ├─ claude.exe (웹 세션 1)
    └─ claude.exe (웹 세션 2) ...
```

- 세션 호스트가 tmux 역할. ConPTY로 claude 실행, 세션별 출력 링버퍼(200KB) 보유. 서버 재연결 시 버퍼 먼저 전송 후 스트림 연결. 작업 스케줄러로 로그인 시 자동 실행
- 서버는 호스트 중계 + `~/.claude/projects/*.jsonl`(대화), 훅 이벤트 파일(상태), `hq.json`(업무·자리) 읽기. 코드 수정 후 서버만 재시작해도 세션 유지
- 외부 세션은 호스트를 거치지 않음. 훅 이벤트로 상태, jsonl로 대화만. 입력칸 비활성
- 재부팅 시 호스트가 `hq.json.webSessions`를 읽어 `claude --resume <id>`로 복구

## 2. 데이터 모델

원칙: Claude Code가 이미 남기는 것은 다시 저장하지 않는다. 앱이 쓰는 파일은 `~/.claude/jk-corp/hq.json`과 훅 이벤트 디렉터리뿐.

```ts
// hq.json
{
  rooms: [{ id, name, x, y, w, h, waitingNote? }],   // 방 = 업무
  seats: { [sessionId]: { roomId, x, y, label? } },    // 책상 위치, 별명
  webSessions: [{ sessionId, cwd, createdAt }],         // 재부팅 후 resume 목록
}
```

세션(파생 객체, 저장 안 함):

| 필드 | 출처 |
|---|---|
| id, cwd, 마지막 메시지 시각 | `~/.claude/projects/<cwd>/<id>.jsonl` |
| status: working / my-turn / needs-approval / idle | 훅 이벤트 파일 (UserPromptSubmit→working, Stop→my-turn, PreToolUse 승인 대기→needs-approval, 무이벤트→idle) |
| kind: web / external | 호스트 pty 목록에 있으면 web |
| roomId, 좌표 | hq.json seats. 없으면 로비에 자동 배치 |

- 훅 이벤트 파일: `~/.claude/jk-corp/hooks/<sessionId>.json`에 마지막 이벤트 하나만 덮어씀. 서버가 `fs.watch`로 감시해 SSE 전파
- 대화 메시지: jsonl → `{ role, text, toolUses[], timestamp }` 정규화. 채팅 뷰 전용
- 외부 세션 발견: jsonl 수정 시각이 10분 이내이거나 훅 이벤트가 있으면 살아 있는 것으로 간주. 프로세스 존재 확인은 쓰지 않음

## 3. 세션 호스트

```ts
ptys: Map<sessionId, { pty: IPty, ring: RingBuffer(200KB), cwd, cols, rows }>
```

pipe 프로토콜(JSON 라인):

| 명령 | 동작 |
|---|---|
| `spawn { cwd, sessionId, resume? }` | `claude --session-id <id>` 또는 `--resume`. 환경변수 `JK_CORP_SESSION=<id>` 주입 |
| `attach { sessionId }` | 링버퍼 전송 후 스트림 |
| `input { sessionId, data }` | 키 입력 |
| `resize { sessionId, cols, rows }` | 창 크기 |
| `kill { sessionId }` | 종료, `webSessions`에서 제거 |
| `list` | 살아 있는 pty 목록 |

브라우저 ↔ 서버:
- 출력: `GET /api/sessions/:id/stream` (SSE)
- 입력: `POST /api/sessions/:id/input`. 채팅 입력칸도 `텍스트 + \r`로 같은 경로
- 전역 이벤트: `GET /api/events` (SSE) — 상태·세션 목록 변경

세션 ID: 호스트가 만든 UUID를 `--session-id`로 넘겨 pty·jsonl·훅이 같은 키로 묶임. 외부 세션은 훅의 `session_id` 사용.
호스트 자체가 죽으면 세션도 죽는다. 허용하고 재시작 시 `--resume`으로 대화만 복구.

## 4. 화면

레이아웃: 좌측 사무실(PixiJS), 우측 패널(대화 탭 / 터미널 탭. 터미널은 웹 세션만).

픽셀 사무실:
- 32px 타일. 방은 사각형 + 이름표. 책상 + 캐릭터 = 세션
- 상태: working 타자 애니메이션, my-turn 손 들기 + 말풍선(마지막 assistant 메시지 첫 줄), needs-approval 빨간 느낌표, idle 기댐
- 외부 세션은 회색 계열 캐릭터
- 드래그 → `PATCH /api/seats/:id`. 방 밖은 로비
- 방 상단 `waitingNote` 포스트잇, 더블클릭 편집
- 클릭 = 세션 선택. 빈 책상(+) 클릭 = 새 세션 다이얼로그(폴더·방·첫 지시)
- 캐릭터 외형은 세션 ID 해시로 고정

채팅 뷰:
- 말풍선. 도구 호출은 접힌 한 줄, 펼치면 입력·결과
- needs-approval이면 승인(y)/거부(n) 버튼
- jsonl 변경 → fs.watch → SSE → 즉시 반영

로그인: 127.0.0.1 무인증. 원격은 메일 인증 → 30일 쿠키. SMTP는 `config.json`.

## 5. 오류 처리

- 호스트 pipe 끊김: 3초 간격 재연결. 웹 세션 `unreachable` 표시, 입력 비활성. 외부 관찰은 계속
- claude 비정상 종료: 캐릭터 "퇴근" 상태, 책상은 유지(resume 가능)
- jsonl 불완전 줄: 버리고 다음 변경 때 재읽기
- 훅 미설치 세션: status `unknown`, jsonl 시각으로만 idle 판정
- SMTP 실패: 로컬 무영향, 원격 로그인 화면에 오류 표시

## 6. 테스트

- 호스트: pipe 프로토콜 단위 테스트(spawn→attach→input→출력, 재attach 링버퍼 복원). claude 대신 `cmd /c echo`
- 서버: jsonl 정규화, 훅→status 매핑, hq.json 읽기/쓰기를 순수 함수로 두고 vitest
- 화면: 상태 4종 강제 주입 스토리 페이지
- 수동: 서버 재시작 중 세션 생존, 재부팅 후 resume, 외부 세션 출현

## 7. 구현 순서

1. 훅 6개 + 서버: 외부 세션 읽기 전용 목록 → 데이터 소스 검증
2. 세션 호스트 + 터미널 탭: 웹 세션 생성·입력·서버 재시작 생존
3. 채팅 뷰 + 승인 버튼
4. 픽셀 사무실(방·책상·상태·드래그)
5. 재부팅 resume + 작업 스케줄러 등록
6. 메일 로그인
