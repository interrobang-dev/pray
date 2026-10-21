# 팀장·팀원 오케스트레이션 설계

팀장 Claude 세션이 팀원 Claude 세션을 만들고 지시하고 결과를 모은다. 사람은 팀장에게만 말한다. 기존 관제판(사무실·채팅·터미널) 위에 얹는다.

팀 자체(폴더 단위 세션 묶음, 섬 배치)는 `2026-10-20-team-folder-design.md` 가 정의한다. 이 문서는 그 팀 위에서 도는 팀장·팀원 동작만 다룬다. 팀 안의 파트와 파트장은 `2026-10-21-team-parts-design.md` 가 정의하고, 파트장은 이 문서의 팀장 동작을 자기 파트 안에서 그대로 한다.

## 결정 사항

| 항목 | 결정 |
|---|---|
| 팀장 주체 | Claude 세션. MCP 도구로 팀원을 다룬다 (Orca 코디네이터 방식) |
| 팀원 형태 | 대화형 claude (지금의 웹 세션과 동일). `claude -p` 헤드리스는 쓰지 않는다 |
| 팀장→팀원 지시 | 기존 터미널 입력 API 재사용 (`텍스트 + \r`) |
| 팀원→팀장 결과 | 기존 `Stop` 훅의 `last_assistant_message` |
| 도구 승인 | 팀장·팀원 모두 기본 `--permission-mode bypassPermissions`. 생성 시 `permissionMode` 로 변경 가능 |
| 팀·팀원 판정 | 팀 = 폴더. 팀원 = 같은 지휘 단위(팀 직속 또는 파트)의 나머지 웹 세션 (팀은 cwd 로 판정, 파트는 worktree 폴더 또는 `partOf` 기록) |
| 지휘 단위 | 팀장 = 팀 직속만, 파트장 = 자기 파트만. task·wait·status 는 단위로 거르고 다른 단위에 지시하면 403 |
| 외부 세션 | 같은 폴더면 팀에 보이지만 지시 대상이 아니다 (`role: null`, 입력 경로 없음) |

## 1. 구조

```
사람 ──(웹 채팅)──▶ 팀장 세션 (claude, 대화형, MCP "jk-corp" 장착)
                        │ MCP 도구 호출
                        ▼
                  서버 /api/team/*  ──pipe──▶ 호스트 (spawn / input / kill)
                        ▲
                        │ UserPromptSubmit · Stop 훅
                  팀원 세션 1, 2, 3 … (claude, 대화형, 사무실 책상에 보임)
```

- 팀원은 자기가 팀원인지 몰라도 된다. 결과 형식이 필요하면 지시문에 넣는다
- 팀장만 특별하다. 생성 시 `--mcp-config` 로 jk-corp MCP 서버를 붙이고 `--append-system-prompt` 로 팀장 지침을 준다
- MCP 서버는 서버의 `/api/team/*` 를 호출하는 얇은 stdio 어댑터 (`mcp/` 워크스페이스). 설정 JSON 에 `teamId` 와 서버 주소가 들어가 팀장은 자기 팀만 다룬다. 파트장은 `JK_CORP_PART_ID` 를 더 받아 모든 호출에 `?partId=` 를 붙인다
- 호스트 프로토콜의 `spawn` 에 `extraArgs: string[]` 필드 하나만 추가한다

## 2. 데이터 모델

`hq.json` 의 팀 (`team-folder-design.md` 와 같음). 오케스트레이션이 쓰는 필드는 `id`·`cwd`·`leadSessionId` 뿐이다:

```ts
teams: [{ id, name, cwd, groupId, x, y, leadSessionId?, desks, createdAt }]
```

서버 메모리 (재시작 시 초기화. 훅 상태와 같은 수명):

```ts
tasks: Map<taskId, {
  teamId, partId,          // partId null = 팀 직속
  memberSessionId, instruction, createdAt,
  status: 'running' | 'done' | 'failed',
  result: string | null   // Stop 훅의 last_assistant_message
  error: string | null
}>
```

- `Session` 응답의 `teamId`·`role('lead' | 'member' | null)` 은 cwd 판정으로 채운다
- 팀원 세션도 `webSessions` 에 들어가 재시작 시 resume 된다 (extraArgs 포함). 팀장은 `leadSessionId` 로 남고, 진행 중이던 task 는 사라진다 (허용)

## 3. MCP 도구

| 도구 | 하는 일 | 서버 API |
|---|---|---|
| `jk_spawn_member(name, instruction?)` | 팀 폴더로 세션 생성 (cwd 판정으로 자동 합류), 첫 지시 전달 | `POST /api/team/:teamId/members` |
| `jk_assign(sessionId, instruction)` | 팀원에게 지시. task 생성 후 터미널 입력 전송 | `POST /api/team/tasks` |
| `jk_wait(taskId?, timeoutSec=120)` | task 완료까지 롱폴링. 생략하면 팀의 아무 task 하나 | `GET /api/team/tasks/:id/wait` |
| `jk_status()` | 팀의 세션 목록(역할·웹/외부·상태·마지막 말) + task 목록 | `GET /api/team/:teamId` |
| `jk_dismiss(sessionId)` | 팀원 세션 종료 | `DELETE /api/team/:teamId/members/:id` |

팀장 지침(append-system-prompt) 요지: "너는 팀장이다. 큰 일은 팀원에게 나눠 주고 `jk_wait` 로 결과를 받아 합친다. 팀원 결과는 마지막 응답 텍스트 하나이니, 팀원에게 '끝나면 결과 요약을 마지막 메시지로 써라' 를 꼭 넣어라."

## 4. task 생명주기

1. `jk_assign` → 서버가 task 를 `running` 으로 만들고 팀원 pty 에 지시문 + `\r` 전송
2. 팀원의 `UserPromptSubmit` 훅으로 수신 확인. 5초 안에 안 오면 `failed` (터미널이 입력을 못 받는 상태. 예: 신뢰 확인 대화상자)
3. 팀원의 `Stop` 훅 → `done`, `result = last_assistant_message`. `jk_wait` 즉시 반환
4. 한 팀원에 `running` task 가 있는데 또 `jk_assign` 하면 409. 팀장이 순서를 지키게 강제
5. 팀원이 죽으면(exit) 그 팀원의 running task 는 `failed`

## 5. 팀장 생성

웹 "+ 새 세션" 폼에서 팀을 고르고 "팀장으로" 체크 (`POST /api/sessions { teamId, isLead }`). 살아 있는 팀장이 이미 있으면 409. 서버가 `leadSessionId` 를 기록하고 호스트 `spawn` 에 다음을 더한다 (`server/src/lead.ts`). 호스트는 이 인자를 `webSessions` 에 저장해 resume 때도 넘긴다:

```
--name "<팀> 팀장" --permission-mode bypassPermissions --append-system-prompt <지침> --mcp-config <json>
```

MCP 설정은 서버의 node(`process.execPath`)로 `node --import <tsx loader> mcp/src/index.ts` 를 띄우고 env 로 `JK_CORP_TEAM_ID`·`JK_CORP_SERVER` 를 넘긴다. 팀장 해제는 목록의 "팀장 해제" (`PATCH { leadSessionId: null }`).

`--allow-dangerously-skip-permissions` 플래그가 함께 필요한지는 실전 확인 때 본다.

## 6. 오류·한계

- 서버 재시작 시 task 전부 소실. `jk_wait` 는 "모르는 task" 로 반환하고 팀장은 `jk_status` 로 다시 판단
- 사람이 팀원 터미널에 직접 끼어들어도 막지 않는다. 그 뒤 오는 `Stop` 은 running task 의 결과로 잡힌다 (관제판 철학)
- 결과는 마지막 assistant 텍스트뿐. 파일 산출물은 cwd 공유로 받는다 (같은 폴더, 또는 worktree 파트면 그 파트의 worktree 폴더)
- bypassPermissions 라 팀원이 위험한 명령도 실행한다. 사용자 결정 사항

## 7. 검증

- `server/src/teamState.ts` (순수 함수) vitest: UserPromptSubmit 수신 확인, Stop 완료, exit 실패, 중복 assign 거부
- MCP 어댑터: 서버 API 모킹해서 도구 입출력
- 수동: 팀장에게 "두 팀원에게 A·B 조사시키고 합쳐라" → 사무실에 팀원 책상 2개가 생기고 결과가 합쳐지는지 (API 비용 발생)

## 8. 구현 위치

- `server/src/teamState.ts` — task 상태 기계. `server/src/index.ts` — `/api/team/*`, 훅·exit 연결
- `server/src/lead.ts` — 팀장 지침·인자·MCP 설정. `host/src/ptyPool.ts` — `spawn.extraArgs`
- `mcp/src/index.ts`·`teamApi.ts` — stdio MCP 서버, 도구 5개
- 사무실 표시(팀장 금색 명패, 목록 배지)는 `web/src/Office.tsx`·`App.tsx`
