"""
인물 색 바꾸기 마스크: 레시피(JSON)대로 아틀라스의 인물 칸마다 머리·윗옷 픽셀을 골라
마스크 PNG(아틀라스와 같은 크기. R = 머리 가중치, G = 윗옷 가중치, 알파는 늘 255)와 기본색 JSON 을 만든다.
아틀라스는 바꾸지 않는다.

픽셀 고르기: 인물의 idle 첫 칸에서 레시피의 표본 상자(`sample`) 색을 모으고,
그 인물의 모든 칸에서 세로 범위(`y`, 셀 좌표) 안이면서 표본 색 중 가장 가까운 것과의 RGB 거리가
`tolerance` 보다 가까운 픽셀을 고른다.
거의 검은 픽셀(외곽선·눈. 가장 밝은 채널이 `outlineMax`(기본 26) 이하)은 표본에서도 결과에서도 빼고,
표본의 드문 색 묶음(16 단계 묶음이 표본의 `minShare`(기본 0.04) 미만)도 빼고, 고른 픽셀 중 `exclude` 상자 안과
따로 떨어진 작은 덩어리(10픽셀 미만. 머리색과 같은 눈동자)는 뺀다.

레시피 맨 위 `"method": 2` (v5 레시피) 면 셋이 달라진다. 없으면 옛 규칙(v1·v3 레시피 결과가 그대로 나온다):
- 기본색: 표본 픽셀을 픽셀 수 그대로 채널별 가운데 값. (옛 규칙은 고유 색의 가운데 값이라 빈도를 무시해,
  외곽선 쪽 어두운 변종이 많은 인물은 기본색이 실제 머리보다 훨씬 어두워져 색을 바꾸면 하얗게 날아갔다)
- 부위 경쟁: 머리·윗옷·피부(인물 단위 `skin` 상자) 표본 중 이 부위 표본이 가장 가까운 픽셀만 고른다 (같으면 진다).
  표본 상자 가장자리의 손·목 피부가 윗옷으로, 스웨터가 머리로 잡히던 것을 막는다.
  `compete: "share"` (머리·윗옷 둘 다에 준다) 면 같은 거리로 맞설 때 가장 가까운 표본 색이 표본에서 차지하는 비율이
  큰 쪽이 갖고, 그다음 머리·윗옷 후보 픽셀(피부와의 경쟁만 거친 것)마다 주변 7×7 에서 그렇게 고른 픽셀이 더 많은
  부위가 갖는다 — 머리와 윗옷이 팔레트 색을 나눠 쓰는 인물(lead-suit 의 검은 머리·회색 정장)은 같은 색이 둘 다 져서
  정장이 통째로 빠지고, 세로 범위로 가르면 고개 숙인·팔 든 칸에서 어깨·소매가 머리가 된다. 색 비율만으로는 머리의
  회색 하이라이트가 윗옷, 정장의 어두운 주름이 머리가 되어 주변으로 고친다. `compete: false` 면 경쟁하지 않는다
- 가중치 0/1: 거리 tolerance×0.8 미만이면 1, 아니면 0. (옛 규칙은 tolerance×0.6 까지 1, tolerance 에서 0 으로 줄어들어
  어중간한 가중치 픽셀이 원래 색 잔점으로 남았다)

방향 판(v5 의 up·right 아틀라스)은 idle 첫 칸이 정면 판에만 있다: `--sample-atlas` 로 정면 아틀라스를 주면
표본 색(`sample`·`skin`)은 거기서 모으고(표본 상자는 정면 셀 좌표), 세로 범위·exclude 는 이 아틀라스의 셀 좌표다.
정면 표본이 이 방향 팔레트와 안 맞는 부위는 이 아틀라스의 그 방향 idle 첫 칸에서 모은다:
`sampleSelf`(부위의 `sample` 대신)·`skinSelf`(인물의 `skin` 대신)·`sampleAdd`(부위의 표본에 더한다. 드문 색 기준 0.01).
상태 행은 따로 생성돼 같은 부위도 팔레트 색이 idle 과 다를 수 있다 (hijab 정면 typing 스카프 #e88679 ↔ idle #d26458):
부위의 `sampleFrames` (`{"typing/0": [상자…]}`, 이 아틀라스의 그 방향 그 칸 좌표) 는 그 칸에서 표본 색을 더 모은다.
고를 색에만 더하고 기본색 계산에는 넣지 않는다 (기본색은 idle 표본 기준. 드문 색 기준은 부위의 `minShare`).
레시피의 `direction` 은 그 칸(`char/<id>/<direction>/idle/0`)과 미리보기에서 볼 칸을 정한다.

사용:
  python tools/sprites/mask.py --recipe tools/sprites/recipes/office-v3-recolor.json \
      --atlas web/public/office/office-v3 [--preview 미리보기.png]
  python tools/sprites/mask.py --recipe tools/sprites/recipes/office-v5-up-recolor.json \
      --atlas web/public/office/office-v5-up --sample-atlas web/public/office/office-v5-down
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SLOTS = ('hair', 'top')
CHANNEL = {'hair': 0, 'top': 1}
OUTLINE_MAX = 26
FULL_RATIO = 0.6
HARD_RATIO = 0.8
MIN_BUCKET_SHARE = 0.04
ADD_MIN_SHARE = 0.01
MIN_COMPONENT = 10
SHARE_RADIUS = 3


def frame_rects(atlas_data: dict, character: str) -> dict[str, tuple[int, int, int, int]]:
    rects = {}
    for name, entry in atlas_data['frames'].items():
        if name.startswith(f'char/{character}/'):
            f = entry['frame']
            rects[name] = (f['x'], f['y'], f['w'], f['h'])
    return rects


def sample_pixels(cell: np.ndarray, boxes: list[list[int]], outline_max: int = OUTLINE_MAX, min_share: float = MIN_BUCKET_SHARE) -> np.ndarray:
    """표본 상자들의 색 (픽셀 수 그대로, 드문 색 묶음 뺌)"""
    picked = []
    for x0, y0, x1, y1 in boxes:
        region = cell[y0:y1, x0:x1].reshape(-1, 4)
        region = region[(region[:, 3] > 0) & (region[:, :3].max(axis=1) > outline_max)]
        picked.append(region[:, :3])
    pixels = np.concatenate(picked)
    if len(pixels) == 0:
        raise ValueError('표본 상자에 색이 없다')
    # 상자 가장자리에 걸린 다른 부위(피부·외곽선 번짐) 몇 픽셀이 한도를 넓히지 않게: 흔한 색 묶음(16 단계)만 남긴다
    buckets = pixels // 16
    keys = buckets[:, 0] * 256 + buckets[:, 1] * 16 + buckets[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    common = values[counts >= max(2, len(pixels) * min_share)]
    return pixels[np.isin(keys, common)]


def nearest(band: np.ndarray, colors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """band 픽셀마다 colors 중 가장 가까운 것과의 RGB 거리와 그 색 번호"""
    distance = np.full(len(band), np.inf)
    which = np.zeros(len(band), dtype=int)
    for start in range(0, len(colors), 256):
        chunk = colors[start:start + 256].astype(float)
        d = np.sqrt(((band[:, None, :3] - chunk[None, :, :]) ** 2).sum(axis=2))
        best = d.argmin(axis=1)
        d = d[np.arange(len(band)), best]
        closer = d < distance
        distance[closer] = d[closer]
        which[closer] = best[closer] + start
    return distance, which


def color_share(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """표본의 고유 색과 색마다 표본에서 차지하는 비율"""
    colors, counts = np.unique(samples, axis=0, return_counts=True)
    return colors, counts / counts.sum()


def small_components(selected: np.ndarray, min_size: int) -> np.ndarray:
    """8방향으로 이어진 덩어리 중 min_size 픽셀보다 작은 것 (머리와 떨어진 눈동자 같은 것)"""
    height, width = selected.shape
    seen = np.zeros_like(selected)
    small = np.zeros_like(selected)
    for start_y, start_x in zip(*np.nonzero(selected)):
        if seen[start_y, start_x]:
            continue
        stack = [(start_y, start_x)]
        seen[start_y, start_x] = True
        members = []
        while stack:
            y, x = stack.pop()
            members.append((y, x))
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    if selected[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(members) < min_size:
            for y, x in members:
                small[y, x] = True
    return small


def slot_weight(cell: np.ndarray, own: tuple[np.ndarray, np.ndarray], rivals: list[tuple[np.ndarray, np.ndarray]], rule: dict, tolerance: float, is_hard: bool, is_final: bool = True) -> np.ndarray:
    """own·rivals 는 (고유 색, 비율). rule 의 compete 가 "share" 면 같은 거리일 때 비율이 큰 쪽이 갖는다"""
    height, width = cell.shape[:2]
    weight = np.zeros((height, width))
    y0, y1 = rule['y']
    band = cell[y0:y1].reshape(-1, 4).astype(float)
    colors, shares = own
    distance, which = nearest(band, colors)
    if is_hard:
        value = (distance < tolerance * HARD_RATIO).astype(float)
    else:
        full = tolerance * FULL_RATIO
        value = np.clip((tolerance - distance) / (tolerance - full), 0, 1)
    for rival_colors, rival_shares in rivals:
        rival_distance, rival_which = nearest(band, rival_colors)
        if rule.get('compete') == 'share':
            lose = (rival_distance < distance) | ((rival_distance == distance) & (rival_shares[rival_which] >= shares[which]))
        else:
            lose = rival_distance <= distance
        value[lose] = 0
    value[(band[:, 3] == 0) | (band[:, :3].max(axis=1) <= rule.get('outlineMax', OUTLINE_MAX))] = 0
    weight[y0:y1] = value.reshape(y1 - y0, width)
    for x0, ey0, x1, ey1 in rule.get('exclude', []):
        weight[ey0:ey1, x0:x1] = 0
    if is_final:
        weight[small_components(weight > 0, MIN_COMPONENT)] = 0
    return weight


def box_sum(values: np.ndarray, radius: int) -> np.ndarray:
    """칸마다 (2·radius+1)² 창 안의 합"""
    padded = np.pad(values.astype(int), radius)
    total = padded.cumsum(axis=0).cumsum(axis=1)
    total = np.pad(total, ((1, 0), (1, 0)))
    size = 2 * radius + 1
    return total[size:, size:] - total[:-size, size:] - total[size:, :-size] + total[:-size, :-size]


def shared_weights(cell: np.ndarray, owns: dict, slots: dict, skin, tolerances: dict) -> dict[str, np.ndarray]:
    """compete "share": 색 비율로 고른 뒤, 후보 픽셀은 주변 7×7 에 고른 픽셀이 더 많은 부위가 갖는다 (가중치 0/1)"""
    won, candidate = {}, {}
    for slot in SLOTS:
        other = [owns[o] for o in SLOTS if o != slot]
        skin_rivals = [skin] if skin is not None else []
        won[slot] = slot_weight(cell, owns[slot], other + skin_rivals, slots[slot], tolerances[slot], True, is_final=False) > 0
        candidate[slot] = slot_weight(cell, owns[slot], skin_rivals, slots[slot], tolerances[slot], True, is_final=False) > 0
    near = {slot: box_sum(won[slot], SHARE_RADIUS) for slot in SLOTS}
    weights = {}
    for slot in SLOTS:
        other = next(o for o in SLOTS if o != slot)
        picked = candidate[slot] & (near[slot] > near[other])
        picked[small_components(picked, MIN_COMPONENT)] = False
        weights[slot] = picked.astype(float)
    return weights


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--atlas', required=True, help='아틀라스 경로 (확장자 없이. .png·.json 을 읽는다)')
    parser.add_argument('--preview', help='마스크를 칠한 미리보기 PNG (인물마다 idle·raise-hand 첫 칸)')
    parser.add_argument('--sample-atlas', help='표본 색을 모을 정면 아틀라스 (확장자 없이). 없으면 --atlas')
    args = parser.parse_args()

    recipe = json.loads(Path(args.recipe).read_text(encoding='utf-8'))
    atlas_path = Path(args.atlas)
    atlas = np.array(Image.open(atlas_path.with_suffix('.png')).convert('RGBA')).astype(int)
    atlas_data = json.loads(atlas_path.with_suffix('.json').read_text(encoding='utf-8'))

    sample_path = Path(args.sample_atlas) if args.sample_atlas else atlas_path
    sample_atlas = np.array(Image.open(sample_path.with_suffix('.png')).convert('RGBA')).astype(int)
    sample_data = json.loads(sample_path.with_suffix('.json').read_text(encoding='utf-8'))
    prefix = f"{recipe['direction']}/" if recipe.get('direction') else ''

    is_v2 = recipe.get('method', 1) == 2

    mask = np.zeros(atlas.shape, dtype=np.uint8)
    mask[..., 3] = 255
    bases: dict[str, dict[str, str]] = {}
    previews = []
    for character, slots in recipe['characters'].items():
        rects = frame_rects(atlas_data, character)
        sample_rects = frame_rects(sample_data, character)
        idle = f'char/{character}/idle/0'
        own_idle = f'char/{character}/{prefix}idle/0'
        if idle not in sample_rects or own_idle not in rects:
            print(f'{character}: 아틀라스에 {idle} 또는 {own_idle} 가 없다', file=sys.stderr)
            return 1
        x, y, w, h = sample_rects[idle]
        idle_cell = sample_atlas[y:y + h, x:x + w]
        x, y, w, h = rects[own_idle]
        own_cell = atlas[y:y + h, x:x + w]

        samples = {}
        pick = {}
        for slot in SLOTS:
            rule = slots[slot]
            outline_max = rule.get('outlineMax', OUTLINE_MAX)
            min_share = rule.get('minShare', MIN_BUCKET_SHARE)
            if rule.get('sampleSelf'):
                pixels = sample_pixels(own_cell, rule['sampleSelf'], outline_max, min_share)
            else:
                pixels = sample_pixels(idle_cell, rule['sample'], outline_max, min_share)
            if rule.get('sampleAdd'):
                pixels = np.concatenate([pixels, sample_pixels(own_cell, rule['sampleAdd'], outline_max, ADD_MIN_SHARE)])
            samples[slot] = pixels
            for frame, boxes in rule.get('sampleFrames', {}).items():
                name = f'char/{character}/{prefix}{frame}'
                if name not in rects:
                    print(f'{character}: sampleFrames 의 {name} 가 아틀라스에 없다', file=sys.stderr)
                    return 1
                x, y, w, h = rects[name]
                pixels = np.concatenate([pixels, sample_pixels(atlas[y:y + h, x:x + w], boxes, outline_max, min_share)])
            pick[slot] = pixels
        if slots.get('skinSelf'):
            skin = sample_pixels(own_cell, slots['skinSelf'])
        elif slots.get('skin'):
            skin = sample_pixels(idle_cell, slots['skin'])
        else:
            skin = None

        bases[character] = {}
        owns = {slot: color_share(pick[slot]) for slot in SLOTS}
        skin_share = color_share(skin) if skin is not None else None
        tolerances = {slot: slots[slot].get('tolerance', recipe.get('tolerance', 36)) for slot in SLOTS}
        for slot in SLOTS:
            # method 2 는 픽셀 수 그대로의 가운데 값, 옛 규칙은 고유 색의 가운데 값
            base = np.median(samples[slot] if is_v2 else owns[slot][0], axis=0)
            bases[character][slot] = '#%02x%02x%02x' % tuple(int(v) for v in base)
        modes = {slots[slot].get('compete', True) for slot in SLOTS}
        if 'share' in modes and (modes != {'share'} or not is_v2):
            print(f'{character}: compete "share" 는 method 2 에서 머리·윗옷 둘 다에 준다', file=sys.stderr)
            return 1
        for x, y, w, h in rects.values():
            cell = atlas[y:y + h, x:x + w]
            if modes == {'share'}:
                weights = shared_weights(cell, owns, slots, skin_share, tolerances)
            else:
                weights = {}
                for slot in SLOTS:
                    rivals = []
                    if is_v2 and slots[slot].get('compete', True) is not False:
                        rivals = [owns[other] for other in SLOTS if other != slot]
                        if skin_share is not None:
                            rivals.append(skin_share)
                    weights[slot] = slot_weight(cell, owns[slot], rivals, slots[slot], tolerances[slot], is_v2)
            for slot in SLOTS:
                region = mask[y:y + h, x:x + w, CHANNEL[slot]]
                np.maximum(region, (weights[slot] * 255).round().astype(np.uint8), out=region)
        print(character, bases[character])
        if args.preview:
            for state in ('idle', 'raise-hand'):
                x, y, w, h = rects[f'char/{character}/{prefix}{state}/0']
                cell = atlas[y:y + h, x:x + w].astype(float)
                painted = cell.copy()
                for slot, color in (('hair', (255, 0, 255)), ('top', (0, 220, 255))):
                    weight = mask[y:y + h, x:x + w, CHANNEL[slot]][..., None] / 255
                    painted[..., :3] = painted[..., :3] * (1 - weight) + np.array(color) * weight
                previews.append(np.concatenate([cell, painted], axis=1))

    out_png = atlas_path.parent / f"{recipe['name']}.png"
    Image.fromarray(mask).save(out_png, optimize=True)
    out_json = atlas_path.parent / f"{recipe['name']}.json"
    out_json.write_text(json.dumps({'atlas': atlas_path.name, 'mask': out_png.name, 'characters': bases}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'썼다: {out_png} · {out_json}')

    if args.preview:
        rows = [np.concatenate(previews[i:i + 6], axis=1) for i in range(0, len(previews), 6)]
        width = max(row.shape[1] for row in rows)
        rows = [np.pad(row, ((0, 0), (0, width - row.shape[1]), (0, 0))) for row in rows]
        sheet = Image.fromarray(np.concatenate(rows, axis=0).astype(np.uint8))
        background = Image.new('RGBA', sheet.size, (190, 190, 190, 255))
        background.alpha_composite(sheet)
        background.resize((sheet.width * 3, sheet.height * 3), Image.NEAREST).save(args.preview)
    return 0


if __name__ == '__main__':
    sys.exit(main())
