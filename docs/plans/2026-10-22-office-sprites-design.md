# 사무실 도트 스프라이트 설계

사무실을 Graphics 로 그린 16px 도트에서 **생성한 스프라이트(타일 48px, 진한 1px 외곽선·음영 있는 탑다운 3/4)** 로 바꾼다. 시안(2026-10-22)으로 그림체·크기를 확인했고, 사용자가 이 방향으로 단계별 구현을 승인했다.

캐릭터는 부위 레이어(머리·몸·팔을 따로)로 조립하지 않는다. **완성된 인물 프리셋 + 색 바꾸기** 다. 생성 모델이 부위를 맞춰 그리지 못하고, 완성 인물이 그림체가 가장 안정적이었다.

## 단계

| 단계 | 내용 |
|---|---|
| 0 | 규격·파이프라인 (이 문서, `tools/sprites/`, 임시 에셋 `web/public/office/office-v0.*`) |
| 1 | 스프라이트 엔진 교체: Office.tsx 에 도트 모드. 설정으로 클래식/도트 전환, TILE 48·world 1배 |
| 2 | 인물 프리셋 8~10명 × 4상태 + 색 바꾸기. 목록 아바타·Off Duty 머리도 프리셋에서 |
| 3 | 환경: 바닥·벽·창 4시간대·섬 바닥·Focus Zone·Off Duty 거리·소품 |
| 4 | 팀장·파트장 캐릭터 편집 (`hq.json` 의 `characters`) |
| 5 | 다시 꾸미기 (테마·decor) |
| 6 | 클래식 제거 |
| 7 (선택) | 글로 새 인물 생성 |

## 규격

| 항목 | 값 | 이유 |
|---|---|---|
| 아트 타일 | **48px** | 생성 원본의 도트 단위가 앉은 키 약 100px 수준이라 48px 판(몸 108px)이 원본 도트를 거의 그대로 살린다. 32px 판은 얼굴·손이 뭉개졌다 (시안 비교) |
| world 배율 | 기본 **1배**. 확대는 정수 단계(1·2·3배), 축소는 0.5배 하나만 예외 | 정수 배율이어야 도트가 고르다. 0.5배는 nearest 로 한 줄씩 빠져 거칠지만 전체 보기용으로 둔다 (시안에서 읽을 만했다. 표정은 안 읽힌다) |
| 좌표 | 배치는 지금처럼 **타일 단위** (`officeLayout.ts` 그대로). 그릴 때 `× TILE` | 배치·저장 좌표(`hq.json` 의 x·y)를 바꾸지 않는다 |
| 책상 자리 | **2×3 타일 = 96×144** (지금과 같은 2×3) | `DESK_TILES_W/H`·`SEAT_STEP` 그대로 |
| 캐릭터 셀 | **64×128**, 발 기준선 **y=124** (발 아래 끝 픽셀 행 = 123), 발 중심 = 셀 가운데 (x=32), 몸 높이(머리 위 끝 ~ 발 아래 끝, 든 팔 제외) **108** | 모든 인물·상태가 같은 틀이라 상태를 바꿔도 몸이 튀지 않는다. 앉은 몸은 위 끝 y≈16, 든 손은 y≈2~11 |
| 앵커 | 캐릭터 (0.5, 124/128), 소품 (0.5, 1) = 아래 가운데 | JSON 의 `anchor` 로 들어 있다 |
| 가구 폭 | 책상 96, 의자 54, 책장 88, 화분 40 (48px 판 기준) | 시안에서 맞춘 값. 책상이 사람에 비해 조금 작아 보여 3단계에서 다시 본다 |
| 알파 | 0 또는 255 만 (반투명 없음) | 최빈색 축소가 블록 절반 넘게 불투명일 때만 칠한다 |

### 책상 자리 안 배치 (1단계 출발점, 화면 보고 조정)

자리 96×144 안에서 아래부터:

```
y 124..144  이름표 (글자 약 18px). 지금 이름표가 책상 아래 9/48 을 쓰는 것과 같은 비율
y  55..124  책상 그림 (prop/desk 96×69, 아래 끝 = 124)
y -20..108  캐릭터 셀 (셀을 y=-20 에 놓아 기준선이 104 → 발은 책상 뒤에 숨는다)
y  ~20..100 의자 (prop/desk 보다 먼저, 사람 뒤)
```

캐릭터를 위로 20 올리지 않으면 typing 손(셀 y≈75)이 책상 윗면 뒤로 숨는다. 올리면 든 손(셀 y≈2 → 자리 y≈-18)이 윗줄 자리의 이름표와 겹친다. 지금도 말풍선이 윗줄을 덮으므로 허용하되 1단계에서 화면을 보고 정한다.

그리는 순서: 의자 → 캐릭터 → 책상 → 모니터 켜짐 덧그림 → 명패·이름표. 말풍선은 지금처럼 별도 층.

### 상태 매핑

| 세션 | 캐릭터 상태 | 그 밖 |
|---|---|---|
| working | **typing** (8fps 반복) | 모니터 켜짐 |
| needs-approval | **raise-hand** (6fps, 0·1·2·1 반복) | 빨간 말풍선 "! <도구>" (지금 그대로) |
| my-turn | **idle** (앉아서 기다림, 4fps) | 마지막 말 말풍선 (지금 그대로) |
| idle · unknown · ended | **doze** (눈 감고 고개 끄덕, 3fps) | 모니터 꺼짐 |
| 휴식 (attendance break) | 캐릭터 없음 = **빈 의자** | 이름표 흐리게, 모니터 꺼짐, 말풍선 없음 (지금 그대로) |
| 외부 세션 | 같은 캐릭터 | **책상 측판·이름표 밑줄 회색** (지금 그대로. 책상 변형 스프라이트 또는 측판 자리에 회색 덧그림) |

**바뀌는 점**: 지금은 my-turn 도 손을 든다. 도트판에서는 손 들기를 승인 대기에만 쓴다 — 큰 그림에서 손 든 사람이 여럿이면 급한 사람(승인 대기)이 안 보여서다. my-turn 은 말풍선이 있어 여전히 구분된다.

v0 에셋에는 typing·raise-hand 만 있다. 1단계에서 idle·doze 가 없으면 typing 0번 프레임을 멈춰 쓰고(idle), doze 는 같은 프레임을 흐리게 한다 — 2단계에서 생성한다.

## 파일 배치

```
tools/sprites/
  spritelib.py      키 빼기·덩어리 자르기·정규화·최빈색 축소·격자선 지우기·알파 확인 (numpy·Pillow)
  build.py          레시피 → 아틀라스 PNG + JSON + 타일 PNG
  recipes/*.json    무엇을 어디서 잘라 어떤 규격으로 (원본 파일 이름은 --source-dir 기준)
  prompts/          생성 프롬프트 틀 (인물 기준 그림·상태 행·가구·벽/바닥)
  gen.sh            sprite-gen 실행 래퍼 (API 키 env 제거)
web/public/office/  빌드 결과. Vite 가 web/dist/office/ 로 복사하고 서버가 /office/ 로 제공
~/.claude/jk-corp/sprite-src/<판>/   생성 원본 (저장소 밖. 장당 1~2MB 라 커밋하지 않는다)
```

원본은 저장소 밖이므로 원본을 잃으면 그 판은 다시 만들 수 없다 (결과 PNG 는 커밋되어 남는다). 원본 폴더는 판마다 새로 만들고 덮어쓰지 않는다.

## 이름 규칙

- 아틀라스 파일: `<판 이름>.png`·`<판 이름>.json` (예 `office-v0`). 판을 바꾸면 새 이름 → 브라우저 캐시 문제가 없다
- 프레임: `char/<인물 id>/<상태>/<번호>` (번호는 쓴 칸만 0부터 다시 센다), `prop/<id>`
- 애니메이션: `char/<인물 id>/<상태>` → 재생 순서의 프레임 이름 목록 (반복 가능: raise-hand 는 0·1·2·1)
- 상태 이름은 하이픈: `typing`·`raise-hand`·`idle`·`doze` (sprite-gen 안에서는 밑줄 `raise_hand`)
- 반복 타일(바닥·벽)은 아틀라스에 넣지 않고 `<판 이름>-tile-<id>.png` 로 따로 둔다 — TilingSprite 가 아틀라스 일부 텍스처를 반복할 때 이웃 그림이 번질 수 있어서다 (Pixi 8 에서 확인은 안 함)

## 아틀라스 JSON

PixiJS 8 `Spritesheet` 가 그대로 읽는 TexturePacker hash 꼴 + `meta.jkCorp` 확장 (Pixi 는 모르는 meta 키를 무시한다).

```json
{
 "frames": {
  "char/lead/typing/0": { "frame": {"x":2,"y":2,"w":64,"h":128}, "rotated": false, "trimmed": false,
                          "spriteSourceSize": {"x":0,"y":0,"w":64,"h":128}, "sourceSize": {"w":64,"h":128},
                          "anchor": {"x":0.5,"y":0.96875} },
  "prop/desk": { "...": "...", "anchor": {"x":0.5,"y":1} }
 },
 "animations": { "char/lead/raise-hand": ["char/lead/raise-hand/0", "char/lead/raise-hand/1", "char/lead/raise-hand/2", "char/lead/raise-hand/1"] },
 "meta": {
  "image": "office-v0.png", "format": "RGBA8888", "size": {"w":1016,"h":214}, "scale": 1,
  "jkCorp": {
   "spec": {"tile":48, "cell":[64,128], "baseline":124, "bodyHeight":108},
   "animations": { "char/lead/raise-hand": {"fps":6, "loop":true} },
   "tiles": { "floor": {"image":"office-v0-tile-floor.png", "w":144, "h":144} },
   "props": { "prop/desk": { "screen": {"x":59,"y":6,"w":26,"h":13} } }
  }
 }
}
```

읽기: `const sheet = await Assets.load('/office/office-v0.json')` → `sheet.textures[...]`, `sheet.animations[...]` (AnimatedSprite 에 그대로), fps 는 `sheet.data.meta.jkCorp.animations` 에서 (`animationSpeed = fps / 60`). 패킹은 선반 방식, 칸 사이 2px 투명, 회전·트림 없음.

## 생성 절차

1. **구독 로그인만.** sprite-gen `--provider codex`(ChatGPT 로그인). 실행은 `tools/sprites/gen.sh` — `OPENAI_API_KEY`·`XAI_API_KEY`·`ANTHROPIC_API_KEY`·`ELEVENLABS_API_KEY` 와 대체 provider 설정을 env 에서 뺀다. codex 를 못 쓰면 sprite-gen 이 종료 코드 75 로 묻는데, 과금 경로(openai)를 고르지 말고 멈춘다
2. **인물은 글로 자세히.** 기준 그림만 붙이면 인물이 바뀐다. `--description` 에 머리 모양·색, 눈, 피부, 옷(색·종류·겹친 옷깃), 신발, 장신구와 "없는 것"(no tie, no glasses …)까지 쓴다. 스타일 참고로 기존 인물 기준 그림을 `--ref` 로 붙이고 "같은 그림체, 다른 사람" 이라고 쓴다 (`prompts/character-base.txt`)
3. **상태 행**: 기준 그림 → `sprite-gen prepare --request tools/sprites/prompts/character-rows.json` → `gen-set --provider codex` (상태당 1회, 4프레임 가로 한 줄). 원본은 `run/raw/<상태>.png.raw.png`
4. **모니터 방향**: 사람이 책상 뒤에 앉아 앞을 본다. 모니터는 사람 옆(책상 오른쪽 끝)에 두고 얼굴을 가리지 않게 한다. 뒷면이 보이게 시켰지만 v0 는 화면이 앞을 봤다 — 화면이 앞이면 켜짐 표시를 덧그리기 쉬워 v0 는 그대로 쓴다
5. **정규화는 build.py 로만.** sprite-gen `extract` 결과는 쓰지 않는다: 프레임마다 셀 높이에 맞춰 늘려 상태마다 키가 달라지고, lanczos 축소라 반투명 가장자리가 생긴다
6. **축소는 최빈색(블록 다수 색)**. 확대·화면 표시는 nearest (`TextureStyle.defaultOptions.scaleMode = 'nearest'`)
7. **알파 확인**: build.py 가 전부 투명·전부 불투명·반투명 픽셀을 잡으면 쓰지 않고 실패한다. 결과 PNG 를 눈으로도 본다
8. 생성 1회 ≈ 30~55초. 독립적인 것은 동시에 돌린다 (시안: 3건·4건 동시에 각 약 1분)

## 시안에서 배운 문제와 대응

| 문제 | 대응 |
|---|---|
| 기준 그림만 붙이면 다른 사람이 나온다 | 인물을 글로 자세히 (위 2) |
| 상태마다 배율이 달라진다 (든 팔까지 키로 잼) | 발 기준선 고정, 발 중심 ±18% 띠 안에서 머리 위 끝을 재고, 한 상태 안에서는 배율 하나(중앙값) |
| raise-hand 4번째 칸이 반대 팔 (두 인물 모두) | 레시피 `use` 로 빼고 0·1·2·1 로 돈다. 프롬프트에 "Never switch to the other arm" 을 넣었다 (효과 미확인) |
| 같은 인물인데 행마다 머리색·눈매가 조금 다르다 (팀원 typing 은 푸른 검정·날카로운 눈) | 2단계에서 행을 다시 생성하거나 recolor 로 머리색을 맞춘다. 같은 행 안에서는 일정했다 |
| 흰 배경을 크로마로 빼다 전부 투명 (이전 시험) | 마젠타 배경으로 생성, 키는 build.py 가 직접 빼고 알파를 검사 |
| 벽·바닥을 타일 경계 검은 선과 함께 그린다 | 프롬프트에 "Do NOT draw tile boundaries" 추가. v0 는 선을 지워 이었지만 바닥에 점선 이음매, 벽에 옅은 세로선이 남았다 (3단계에서 다시 생성) |
| 시트 칸 밖 떨어진 선(책상 아래 가로선) | 가장 긴 덩어리만 남긴다 (`main_piece`) |
| 모니터가 앞을 봤다 | 위 4 |
| sprite-gen extract 의 lanczos 맞춤 | 위 5 |

## 라이선스

- 에셋은 우리가 sprite-gen 으로 ChatGPT 구독(codex image_gen) 에서 생성한 것이다. 다른 사람의 에셋·폰트를 가져오지 않았다
- OpenAI 이용 약관에는 출력물의 소유권을 사용자에게 넘긴다는 조항이 있다고 알고 있지만 **이번에 원문을 확인하지 못했다** (약관 페이지가 자동 조회를 막았다). 적용 범위(ChatGPT 구독으로 만든 이미지인지), 다른 사용자도 비슷한 출력을 받을 수 있다는 단서, 저작권 등록 가능성은 **미확인**
- sprite-gen 자체는 Apache-2.0 (저장소 `LICENSE`·SKILL.md 메타). 생성물에는 sprite-gen 라이선스가 붙지 않는다고 보지만 확인하지 않았다
- 사내 도구라 외부 배포 계획은 없다. 배포하게 되면 위 미확인 항목을 먼저 확인한다
