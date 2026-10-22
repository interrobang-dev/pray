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
- 다 만든 뒤 `npm run build` 해야 web/dist 에 들어가 화면에 반영된다

## 생성

```bash
SPRITE_GEN=<sprite-gen 실행 파일> bash tools/sprites/gen.sh gen --provider codex --prompt-file <프롬프트> --ref <스타일 참고 그림> --out <원본.png>
```

`gen.sh` 는 과금 API 키(`OPENAI_API_KEY` 등)를 env 에서 빼고 실행한다. 프롬프트 틀은 `prompts/` (`{{DESCRIPTION}}` 등은 손으로 채운다). 캐릭터 상태 행은 `sprite-gen prepare --request prompts/character-rows.json --description "<사람 글 묘사>"` → `gen-set --provider codex` 로 만들고, `raw/<상태>.png.raw.png` 를 원본 폴더에 옮겨 레시피에 적는다.

## 레시피

`recipes/*.json`. `spec`(타일·셀·기준선·몸 높이), `characters[].rows[]`(`strip`+`count` 또는 `frames` 목록, 쓸 칸 `use`, 재생 순서 `sequence`, `fps`), `props[]`(시트·격자 칸·폭), `tiles[]`(반복 타일):

| 키 | 뜻 |
|---|---|
| `crop` | 자를 영역 [x0, y0, x1, y1] (시트 px) |
| `tiles` 또는 `size` | 결과 크기: 타일 수 [가로, 세로] 또는 px [폭, 높이] (한쪽이 null 이면 비율대로) |
| `keyed` | 마젠타를 투명으로 (창 유리가 뚫린 벽). 결과 메타에 투명 행 구간 `glass` |
| `dropRows` | 자를 영역 안에서 뺄 행 구간 [[y0, y1], …] (시트 좌표) — 벽·유리 높이 줄이기 |
| `seamless` | `x`·`y`·`xy`: 그 방향으로 이음매 없이 반복되는 구간만 남긴다 |
| `seamlessBands` | 가로 판자 바닥: 줄마다 따로 가로 구간을 고른다 |
| `inset`·`removeGridLines`·`fillDarkLines` | v0·v1 벽·바닥용 (가장자리 깎기·검은 격자선 지우기·어두운 선 메우기) |

타일 메타에는 맨 위·아래 줄 최빈색 `top`·`bottom` 이 같이 들어간다 (Off Duty 하늘을 창밖 그림 위로 잇는 색).
