# tools/sprites

사무실 도트 에셋 파이프라인. 규격·절차·주의점은 `docs/plans/2026-10-22-office-sprites-design.md` 가 정본이다.

```
생성(sprite-gen, 구독 로그인) → 원본 PNG(마젠타 배경)
  → build.py + 레시피: 키 빼기 → 셀 정규화(발 기준선·몸 높이) → 최빈색 축소 → 알파 확인
  → web/public/office/<이름>.png + .json (PixiJS 8 Spritesheet) + <이름>-tile-*.png
```

## 실행 Python

numpy·Pillow 가 있는 Python 3.10 이상이면 된다 (scipy 는 쓰지 않는다). 이 PC 는 시스템 Python 3.13 을 쓴다. sprite-gen 의 venv Python 도 둘 다 갖고 있지만 저장소 밖 경로라 스크립트에 넣지 않는다.

```bash
python tools/sprites/build.py --recipe tools/sprites/recipes/office-v0.json \
  --source-dir ~/.claude/jk-corp/sprite-src/v0 --out web/public/office
```

- `--source-dir`: 레시피의 파일 이름이 가리키는 생성 원본 폴더. 원본은 커밋하지 않는다 (장당 1~2MB). v0 원본은 `~/.claude/jk-corp/sprite-src/v0/` (프롬프트 사본 `prompts/` 포함)
- 알파 문제(전부 투명·전부 불투명·반투명 픽셀)가 있으면 아무것도 쓰지 않고 종료 코드 1. 캐릭터 셀이 위·왼쪽·오른쪽 가장자리에 닿으면 "주의:" 로 알린다 (잘렸을 수 있음)
- 잘림 검사: `python tools/sprites/check_edges.py --recipe <레시피> --source-dir <원본 폴더> --atlas web/public/office/<판>` — 인물 프레임이 셀 네 가장자리에 닿거나 인물·소품이 원본 칸 경계(덩어리 단위 판이면 원본 그림 끝·이웃 그림)에 닿은 곳을 센다. 원본 px 상자(`box`)로 자르는 소품은 상자 경계·상자 바로 밖 1px·원본 그림 끝에 닿은 곳을 센다. 0 개가 아니면 종료 코드 1 (v5 넷·v6 거리는 0 개)
- 다 만든 뒤 `npm run build` 해야 web/dist 에 들어가 화면에 반영된다

## 생성

```bash
SPRITE_GEN=<sprite-gen 실행 파일> bash tools/sprites/gen.sh gen --provider codex --prompt-file <프롬프트> --ref <스타일 참고 그림> --out <원본.png>
```

`gen.sh` 는 과금 API 키(`OPENAI_API_KEY` 등)를 env 에서 빼고 실행한다. 프롬프트 틀은 `prompts/` (`{{DESCRIPTION}}` 등은 손으로 채운다). 캐릭터 상태 행은 `sprite-gen prepare --request prompts/character-rows.json --description "<사람 글 묘사>"` → `gen-set --provider codex` 로 만들고, `raw/<상태>.png.raw.png` 를 원본 폴더에 옮겨 레시피에 적는다.

## 레시피

`recipes/*.json`. `spec`(타일·셀·기준선·몸 높이. `anchorX` = 셀 안 가로 기준(없으면 가운데), `backX` = 발 중심 대신 하체 왼쪽 끝(옆모습의 등)을 이 x 에 맞춘다), `direction`(있으면 프레임 이름이 `char/<id>/<방향>/<상태>`), `palette`(있으면 그 색 수 + 투명 1칸의 팔레트 PNG — v5 는 255), `slice`(`"figure"` 면 인물·소품을 원본 칸 경계가 아니라 덩어리 단위로 자른다 — 칸 경계를 넘은 머리·손·소품 끝이 잘리지 않는다. v5 넷), `jkCorp`(그대로 `meta.jkCorp` 에 싣는 화면용 메타), `characters[]`(`id`·`pool`·`gender` 는 아틀라스 메타로, `scale` = 몸 높이 대신 쓸 고정 배율), `characters[].rows[]`(`strip`+`count`, 격자 한 장의 한 행 `grid`+`gridSize`[칸, 행]+`gridRow`, 또는 `frames` 목록, 쓸 칸 `use`, 재생 순서 `sequence`, `fps`, 그 행만 다른 몸 높이 `bodyHeight` — 웅크리게 그려진 행이 커질 때. 파일 이름은 `--source-dir` 기준이라 `../v1/…` 로 앞 판 원본을 쓸 수 있다), `props[]`(시트·격자 칸·폭. `whole: true` 면 칸 안 조각을 다 남긴다 — 기본은 가장 긴 덩어리만이라 나란히 건 액자 둘이 하나로 줄어든다. `screenOff: true` 면 파란 화면을 어둡게 바꾼 `prop/<id>-off` 와 메타 `screen`·`off`. 격자 칸 대신 `box` [x0, y0, x1, y1] 이면 원본 px 상자 안에서 자른다 — v6 거리처럼 시트마다 그림 크기·배치가 달라 칸에 걸칠 때. 아래 `glow`·`windows`·`lifts`), `tiles[]`(반복 타일):

| 키 | 뜻 |
|---|---|
| `crop` | 자를 영역 [x0, y0, x1, y1] (시트 px) |
| `tiles` 또는 `size` | 결과 크기: 타일 수 [가로, 세로] 또는 px [폭, 높이] (한쪽이 null 이면 비율대로) |
| `keyed` | 마젠타를 투명으로 (창 유리가 뚫린 벽). 결과 메타에 투명 행 구간 `glass` |
| `dropRows` | 자를 영역 안에서 뺄 행 구간 [[y0, y1], …] (시트 좌표) — 벽·유리 높이 줄이기 |
| `seamless` | `x`·`y`·`xy`: 그 방향으로 이음매 없이 반복되는 구간만 남긴다 |
| `seamlessBands` | 가로 판자 바닥: 줄마다 따로 가로 구간을 고른다 |
| `inset`·`removeGridLines`·`fillDarkLines` | v0·v1 벽·바닥용 (가장자리 깎기·검은 격자선 지우기·어두운 선 메우기) |
| `tone` | `{ color: [r,g,b], contrast }`: 평균색을 color 로 옮기고 무늬 대비를 contrast 배로 (생성한 카펫이 거칠고 어두울 때) |

| 키 (`props[]`, v6 거리) | 뜻 |
|---|---|
| `glow` | `{ kind: 'glass' }` 밝은 하늘색 유리(150px 이상 덩어리와 그 상자 안 흰 반사 줄) 또는 `{ kind: 'lamp', top }` 위쪽 top 비율 안의 밝고 따뜻한 등 유리만 따뜻한 색으로 칠한 `prop/<id>-glow`(나머지 투명)와 메타 `glow`. 화면이 노을·밤에 색조 없이 그 소품 바로 위에 겹친다 |
| `windows` | `true` 면 바깥과 이어지지 않은 투명 구멍(키를 뺀 마젠타 유리) = 창을 메타 `windows: [{ x, y, w, h, frame }]` 로. `frame` = 구멍 가장자리에서 바깥으로 외곽선 + 밝은 창틀 두께 (세 쪽 중 가운데 값) |
| `lifts` | `{ band: [y0, y1], range: [낮음, 높음] }`: 축소한 그림의 band 줄 구간(의자 다리)에서 고르게 줄을 겹치거나 빼 높이만 바꾼 `prop/<id>-h<높이>` 들과 메타 `lifts: { "<변화>": 프레임 이름 }` ("0" 은 원래 그림). 앉은 사람 엉덩이에 상판을 맞추고 다리는 바닥에 둔다 |

인물이 없는 판(`characters` 없음)은 `spec` 에 `tile` 만 있어도 된다.

타일 메타에는 맨 위·아래 줄 최빈색 `top`·`bottom` 이 같이 들어간다 (Off Duty 하늘을 창밖 그림 위로 잇는 색).

## 인물 색 바꾸기 마스크

```bash
python tools/sprites/mask.py --recipe tools/sprites/recipes/office-v3-recolor.json \
  --atlas web/public/office/office-v3 --preview <미리보기.png>
```

아틀라스 옆에 `<레시피 name>.png`(R = 머리·G = 윗옷 가중치)와 `.json`(인물별 기본색)을 쓴다. 아틀라스는 바꾸지 않는다. 인물 그림을 다시 만들었으면 이것도 다시 돌린다.

방향 판(v5 up·right)은 idle 첫 칸이 정면 판에만 있어 `--sample-atlas web/public/office/office-v5-down` 을 준다: 표본 상자는 정면 셀 좌표, `y`·`exclude` 는 그 방향 셀 좌표다. 레시피 `direction` 은 미리보기 칸을 정한다.

## 퇴근 거리 자리 메타

```bash
python tools/sprites/street_seats.py --recipe tools/sprites/recipes/office-v6-street.json --atlas-dir web/public/office --write
```

인물 아틀라스(office-v5-down·right)에서 옆모습 앉은 높이(`sideSeatLift[상태][인물]` = 의자 높이 변화)와 정면 idle 머리 상자(`headBox[인물]`)를 재 레시피 `jkCorp.street` 에 고쳐 쓴다 (`--write` 없으면 출력만). 의자 레시피 `lifts.range` 가 잰 범위를 못 덮으면 종료 코드 1. 인물 그림을 다시 만들면 이것 → build.py 순서로 돌린다. 규칙은 설계 문서 "퇴근 거리 (v6)".

## 코드로 그리는 그림

`draw_icons.py --out <원본 폴더>/drawn.png`: 머리 위 상태 아이콘(승인 대기 "!"·내 차례 말풍선·작업 중 점 셋 3프레임)과 짝 사이 세로 칸막이. 생성 원본처럼 마젠타 바탕 격자 한 장이라 레시피가 같은 방식으로 자른다 (16~20 도트 px 아이콘은 생성으로 또렷하게 안 나오고, 칸막이는 원근이 틀렸다).

| 키 (인물 → `hair`·`top`) | 뜻 |
|---|---|
| `sample` | idle 첫 칸에서 표본 색을 모을 상자들 [[x0, y0, x1, y1], …] (셀 좌표). 그 부위만 들어가게 작게 잡는다 |
| `y` | 그 부위를 찾을 셀 세로 범위 [y0, y1] (머리와 같은 색 바지 등을 가른다) |
| `tolerance` | 표본 색과의 RGB 거리 한도 (기본은 레시피 최상위 값) |
| `exclude` | 고르지 않을 상자들 (얼굴·안경처럼 색이 비슷한 곳) |

`--preview` 는 인물마다 idle·raise-hand 첫 칸 원본과 마스크(머리 자홍·윗옷 하늘색)를 나란히 그린다. 피부·눈·바지에 색이 묻으면 표본 상자를 줄이거나 `exclude` 를 넣는다.

`draw_blocks.py --source-dir <v5 원본 폴더>`: 칸막이 블록 모듈(`block-pair`·`block-end-right`·`block-end-left`·`block-lead`)을 `blocks.png` 로. 생성한 책상(원근으로 옆면이 비스듬해 이어 붙이면 이음매가 보인다)의 빈 세로 줄을 옆으로 반복해 직사각형으로 펴고 모니터·키보드만 원본에서 옮긴다. 레시피 `office-v5-props.json` 의 책상 칸을 읽으므로 그 레시피를 고친 뒤 이것 → build.py 순서로 돌린다.
