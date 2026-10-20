# 팀 안의 파트 설계

한 팀(= 폴더 = 프로젝트) 안에 지시자를 여럿 두기 위해 **팀 아래에 선택적인 파트**를 둔다. 파트는 파트장 한 명과 그 팀원들의 묶음이다. 파트가 없는 팀은 지금과 똑같이 동작한다.

```
그룹 (그래픽 공간)
 └─ 팀 (폴더. 사무실 섬)
     ├─ 팀 직속: 팀장 + 파트 없는 세션
     └─ 파트 (선택. 0개 이상)
         └─ 파트장 + 파트 팀원   ← worktree 를 고르면 별도 폴더에서 일한다
```

## 결정 사항

| 항목 | 결정 |
|---|---|
| 파트 | 있어도 되고 없어도 된다. 파트 없는 세션은 "팀 직속" |
| 지휘 | **지휘 단위마다 지시자 한 명.** 팀장 = 팀 직속 팀원만, 파트장 = 자기 파트 팀원만. 2단 지휘(팀장 → 파트장)는 하지 않는다 |
| 같은 폴더 동시 수정 | 파트를 만들 때 작업 위치를 고른다: 팀 폴더 그대로 / 새 git worktree |
| worktree 위치 | 저장소 옆 형제 폴더 `<부모>/<저장소>.worktrees/<슬러그>`, 브랜치 `part/<슬러그>` |
| 파트 삭제 | 파트 기록만 지운다. worktree 폴더·브랜치는 남긴다 (병합 안 된 작업 보호). 소속 세션은 팀 직속이 된다 |
| 신뢰 확인 창 | worktree 를 만들 때 서버가 `~/.claude.json` 의 `projects["<worktree 경로>"].hasTrustDialogAccepted = true` 를 기록한다 (사용자 승인함) |

## 1. 데이터 모델 (`hq.json`)

```ts
Team {
  id, name, cwd, groupId, x, y, desks, createdAt,  // 그대로
  leadSessionId?: string                           // 팀장. 팀 직속만 지휘
  parts: Part[]                                    // 없으면 []
  partOf: { [sessionId]: partId }                  // worktree 없는 파트의 소속만 저장
}

Part {
  id, name,
  leadSessionId?: string,
  worktree?: { cwd: string, branch: string },
  createdAt
}
```

`Session` 응답에 `partId: string | null` 을 더한다. `role` 은 그대로 `'lead' | 'member' | null` 이고, 팀장인지 파트장인지는 `partId` 로 구분한다.

## 2. 판정 규칙 (순수 함수, `host/src/team.ts`)

- **팀**: 세션 cwd 가 `team.cwd` 또는 그 팀 파트의 `worktree.cwd` 와 같으면 그 팀 (`normalizeCwd` 정확히 일치)
- **파트**: cwd 가 어떤 파트의 worktree 이면 그 파트 (폴더로 정해지므로 저장 안 함. 외부 세션도 자동 합류). 아니면 `partOf[sessionId]`. 그것도 없으면 `null` (팀 직속)
- **역할**: 자기 단위의 `leadSessionId` 면 `lead`, 아니고 웹 세션이면 `member`, 외부 세션은 `null`
- 저장된 `partOf` 가 가리키는 파트가 지워졌으면 팀 직속으로 본다

## 3. 지휘 단위 = (teamId, partId | null)

- `TaskStore` 의 task 에 `partId` 를 더하고, `wait(any)` 와 목록을 **지휘 단위로** 거른다. 팀으로만 거르면 한 지시자가 다른 단위의 결과를 가로챈다
- `assign` 은 지시 대상이 같은 단위의 팀원일 때만 받는다 (아니면 403)
- 팀장 MCP 는 지금처럼 `JK_CORP_TEAM_ID` 만, 파트장 MCP 는 `JK_CORP_PART_ID` 를 더 받는다. MCP 의 모든 호출이 `partId` 를 실어 보낸다
- `jk_spawn_member` 는 자기 단위로 띄운다: 파트면 `partOf` 기록, worktree 파트면 그 폴더에서 spawn (폴더로 소속이 정해지므로 기록 불필요)
- `jk_status` 는 자기 단위의 팀원만 보여 준다

## 4. worktree 생성

1. 팀 폴더가 git 저장소인지 확인 (`git -C <team.cwd> rev-parse --show-toplevel`). 아니면 400
2. 슬러그 = 파트 이름의 영문·숫자·하이픈. 비면 파트 ID
3. `git -C <team.cwd> worktree add <부모>/<저장소>.worktrees/<슬러그> -b part/<슬러그>` (현재 HEAD 기준). 실패하면 git 메시지를 그대로 409 로 돌려준다 (폴더·브랜치가 이미 있는 경우 등)
4. `~/.claude.json` 에 신뢰 표시 기록. 이 파일은 Claude Code 가 수시로 다시 쓰므로 **읽기 직후 그 키 하나만 바꿔 바로 쓴다**. 파싱이 실패하면 쓰지 않고 경고만 남긴다 (사용자가 터미널에서 직접 허용)
5. 병합은 하지 않는다. 파트장이나 사람이 git 으로 한다

## 5. API

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `POST` | `/api/team/:id/parts` | `{ name, isWorktree, leadPrompt?, isLeadSpawned? }`. 파트 생성(+worktree), 원하면 파트장도 바로 띄운다 |
| `PATCH` | `/api/team/:id/parts/:partId` | `{ name?, leadSessionId?: string \| null }` |
| `DELETE` | `/api/team/:id/parts/:partId` | 파트 기록·`partOf` 정리. worktree 는 남김 |
| `PUT` | `/api/team/:id/partOf/:sessionId` | `{ partId: string \| null }`. 팀 폴더 세션의 파트 이동 (worktree 세션은 폴더로 정해져 거부) |
| `POST` | `/api/sessions` | `partId?` 추가. `isLead` + `partId` 면 그 파트의 파트장 (살아 있는 파트장이 있으면 409) |
| `POST` | `/api/team/:id/members` | `partId?` 추가 (MCP 가 채움) |
| `GET/POST` | `/api/team/:id/tasks*` | `partId` 쿼리·본문으로 지휘 단위 지정 |

## 6. 화면

- **목록**: 팀 카드 안에서 팀 직속 세션 → 파트 소제목(이름, worktree 면 브랜치 표시, hover `+`·`⋯`) → 파트 세션 순. 파트장은 "파트장" 태그
- **추가**: 팀 `⋯` 메뉴 "파트 추가" 모달 = 이름 + 작업 위치 세그먼트 "팀 폴더 | 새 worktree" + "파트장 바로 띄우기"와 첫 지시. 파트 `+` = 그 파트에 세션 추가 (세그먼트 "팀원 | 파트장")
- **사무실**: 팀 섬 안에 파트별 하위 구역(옅은 테두리 + 파트 이름표). 팀 직속 책상은 섬 위쪽. 책상 오프셋(`desks`)은 지금처럼 팀 앵커 기준
- 파트장 책상은 팀장과 같은 금색 명패, 밑줄은 은색으로 구분

## 7. 기존 데이터

`parts`·`partOf` 가 없는 팀은 `[]`·`{}` 로 읽는다. 기존 팀장은 그대로 팀장(팀 직속 지휘)이라 이전할 것이 없다.

## 8. 구현 단계 (각 단계 = 커밋 1개)

1. 이 문서
2. 모델 — `Part` 타입, 팀·파트·역할 판정, `hq.ts` 저장 함수, 읽기 기본값, 단위 테스트
3. 서버 — 파트 API, worktree 생성·신뢰 기록, 세션·팀원 생성의 `partId`, `TaskStore` 지휘 단위, 파트장 MCP·지침
4. 화면 목록 — 파트 소제목·추가 모달·세션 추가의 파트 선택·태그
5. 사무실 — 섬 안 파트 구역
6. `CLAUDE.md`·오케스트레이션 설계 문서 갱신

## 확인할 것

- 형제 폴더 worktree 에서 신뢰 표시만으로 확인 창이 안 뜨는지 (bypassPermissions 경고 창이 따로 뜨는지 포함)
- 같은 브랜치·폴더가 이미 있을 때 git 오류가 사용자에게 읽히는지
