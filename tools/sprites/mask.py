"""
인물 색 바꾸기 마스크: 레시피(JSON)대로 아틀라스의 인물 칸마다 머리·윗옷 픽셀을 골라
마스크 PNG(아틀라스와 같은 크기. R = 머리 가중치, G = 윗옷 가중치, 알파는 늘 255)와 기본색 JSON 을 만든다.
아틀라스(office-v1.png·json)는 바꾸지 않는다.

픽셀 고르기: 인물의 idle 첫 칸에서 레시피의 표본 상자(`sample`) 색을 모으고,
그 인물의 모든 칸에서 세로 범위(`y`, 셀 좌표) 안이면서 표본 색 중 가장 가까운 것과의 RGB 거리가
`tolerance` 보다 가까운 픽셀을 고른다 (거리 tolerance×0.6 까지 1, tolerance 에서 0 으로 줄어든다).
거의 검은 픽셀(외곽선·눈. 가장 밝은 채널이 26 이하)은 표본에서도 결과에서도 빼고, 표본의 드문 색 묶음도 빼고, 고른 픽셀 중 `exclude` 상자 안과
따로 떨어진 작은 덩어리(10픽셀 미만. 머리색과 같은 눈동자)는 뺀다.

사용:
  python tools/sprites/mask.py --recipe tools/sprites/recipes/office-v1-recolor.json \
      --atlas web/public/office/office-v1 [--preview 미리보기.png]
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
MIN_BUCKET_SHARE = 0.04
MIN_COMPONENT = 10


def frame_rects(atlas_data: dict, character: str) -> dict[str, tuple[int, int, int, int]]:
    rects = {}
    for name, entry in atlas_data['frames'].items():
        if name.startswith(f'char/{character}/'):
            f = entry['frame']
            rects[name] = (f['x'], f['y'], f['w'], f['h'])
    return rects


def sample_colors(cell: np.ndarray, boxes: list[list[int]]) -> np.ndarray:
    picked = []
    for x0, y0, x1, y1 in boxes:
        region = cell[y0:y1, x0:x1].reshape(-1, 4)
        region = region[(region[:, 3] > 0) & (region[:, :3].max(axis=1) > OUTLINE_MAX)]
        picked.append(region[:, :3])
    pixels = np.concatenate(picked)
    if len(pixels) == 0:
        raise ValueError('표본 상자에 색이 없다')
    # 상자 가장자리에 걸린 다른 부위(피부·외곽선 번짐) 몇 픽셀이 한도를 넓히지 않게: 흔한 색 묶음(16 단계)만 남긴다
    buckets = pixels // 16
    keys = buckets[:, 0] * 256 + buckets[:, 1] * 16 + buckets[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    common = values[counts >= max(2, len(pixels) * MIN_BUCKET_SHARE)]
    return np.unique(pixels[np.isin(keys, common)], axis=0)


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


def slot_weight(cell: np.ndarray, colors: np.ndarray, rule: dict, tolerance: float) -> np.ndarray:
    height, width = cell.shape[:2]
    weight = np.zeros((height, width))
    y0, y1 = rule['y']
    band = cell[y0:y1].reshape(-1, 4).astype(float)
    distance = np.full(len(band), np.inf)
    for start in range(0, len(colors), 256):
        chunk = colors[start:start + 256].astype(float)
        d = np.sqrt(((band[:, None, :3] - chunk[None, :, :]) ** 2).sum(axis=2)).min(axis=1)
        distance = np.minimum(distance, d)
    full = tolerance * FULL_RATIO
    value = np.clip((tolerance - distance) / (tolerance - full), 0, 1)
    value[(band[:, 3] == 0) | (band[:, :3].max(axis=1) <= OUTLINE_MAX)] = 0
    weight[y0:y1] = value.reshape(y1 - y0, width)
    for x0, ey0, x1, ey1 in rule.get('exclude', []):
        weight[ey0:ey1, x0:x1] = 0
    weight[small_components(weight > 0, MIN_COMPONENT)] = 0
    return weight


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--atlas', required=True, help='아틀라스 경로 (확장자 없이. .png·.json 을 읽는다)')
    parser.add_argument('--preview', help='마스크를 칠한 미리보기 PNG (인물마다 idle·raise-hand 첫 칸)')
    args = parser.parse_args()

    recipe = json.loads(Path(args.recipe).read_text(encoding='utf-8'))
    atlas_path = Path(args.atlas)
    atlas = np.array(Image.open(atlas_path.with_suffix('.png')).convert('RGBA')).astype(int)
    atlas_data = json.loads(atlas_path.with_suffix('.json').read_text(encoding='utf-8'))

    mask = np.zeros(atlas.shape, dtype=np.uint8)
    mask[..., 3] = 255
    bases: dict[str, dict[str, str]] = {}
    previews = []
    for character, slots in recipe['characters'].items():
        rects = frame_rects(atlas_data, character)
        idle = f'char/{character}/idle/0'
        if idle not in rects:
            print(f'{character}: 아틀라스에 {idle} 가 없다', file=sys.stderr)
            return 1
        x, y, w, h = rects[idle]
        idle_cell = atlas[y:y + h, x:x + w]
        bases[character] = {}
        for slot in SLOTS:
            rule = slots[slot]
            colors = sample_colors(idle_cell, rule['sample'])
            bases[character][slot] = '#%02x%02x%02x' % tuple(int(v) for v in np.median(colors, axis=0))
            for x, y, w, h in rects.values():
                weight = slot_weight(atlas[y:y + h, x:x + w], colors, rule, rule.get('tolerance', recipe.get('tolerance', 36)))
                mask[y:y + h, x:x + w, CHANNEL[slot]] = np.maximum(mask[y:y + h, x:x + w, CHANNEL[slot]], (weight * 255).round().astype(np.uint8))
        print(character, bases[character])
        if args.preview:
            for state in ('idle', 'raise-hand'):
                x, y, w, h = rects[f'char/{character}/{state}/0']
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
