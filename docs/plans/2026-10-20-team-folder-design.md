# 그룹 → 팀 → 세션 구조 개편 설계

그룹은 그래픽 공간일 뿐이고, 그 안에 **같은 작업 폴더를 쓰는 세션을 묶는 팀**이 있고, 팀 안에 세션(직원)이 있다. `2026-10-20-team-orchestration-design.md` 의 "팀장 + 명시적 팀원 목록" 을 이 구조로 흡수한다.

```
그룹 (그래픽 공간)
 └─ 팀 (폴더 = 팀의 키. 그룹 안의 섬)
     └─ 세션 = 직원 (책상)
```

## 결정 사항

| 항목 | 결정 |
|---|---|
| 팀 생성 | 사람이 "+ 팀" 으로만 만든다. 폴더마다 자동 생성하지 않는다 |
| 세션→팀 | 저장하지 않고 cwd 로 매번 판정. 정규화(소문자, `\`→`/`, 끝 `/` 제거) 후 정확히 같은 폴더만 |
| 외부 세션 | 폴더가 같으면 같은 팀 섬에 들어간다 (회색 측판, 관찰만, 드래그 불가) |
| 팀 없는 세션 | 웹·외부 모두 "로비" 고정 구역 (그룹이 아님. 그룹들 오른쪽 끝, 2열, 드래그 불가) |
| 배치 | 팀 = 책상 섬. 앵커(x,y)를 갖고 책상은 섬 안에서 개별 이동(오프셋 저장) |
| 팀장 | `Team.leadSessionId` (선택, 팀당 하나). 팀원 = 그 팀의 나머지 웹 세션 |
| 같은 폴더 팀 둘 | 거부 (409) |
| 기존 데이터 | `seats`·`teams.members` 는 버린다 (PC 하나, 데이터 적음) |

## 1. 데이터 모델 (`hq.json`)

```ts
groups: [{ id, name, x, y, w, h, waitingNote? }]        // 그래픽 공간만
teams: [{
  id, name, cwd, groupId, x, y,                         // 섬 앵커 (타일, 절대 좌표)
  leadSessionId?: string,
  desks: { [sessionId]: { dx, dy } },                  // 앵커 기준 오프셋. 끌어 놓았을 때만 저장
  createdAt
}]
webSessions: [{ sessionId, cwd, createdAt, extraArgs? }]
```

`Session` 응답의 `teamId`·`role('lead' | 'member' | null)` 은 cwd 판정으로 채운다. 외부 세션은 팀에 있어도 `role` 이 `member` 가 아니라 `null` 이다 (지시 대상이 아님).

## 2. 화면

- 팀 섬 = 앵커 + 책상들의 경계 상자 + 1타일 여백. 연한 바닥색·점선 테두리, 왼쪽 위 팀 이름표 (폴더는 툴팁)
- 이름표 드래그 = 섬 전체 이동. 다른 그룹 위에 놓으면 `groupId` 변경
- 책상 드래그 = `desks[sessionId]` 오프셋 저장. 섬 밖으로 끌어도 팀은 안 바뀌고 섬 경계가 늘어난다. 외부 세션 책상은 드래그 불가
- 자리 없는 세션은 2열 자동 정렬 (저장 안 함)
- 팀장 책상 금색 명패. 팀 섬 더블클릭 = 이름 변경·팀장 해제·삭제 (`prompt`). 팀 삭제는 세션을 죽이지 않는다
- 목록은 그룹 ▸ 팀 ▸ 세션 계층 + 로비
- 그룹은 그대로 (이름표 끌기 이동, 핸들 크기 조절, 대기 메모)

## 3. 오케스트레이션 매핑

- "+ 새 세션" 에서 팀을 고르고 "팀장으로" 체크 → 그 팀의 `leadSessionId`. 이미 팀장이 있으면 거부
- `jk_spawn_member(name, instruction?)` — cwd 인자 없음. 팀 폴더로 띄우면 자동 합류
- `jk_assign`·`jk_wait`·`jk_status`·`jk_dismiss`·`TaskStore` 는 그대로. `jk_dismiss` 는 세션 종료만
- 팀장 세션이 죽어도 `leadSessionId` 는 남는다. resume 으로 돌아오면 그대로 팀장

## 4. API

| 메서드 | 경로 | 하는 일 |
|---|---|---|
| `GET` | `/api/office` | `{ groups, teams }` |
| `POST` | `/api/team` | `{ name, cwd, groupId }`. 그 그룹 빈 자리에 앵커. 같은 cwd 면 409, 그룹 없으면 400 |
| `PATCH` | `/api/team/:id` | `{ name?, groupId?, x?, y?, leadSessionId?: string \| null }` |
| `DELETE` | `/api/team/:id` | 팀 기록 삭제 |
| `PUT` | `/api/team/:id/desks/:sessionId` | `{ dx, dy }` |
| `POST` | `/api/team/:id/members` | `{ name, instruction? }` |
| `POST` | `/api/sessions` | `{ cwd?, teamId?, prompt?, isLead? }` |
| `GET/POST` | `/api/team/:id/tasks*` | 그대로 |
| — | `/api/seats/*` | 삭제 |

## 5. 구현 단계 (각 단계 = 커밋 1개)

1. 모델·판정·API — `hq.ts` 재작성, `teamOf(cwd, teams)` + 경로 정규화 (순수, 테스트), 팀 API 재작성, `/api/sessions` 의 `teamId`·`isLead`, MCP `jk_spawn_member` cwd 삭제
2. 화면 — `Office.tsx` 팀 섬·이동·책상 오프셋·무소속·파견, 목록 팀별 그룹
3. 폼 — "+ 팀", "+ 새 세션" 팀 선택과 "팀장으로", 팀 더블클릭 편집
4. 문서 — `CLAUDE.md`, 오케스트레이션 설계 문서의 달라진 부분

## 버리는 것

`seats`, `teams.members`, `addTeamMember`/`removeTeamMember`, "모든 외부 세션은 파견 구역" 규칙, 팀원의 "팀장 그룹 자동 배치".
