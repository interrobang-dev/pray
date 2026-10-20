# jk-corp

Windows PC에서 돌아가는 Claude Code 세션 관제판. 세션을 픽셀 사무실의 직원으로 보여주고, 웹에서 띄운 세션은 조작하고 외부(터미널·IDE) 세션은 관찰만 한다. 설계 전문: `docs/plans/2026-10-20-session-office-design.md`.

## 실행·확인

```
npm install
npm run hooks:install     # ~/.claude/settings.json 에 http 훅 6개 추가 (한 번만. 기존 훅은 안 건드림)
npm run dev               # server(4710) + web(4711) 동시 실행
```

브라우저: `http://localhost:4711` (Vite가 IPv6 localhost로 열려 `127.0.0.1`로는 안 열림). `/api`는 Vite 프록시로 서버에 전달.
서버 코드는 `tsx watch`라 저장하면 재시작된다. 훅은 Claude Code가 settings.json을 핫리로드하므로 세션 재시작 없이 반영된다.

테스트: `npm test` (server의 vitest).

## 구조

- `server/src/index.ts` — Express. `GET /api/sessions`, `GET /api/events`(SSE, 5초 주기 + 훅 수신 시 즉시), `POST /api/hook`
- `server/src/sessions.ts` — 살아 있는 세션 + 훅 상태 + 대화 요약을 합쳐 `Session[]` 생성
- `server/src/liveSessions.ts` — `~/.claude/sessions/<pid>.json` 읽고 pid 생존 확인
- `server/src/hookState.ts` — 훅 이벤트 → 상태 매핑 (순수 함수)
- `server/src/transcript.ts` — jsonl → 제목·마지막 시각·마지막 assistant 텍스트 (순수 함수)
- `web/src/App.tsx` — 세션 목록 표
- `hooks/install.mjs` — settings.json 훅 설치 스크립트

## 핵심 개념

- **세션 생존 판정**은 `~/.claude/sessions/*.json`의 pid 로 한다. jsonl 수정 시각은 쓰지 않는다 (비활성 세션도 파일은 남아 있어서 부정확)
- **상태**는 훅 이벤트로만 바뀐다. `UserPromptSubmit`→working, `PermissionRequest`→needs-approval, `PostToolUse`→working(승인 해제), `Stop`→my-turn, `SessionEnd`→ended. 훅이 한 번도 안 온 세션은 `unknown`
- 훅은 `type: "http"`로 서버에 직접 POST 한다. 서버가 꺼져 있으면 그 사이 이벤트는 유실되고 Claude Code 쪽엔 영향 없다 (non-blocking). timeout 2초
- 훅 상태는 서버 메모리에만 있다. 서버 재시작 시 전부 `unknown`에서 다시 시작
- 세션 제목은 jsonl의 `ai-title` 줄에서 가져온다

## 남은 일 (설계서 구현 순서)

2. 세션 호스트(node-pty, named pipe) + 터미널 탭
3. 채팅 뷰 + 승인 버튼
4. 픽셀 사무실
5. 재부팅 resume + 작업 스케줄러
6. 메일 로그인
