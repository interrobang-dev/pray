# 사무실 도트 스프라이트 설계

사무실을 Graphics 로 그린 16px 도트에서 **생성한 스프라이트(타일 48px, 진한 1px 외곽선·음영 있는 탑다운 3/4)** 로 바꾼다. 시안(2026-10-22)으로 그림체·크기를 확인했고, 사용자가 이 방향으로 단계별 구현을 승인했다.

캐릭터는 부위 레이어(머리·몸·팔을 따로)로 조립하지 않는다. **완성된 인물 프리셋 + 색 바꾸기** 다. 생성 모델이 부위를 맞춰 그리지 못하고, 완성 인물이 그림체가 가장 안정적이었다.

## 단계

| 단계 | 내용 |
|---|---|
| 0 | 규격·파이프라인 (이 문서, `tools/sprites/`, 임시 에셋 `web/public/office/office-v0.*`) |
| 1 | 스프라이트 엔진 교체: Office.tsx 에 도트 모드. 설정으로 클래식/도트 전환, TILE 48·world 1배 |
| 2 | 인물 프리셋 8~10명 × 4상태 + 색 바꾸기. 목록 아바타·Off Duty 머리도 프리셋에서 (v1 인물 9명 × 4상태·세션별 고르기·색 바꾸기. 목록 아바타·Off Duty 머리는 그 인물 idle 첫 칸의 머리 44×44). v3 에서 9명을 더해 18명(리더 4·팀원 14, 남녀 각 9) |
| 3 | 환경: 바닥·벽·창 4시간대·섬 바닥·Focus Zone·Off Duty 거리·소품 (v2 로 했다. 아래 "환경 (v2)") |
| 4 | 팀장·파트장 캐릭터 편집 (`hq.json` 의 `characters` = 세션 ID → `{ id, hair, top }`). ✎ 이름 모달에서 인물(지금 18명) 중 고르기와 머리(기본 + 8색)·윗옷(기본 + 10색) 색 바꾸기까지 했다. 색 바꾸기는 `tools/sprites/mask.py` 마스크(인물마다 표본 상자·세로 범위를 레시피에 적는다 — 위치만으로는 피부·바지가 섞였다) + 밝기 차이를 지키는 HSL 바꾸기 (`web/src/recolor.ts`) |
| 5 | 꾸미기. 소품 20종 office-v4 아틀라스는 있고 화면은 읽지 않는다 (시드로 무작위로 놓는 꾸미기·테마는 쓰지 않는다). 소품을 정해진 자리에 놓는 꾸미기에서 다시 쓴다. 아래 "꾸미기 소품 (v4)" |
| 6 | 클래식 제거 (했다: Graphics 클래식 렌더러·클래식/도트 전환 설정과 헤더 버튼·avatar.ts 얼굴 아바타를 지웠다. 아틀라스를 못 읽으면 사무실 칸에 "사무실 그림을 읽지 못함 · 새로고침", 목록 아바타는 빈 칩) |
| 7 (선택) | 글로 새 인물 생성 |
| 8 | ZEP 스타일 4방향 사무실: 칸막이 블록(윗줄 아래를 봄·아랫줄 위를 봄)·지휘자 옆자리(오른쪽을 봄)·집중공간 부스·라운지. 그림은 office-v5 로 했다(아래 "4방향 (v5)"). 화면 연결은 아직이다 (화면은 v2·v3·v4 를 읽는다) |

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

1단계에서 화면을 보고 정한 값 (`Office.tsx` 의 `DOT_DESK`): 셀 y=-20(기준선 104) 그대로. 윗줄이 있으면 든 손이 윗줄 이름표 왼쪽 끝("[" 자리)을 덮지만 이름은 읽힌다 (아래 책상을 나중에 그려 손이 이름표 위다. 2배 화면으로 확인). 사람 발 중심 x=42 (키보드 앞, 모니터 화면 x 59.. 과 얼굴이 안 겹친다). 의자 아래 끝 y=100. 이름표는 124..144 에 글자 14px (이름표 20px 안에 여유를 두려고. 18px 는 시험하지 않았다). 말풍선(`BUBBLE_SIZE`, 도트 px)의 꼬리 끝은 도트 머리 위(아트 -2)로. 외부 세션 회색 측판은 책상 왼쪽 측판 자리(책상 기준 x 4..10, y 42..66)에 덧그림, 팀장 명패는 앞판 가운데(책상 기준 y 46).

그리는 순서: 의자 → 캐릭터 → 책상 → 모니터 켜짐 덧그림 → 명패·이름표. 말풍선은 지금처럼 별도 층.

### 상태 매핑

| 세션 | 캐릭터 상태 | 그 밖 |
|---|---|---|
| working | **typing** (8fps 반복) | 모니터 켜짐 |
| needs-approval | **raise-hand** (6fps, 0·1·2·1 반복) | 빨간 말풍선 "! <도구>" (지금 그대로) |
| my-turn · idle · unknown, 차례가 끝난 지(`Session.turnEndedAt`) 30분 미만 또는 시각 모름 | **idle** (앉아서 기다림, 4fps) | my-turn 이면 마지막 말 말풍선 (지금 그대로) |
| my-turn · idle · unknown, 차례가 끝난 지 30분 이상 · ended | **doze** (눈 감고 고개 끄덕, 3fps) | 모니터 꺼짐 |
| 휴식 (attendance break) | 캐릭터 없음 = **빈 의자** | 이름표 흐리게, 모니터 꺼짐, 말풍선 없음 (지금 그대로) |
| 외부 세션 | 같은 캐릭터 | **책상 측판·이름표 밑줄 회색** (지금 그대로. 책상 변형 스프라이트 또는 측판 자리에 회색 덧그림) |

**바뀌는 점**: 지금은 my-turn 도 손을 든다. 도트판에서는 손 들기를 승인 대기에만 쓴다 — 큰 그림에서 손 든 사람이 여럿이면 급한 사람(승인 대기)이 안 보여서다. my-turn 은 말풍선이 있어 여전히 구분된다.

v0 에셋에는 typing·raise-hand 만 있고 v1 은 넷 다 있다. 아틀라스에 idle·doze 가 없으면 typing 0번 프레임을 멈춰 쓰고(idle), doze 는 같은 프레임을 흐리게 한다 — 2단계에서 생성한다. 흐리게는 반투명이 아니라 tint(어둡게)다 — 반투명이면 뒤 의자가 비친다. 아틀라스에 `char/<인물>/idle`·`doze` 애니메이션이 생기면 코드 수정 없이 그것을 쓴다.

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

## 인물 프리셋 (v1)

원본 `~/.claude/jk-corp/sprite-src/v1/` (기준 그림 `<인물>-base.png`, 행 `<인물>-<상태>.png`, 쓴 묘사·요청·행 프롬프트는 `prompts/`), 레시피 `tools/sprites/recipes/office-v1.json`. 레시피의 `pool` 이 아틀라스 `meta.jkCorp.characters` 로 들어가고 화면은 세션 ID 해시로 풀 안에서 고른다 (`web/src/dotCharacter.ts`).

| id | 풀 | 모습 |
|---|---|---|
| lead | lead | 남, 갈색 머리, 하늘색 셔츠·남색 넥타이 (v0 팀장. typing·raise-hand 는 v0 행) |
| lead-suit | lead | 여, 낮은 쪽머리, 갈색 피부, 회색 정장·금색 명찰 |
| member | member | 여, 검은 단발, 머스터드 니트 (v0 팀원. raise-hand 는 v0 행) |
| hoodie | member | 남, 검은 곱슬, 짙은 갈색 피부, 초록 후드 |
| flannel | member | 남, 금발 투블럭, 동그란 안경, 빨간 체크 셔츠 |
| ponytail | member | 여, 구릿빛 붉은 하이 포니테일, 주근깨, 라벤더 블라우스 |
| cardigan | member | 남, 똥머리·짧은 수염, 올리브 피부, 남색 가디건 |
| turtleneck | member | 여(50대), 은발 단발, 안경, 청록 터틀넥 |
| afro | member | 여, 둥근 아프로, 짙은 갈색 피부, 주황 줄무늬 |

생성 46회 = 기준 그림 7 + 상태 행 32(새 인물 7 × 4, v0 둘의 idle·doze) + 다시 생성 7(afro raise-hand·doze, ponytail doze, flannel idle, member typing 2번·doze). raise-hand 4번째 칸이 반대 팔인 인물(lead·member·flannel·cardigan·turtleneck)은 `use` 로 뺐다. 색 바꾸기(recolor)는 하지 않았다 — 다시 생성으로 맞췄다.

## 인물 프리셋 추가 (v3)

화면이 읽는 인물·책상·의자 아틀라스는 `office-v3` 다 (레시피 `tools/sprites/recipes/office-v3.json`, 마스크 `recipes/office-v3-recolor.json`). v1 9명은 v1 원본을 그대로(레시피의 `../v1/…` 경로) 다시 묶어 v1 과 칸 픽셀이 같고, 새 9명 원본은 `~/.claude/jk-corp/sprite-src/v3/` (`<인물>-base.png`·`<인물>-<상태>.png`, 묘사·요청·스크립트는 `prompts/`). 책상·의자는 v1 의 `props-sheet.png` 그대로이고 v1 의 책장·화분·벽·바닥은 넣지 않았다 (화면은 v2 것을 쓴다). 인물 메타에 `gender`(`male`·`female`)가 있다 — 레시피 인물의 `gender` 를 build.py 가 그대로 옮긴다.

| id | 풀 | 성별 | 모습 |
|---|---|---|---|
| lead | lead | 남 | (v1) |
| lead-suit | lead | 여 | (v1) |
| member · hoodie · flannel · ponytail · cardigan · turtleneck · afro | member | 여·남·남·여·남·여·여 | (v1) |
| lead-vest | lead | 남 | 40대, 옆가르마 짙은 갈색 머리·짧은 수염, 갈색 피부(남아시아), 와인색 니트 조끼 + 흰 셔츠 |
| lead-blazer | lead | 여 | 40대, 어깨 길이 웨이브 밤색 머리·옆 앞머리, 밝은 피부, 금 목걸이, 자주색 블레이저 + 검은 상의 |
| denim | member | 남 | 20대, 회색 비니, 황갈색 피부(라틴계), 하늘색 청재킷 + 흰 티, 빨강·흰 운동화 |
| professor | member | 남 | 60대, 정수리 대머리·옆머리 흰색, 흰 콧수염, 갈색 코듀로이 재킷(팔꿈치 덧댐) + 크림 터틀넥 |
| headphones | member | 남 | 20대 동아시아, 뾰족한 검은 머리, 목에 건 검은 헤드폰, 보라 맨투맨, 회색 카고 바지 |
| polo | member | 남 | 30대, 짧은 트위스트 머리·가는 콧수염, 짙은 갈색 피부, 연노랑 폴로, 회색 조거 |
| hijab | member | 여 | 분홍빛 히잡(머리 안 보임), 밝은 황갈색 피부, 베이지 긴 튜닉, 짙은 갈색 바지 |
| overalls | member | 여 | 20대, 분홍 픽시컷, 밝은 피부, 검은 데님 멜빵바지 + 흰 긴팔 |
| braids | member | 여 | 20대, 긴 박스 브레이드, 갈색 피부, 산호색 맨투맨, 연청 청바지 |

생성 45회 = 기준 그림 9 + 상태 행 36. 다시 생성은 없다. typing·doze 는 v1 에서 옆으로 앉은 것을 바로잡은 "front view" 요청(`req-typing-front`·`req-doze-front`)을 처음부터 썼고 옆으로 앉은 행은 나오지 않았다. 색 바꾸기 마스크는 새 9명 모두 만들었다 (팀장만 고르기를 열지만, 마스크에 없는 인물은 목록 머리 그림이 안 나와서다). lead-vest 는 수염도 머리색을 따라간다 (같은 색이라 일부러 둠).

배운 점:

| 문제 | 대응 |
|---|---|
| raise-hand 4번째 칸이 반대 팔 (새 9명 중 7명, denim 은 3번째 칸) | 지금까지처럼 `use` 로 빼고 0·1·2·1 로 돈다. 프롬프트의 "Never switch to the other arm" 은 효과가 없다 |
| 행 하나를 웅크린 자세(짧은 다리·큰 머리)로 그려, 머리~발을 규격 108 에 맞추면 그 상태만 몸이 커지고 든 손이 셀 위에서 잘린다 (professor raise-hand·doze, polo raise-hand) | 레시피 행에 `bodyHeight` 를 더 작게 (98·100·100) 줘서 다른 상태와 같은 크기로 — 그림을 나란히 놓고 맞췄다. 숫자(다리 폭·머리 폭)로 재 보았지만 자세 차이 때문에 들쭉날쭉했다 |
| 행마다 머리 모양이 조금씩 다르다 (polo typing·raise-hand 는 짧은 곱슬, idle·doze 는 조금 긴 트위스트) | 같은 사람으로 읽혀 그대로 두었다 |
| 마스크: 짙은 갈색 피부와 짙은 머리·수염 색이 가깝다 (lead-vest·polo 머리에 얼굴이 섞임), 검은 안쪽 옷이 블레이저와 섞임 | 그 인물만 `tolerance` 를 24~30 으로 낮추고 얼굴·안쪽 옷을 `exclude` |

## 환경 (v2)

원본 `~/.claude/jk-corp/sprite-src/v2/` (프롬프트는 `prompts/<이름>.txt` 와 그것을 만든 `prompts/write_prompts.py`), 레시피 `tools/sprites/recipes/office-v2.json`, 결과 `web/public/office/office-v2.*`. 스타일 참고로 v0 `props-sheet.png` 를 `--ref` 로 붙였다. 인물·책상·의자는 v1 아틀라스를 그대로 읽고 v2 에는 환경만 넣었다 (v1 을 다시 묶으면 1.2MB 가 한 벌 더 생긴다).

| 원본 | 결과 | 자르는 법 |
|---|---|---|
| `wall.png` 창 유리를 마젠타로 그린 벽 띠 | 타일 `wall` 144×120 (유리 투명) | 창틀 기둥 가운데 → 다음 기둥 가운데 한 칸 (양끝이 기둥 반쪽이라 이어진다). `dropRows` 로 벽·유리 행을 빼 높이 120 = WALL_H × 3 |
| `views.png` 같은 스카이라인 4시간대를 위아래로 | 타일 `view-morning·day·dusk·night` 432×72 | 패널마다 자른다. 건물이 양끝에 닿지 않게 시켜 가로로 저절로 이어진다 |
| `floor.png` 나무 바닥 | 타일 `floor` 144×144 | 세로 `seamless`, 가로는 판자 줄마다 따로 (`seamlessBands`) |
| `group-floor.png`·`island-rug.png`·`focus-carpet.png` | 타일 144×144 | `seamless: xy` |
| `street.png` 보도 띠 | 타일 `street` 504×96 | 판석 이음선부터 6장 (주기 탐색은 경계에 좁은 판석을 남겼다) |
| `houses.png` 4열(시간대) × 집·가로등 | `prop/house-<시간대>` 132, `prop/street-lamp-<시간대>` 24 | 격자 칸 |
| `props.png` | `prop/plant-large` 42·`plant-small` 24·`bookshelf-tall` 44·`bookshelf-low` 96 | 격자 칸 |
| `booth.png` | `prop/booth` 138·`desk-lamp` 30·`mug` 16·`headphones` 24 | 격자 칸 |

생성 19회 = 10종 × 1 + 다시 9회. 첫 10회 중 9회는 C 드라이브가 꽉 차 codex 가 image_gen 을 못 돌린 실패("image_gen tool never ran")였고 같은 프롬프트로 다시 돌려 그대로 썼다. 다시 그린(내용 때문에 다시 생성한) 것은 없다.

배운 점:

| 문제 | 대응 |
|---|---|
| "seamless tileable" 이라고 시켜도 가장자리가 안 이어진다 | `seamless_crop`: 열(행) s 와 s+p 가 가장 닮은 구간 [s, s+p) 를 고른다. 무늬 카펫·러그는 이것으로 이음매가 없어졌다 |
| 가로 판자는 한 구간을 통째로 고르면 줄마다 판자 색이 경계에서 끊긴다 | `seamless_bands_x`: 어두운 가로 이음선으로 띠를 나눠 띠마다 고른 뒤 가장 긴 폭으로 늘려 쌓는다 |
| 벽 창에 시간대 4종을 그리면 벽·창틀이 판마다 달라진다 | 벽은 유리를 마젠타로 한 장만, 창밖은 한 장에 4시간대를 같은 스카이라인으로 그리게 해 뒤에 깐다 (스카이라인이 4판 모두 같게 나왔다) |
| 9-slice(파티션·테두리)는 생성으로 맞추기 어렵다 | 바닥만 생성 타일, 테두리·이름표는 도트 px Graphics |
| 해상도 3 으로 그린 12px 한글을 1배에서 3배 축소하면 가는 획이 빠진다 | 도트 px 글자 resolution = 지금 배율 (`dotTextResolution`) |

## 꾸미기 소품 (v4)

원본 `~/.claude/jk-corp/sprite-src/v4/` (시트 4장 `floor-a`·`floor-b`·`wall`·`theme` 와 `prompts/`(프롬프트·생성 스크립트·로그)), 레시피 `tools/sprites/recipes/office-v4.json`, 결과 `web/public/office/office-v4.*` (소품만). 스타일 참고로 v2 `props.png` 를 `--ref` 로 붙였다. 생성 4회 = 시트 4장 × 1 (다시 생성 없음).

| 시트 | 격자 | 소품 (폭, 도트 px) |
|---|---|---|
| `floor-a.png` | 3×2 | water-cooler 30·coffee-machine 40·trash-bin 20·plant-snake 30·floor-lamp 26·lockers 60 |
| `floor-b.png` | 2×2 | sofa 110·armchair 50·coat-rack 34·printer 44 |
| `wall.png` (앞에서 본 벽걸이) | 3×2 | wall-landscape 84·wall-poster 44·wall-clock 34·wall-whiteboard 100·wall-corkboard 84·wall-photos 64 (`whole`: 떨어진 액자 둘을 한 소품으로) |
| `theme.png` | 2×2 | xmas-tree 44·monstera 54·cafe-sign 36·gifts 38 |

소품을 놓을 때 지킬 것:

| 문제 | 정한 것 |
|---|---|
| 벽 타일은 거의 전부 창이라 액자를 걸 벽이 없다 | 장식을 거는 창 칸만 유리 자리를 벽색으로 메운다 (이웃 칸은 비워 창이 남는다) |
| 소품이 책상·이름표·말풍선·끌기 영역을 가리면 안 된다 | 소품이 차지하는 칸 = 그림 크기를 타일로 올린 것, 섬 둘레 1타일과 그룹 위 줄·파티션·걸레받이 줄은 쓰지 않는다. 벽 앞 줄의 키 큰 소품만 벽 위로 올라간다 |

## 4방향 (v5)

ZEP 스타일 배치(칸막이 블록에서 윗줄은 아래를, 아랫줄은 위를 보고 지휘자는 오른쪽을 본다)용 판. 원본 `~/.claude/jk-corp/sprite-src/v5/` (인물 격자 `chars/<id>-<up|right>.png`, 가구 시트 `v5-desks`·`v5-lounge-a`·`v5-lounge-b`·`v5-desk-items`, 시안에서 쓴 `chairs`·`chair-back`·`lounge`·`floors`, 코드로 그린 `drawn.png`, `prompts/`(프롬프트·`genchar.sh`·`make_recipe.py`·`make_mask_recipes.py`·`overrides.json`·`mask-fix.json`·`calls.log`)).

| 아틀라스 | 레시피 | 내용 |
|---|---|---|
| `office-v5-down` | `office-v5-down.json` | 정면 18명 × 4상태. v3 와 같은 원본·같은 칸 (프레임 이름도 v3 그대로 `char/<id>/<상태>`) |
| `office-v5-up` | `office-v5-up.json` | 뒷모습 18명 × typing·raise-hand·idle·doze. `char/<id>/up/<상태>` |
| `office-v5-right` | `office-v5-right.json` | 옆모습(오른쪽을 봄) 18명 × 4상태. `char/<id>/right/<상태>`. left 는 좌우 반전 |
| `office-v5-props` | `office-v5-props.json` | 책상·의자·칸막이·부스·라운지·책상 소품·상태 아이콘·v4 소품 7개, 타일 `corridor`·`desk-carpet`·`focus-navy`, `meta.jkCorp.seat`(자리 안 좌표·겹침 순서)·`icons`·`items`·`islandBase` |
| `office-v5-<down·up·right>-recolor` | `office-v5-*-recolor.json` | 방향별 색 바꾸기 마스크. up·right 는 `mask.py --sample-atlas office-v5-down` 으로 정면에서 표본 색을 모은다 |

**아틀라스 크기**: 방향별로 나누고(한 장에 넣으면 약 1000×9500 이라 텍스처 한도에 걸릴 수 있다) **255색 팔레트 PNG**(레시피 `palette: 255`, median cut, 디더링 없음)로 저장한다. 도트 축소(블록 최빈색 묶음의 중앙값)가 색을 수십만 개 만들어 RGBA 로는 v3 한 장이 2.3MB 였다 — 255색으로 줄여도 평균 색 차이 3.6 이라 눈으로 구분되지 않았다. 인물 세 장 약 0.53~0.60MB, props 0.08MB, 마스크 세 장 0.17~0.24MB (마스크는 RGBA 그대로. 값이 가중치라 팔레트로 줄이지 않는다), JSON 합 0.39MB. 전부 약 2.8MB (v3 한 장 2.3MB 보다 조금 크다).

### 셀·앵커

| 방향 | 셀 | 발 기준선 | 가로 기준 (`spec.anchorX`) | 배율 |
|---|---|---|---|---|
| down | 64×128 | y 124 | 발 중심 x 32 | 몸 높이 108 (v3 그대로) |
| up | **88×128** | y 124 | 발 중심 x 44 | 인물마다 레시피 `scale`: 정면 idle 과 견준 세 잣대(머리 폭·몸통 폭·키 × 0.8)의 중앙값 |
| right | **88×128** | y 124 | **등(하체 왼쪽 끝) x 18** (`spec.backX`) — 발은 무릎 앞이라 상태마다 흔들린다 | 키 비율 × 0.88 |

뒷모습·옆모습은 64 폭으로는 팔꿈치·든 손·뒤로 넘긴 머리가 잘려 88 로 했다 (professor·turtleneck 뒷모습 raise-hand 몇 칸은 88 에서도 손끝 1~2px 이 오른쪽 끝에 닿는다). 한 잣대만 쓴 배율은 대머리(professor)·아프로·긴 머리·넓은 어깨 정장에서 크게 틀렸고, 18명 시트를 보고 5명(`lead`·`lead-suit`·`member`·`turtleneck`·`afro` 의 up)만 `overrides.json` 의 `scaleMul` 로 더 맞췄다.

### 자리 안 배치와 겹침 순서 (자리 96×144, 데모로 확인한 출발점 = `office-v5-props.json` 의 `meta.jkCorp.seat`)

| 방향 | 그리는 순서 | 좌표 (스프라이트 왼쪽 위) | 손 |
|---|---|---|---|
| down | 의자 → 인물 → `desk-down` → 책상 소품 → 아이콘 | 의자 (25, 60), 셀 (16, 27), 책상 (0, 87) | 키보드 손(셀 y≈75)이 책상 윗면(자리 y 87~)·모니터 뒷면 뒤로 숨는다. 머리·어깨만 모니터 위로 보인다. 발이 자리 아래로 6px 나오지만 아랫자리 책상이 덮는다 |
| up | `desk-up`(켜짐·꺼짐) → 책상 소품 → 인물 → `chair-up` → 아이콘 | 책상 (0, 0), 셀 (4, −18), 의자 (25, 77) | 팔꿈치를 내린 손이 몸 양옆, 책상 앞쪽에 보인다. 머리가 모니터 아래쪽을 조금 가린다 (참고 그림과 같다) |
| right | `chair-right` → `desk-right` → 인물 → `desk-right` 의 y 52 아래를 한 번 더 → 아이콘 | 의자 (0, 52), 책상 (48, 28), 셀 (−6, −2) | 손은 키보드 위에 보이고 무릎·허벅지는 책상 뒤로 숨는다. 책상을 통째로 인물 위에 그리면 손이 숨고("허공에 타이핑"이 아니라 아예 안 보임), 통째로 아래에 그리면 무릎이 책상 위에 올라온다 |
| booth | `booth-navy` → 인물(up) → `chair-up` → 아이콘 | 부스 (0, 0) 112×88, 셀 (12, 14), 의자 (33, 109) | up 과 같다 |

짝 사이 세로 칸막이 `partition-v`(8×144)는 짝 경계 x−4, 윗자리 y 66 에 하나 (윗자리 책상 위 끝 ~ 아랫자리 책상 아래 끝). 가로 칸막이는 `desk-up` 위 끝에 들어 있다. 섬 받침은 그림 없이 Graphics `#c4c8cf` (데스크존 카펫 평균 `#ced1d6` 보다 한 단 진함).

### 상태·켜짐·아이콘

- 상태 행은 네 방향 모두 typing(8fps)·raise-hand(6fps)·idle(4fps)·doze(3fps). up·right 의 raise-hand 는 네 칸이 모두 같은 팔이라 0·1·2·3 그대로 돈다 (down 은 v3 그대로 0·1·2·1 등)
- 모니터 켜짐: 레시피 prop 의 `screenOff: true` 면 build.py 가 밝은 파랑(화면) 가장 큰 덩어리를 어두운 회색으로 바꾼 `prop/<id>-off` 와 메타 `screen`(화면 사각형)·`off` 를 만든다 — `desk-up`·`desk-right`·`booth-navy`. 켜짐은 원본 그대로(파란 화면)라 텍스처만 바꾸면 된다. `desk-down` 은 모니터 뒷면만 보여 꺼짐 그림이 없다 (켜짐 표시가 필요하면 화면 코드가 덧그린다)
- 머리 위 상태 아이콘(18×15, 꼬리 끝 왼쪽 아래)은 생성하지 않고 `tools/sprites/draw_icons.py` 로 찍는다: `icon-approval`(빨강 "!"), `icon-my-turn`(흰 말풍선 글 줄), `icon-working-0~2`(점 셋 차례로, 4fps). 같은 스크립트가 `partition-v` 도 그린다 (생성하면 칸막이 원근이 틀렸다)
- 책상 위 소품 8개 `item-*`(13~18 도트 px): 머그 둘·펜꽂이·서류·메모지·다육이·공책·탁상시계

### 생성 (40회)

인물 36회 = 18명 × (up, right), 한 장에 **4행(상태) × 4칸 격자**로 그린다 (안내 그림 `guide-4x4.png` 1024×1536, 참고 그림 = 그 인물의 v3 정면 4상태 첫 칸을 4배로 + 서 있는 기준 그림). 상태마다 따로 그리던 v1·v3 보다 한 장 안의 12~16칸이 같은 사람으로 일정하다. 다시 생성은 없다. 가구 4회 = 책상·칸막이, 라운지 둘, 책상 소품 (스타일 참고 = 시안의 의자·원탁·부스 시트). 시안(2026-10-23) 9회는 따로 — 의자 3방향·원탁·부스·바닥 셋은 시안 원본을 그대로 쓴다.

| 문제 (시안) | 대응 |
|---|---|
| 뒷모습 typing 손이 귀 옆에 든 것처럼 보였다 | 요청에 "팔꿈치는 허리 높이, 손은 어깨 아래 몸 양옆, 머리·귀 옆이 아님" — 손이 가슴 높이로 내려왔다 |
| 옆모습 idle 이 typing 과 같았다 | "손을 허벅지·무릎 위에" — 18명 모두 무릎에 손을 얹었다 |
| 흰 타일·카펫이 거칠고 어둡다 | 타일 `tone`(평균색을 지정 색으로, 무늬 대비 × 0.22) |
| 생성한 세로 칸막이가 옆에서 본 판처럼 기울었다 | 코드로 그림 (`draw_icons.py`) |
| v4 소파(청록)·안락의자(겨자)가 흰·남색 톤과 안 맞는다 | 다시 그렸다 (`sofa`·`armchair`). 정수기·커피머신·휴지통·복합기·시계·화이트보드·풍경화는 그대로 v5-props 에 넣었다 (`../v4` 원본) |

마스크: up·right 의 세로 범위는 기본값(`make_mask_recipes.py` 의 `DEFAULT_Y`) + 인물별 고침(`mask-fix.json`). 옆모습 윗옷은 얼굴 상자(셀 30..72, 24..62)를 늘 뺀다 — 피부가 윗옷 표본과 가까운 인물이 많았다 (머리에서는 빼지 않는다: 앞머리가 같이 빠져 반만 바뀐다). 남은 것: overalls 는 윗옷에 검은 멜빵바지까지 들어가고(정면과 같다), lead-vest 수염은 머리색을 따른다(정면과 같다), lead-suit 뒷모습 쪽머리 일부는 윗옷에 들어간다.

## 이름 규칙

- 아틀라스 파일: `<판 이름>.png`·`<판 이름>.json` (예 `office-v0`). 판을 바꾸면 새 이름 → 브라우저 캐시 문제가 없다
- 프레임: `char/<인물 id>/<상태>/<번호>` (번호는 쓴 칸만 0부터 다시 센다), 방향 판(v5 up·right)은 `char/<인물 id>/<방향>/<상태>/<번호>`, `prop/<id>`
- 애니메이션: `char/<인물 id>/<상태>`(방향 판은 `char/<인물 id>/<방향>/<상태>`) → 재생 순서의 프레임 이름 목록 (반복 가능: raise-hand 는 0·1·2·1)
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
| 같은 인물인데 행마다 머리색·눈매·머리 모양이 다르다 (v0 팀원 typing 은 푸른 검정·날카로운 눈, v1 flannel idle 은 주황빛 금발, afro 는 행에 따라 둥근 아프로/정수리 퍼프) | 그 행만 다시 생성. 묘사에 색을 못 박고 아닌 것도 쓴다 ("golden-yellow blond (not orange, not ginger)", "full round afro (not a puff on top)"). 머리 모양이 흔들리면 마음에 드는 행의 첫 칸을 새 기준 그림으로 prepare 를 다시 한다 (afro). 같은 행 안에서는 일정했다 |
| 행이 옆으로 앉은 모습으로 나온다 (v1 ponytail doze, member typing 다시 생성 1번째) | 동작 글 앞에 "front view: … facing straight toward the viewer … (never turned sideways, never in profile)" 를 붙여 다시 생성 — 두 번 모두 바로잡혔다. 요청 파일 `req-doze-front.json`·`req-typing-front.json` |
| gen-set 기본 동시 실행이 6 이다 | `--concurrency` 로 줄인다 (한 번에 4건 이하) |
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
