"""
레시피(JSON)대로 생성 원본을 규격 셀로 정규화하고 아틀라스 PNG + PixiJS 8 Spritesheet JSON 을 만든다.

사용:
  python tools/sprites/build.py --recipe tools/sprites/recipes/office-v0.json \
      --source-dir <생성 원본 폴더> --out web/public/office
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import (  # noqa: E402
    check_sprite,
    crop_bbox,
    downscale,
    fill_dark_lines,
    Figures,
    figure_slots,
    fit_width,
    grid_slots,
    label_components,
    load_keyed,
    load_rgb,
    main_piece,
    mode_color,
    normalize_row,
    opaque,
    remove_grid_lines,
    seamless_bands_x,
    seamless_crop,
    strip_slots,
    touches_edge,
)

PADDING = 2


def build_characters(recipe: dict, source: Path) -> tuple[dict, dict, dict, list[str]]:
    if not recipe.get('characters'):
        # 인물 없는 판(v6 거리): spec 에 셀 규격이 없다
        return {}, {}, {}, []
    spec = recipe['spec']
    cell_w, cell_h = spec['cell']
    sprites, anchors, animations, notes = {}, {}, {}, []
    anchor = {'x': spec.get('anchorX', cell_w / 2) / cell_w, 'y': spec['baseline'] / cell_h}
    for character in recipe.get('characters', []):
        for row in character['rows']:
            # slice 'figure': 칸 경계가 아니라 인물(이어진 덩어리) 단위로 자른다 — 머리·든 손이 칸 경계를 넘은 원본도 안 잘린다 (v5)
            is_figure = recipe.get('slice') == 'figure'
            if 'strip' in row and is_figure:
                frames, slice_notes = figure_slots(source / row['strip'], row['count'], 1, 0)
                notes += slice_notes
            elif 'strip' in row:
                frames = strip_slots(source / row['strip'], row['count'])
            elif 'grid' in row and is_figure:
                frames, slice_notes = figure_slots(source / row['grid'], row['gridSize'][0], row['gridSize'][1], row['gridRow'])
                notes += slice_notes
            elif 'grid' in row:
                # 한 장에 상태 여러 행을 그린 격자 (v5 뒷모습·옆모습): gridSize [칸, 행], gridRow 몇 번째 행
                frames = grid_slots(source / row['grid'], row['gridSize'][0], row['gridSize'][1], row['gridRow'])
            else:
                frames = [main_piece(load_keyed(source / name)) for name in row['frames']]
            frames = [frames[i] for i in row.get('use', range(len(frames)))]
            # 행 bodyHeight: 웅크리게 그린 행은 머리~발이 짧아 규격 몸 높이로 맞추면 다른 상태보다 커진다 — 그 행만 더 작은 값으로
            # scale: 정해 둔 배율 (인물·방향마다. 없으면 몸 높이로), spec.backX: 옆모습은 등을 그 x 에 맞춘다
            cells = normalize_row(frames, cell_w, cell_h, row.get('bodyHeight', spec['bodyHeight']), spec['baseline'],
                                  scale=row.get('scale', character.get('scale')), back_x=spec.get('backX'))
            # direction: 방향 판(up·right)은 char/<id>/<방향>/<상태>. 없으면 정면(down) 그대로 char/<id>/<상태>
            direction = recipe.get('direction')
            base = f"char/{character['id']}/{direction}/{row['state']}" if direction else f"char/{character['id']}/{row['state']}"
            for i, cell in enumerate(cells):
                name = f'{base}/{i}'
                sprites[name] = cell
                anchors[name] = anchor
                edges = [side for side in touches_edge(cell) if side != '아래']
                if edges:
                    notes.append(f"{name}: 셀 {'·'.join(edges)} 가장자리에 닿음 (잘렸을 수 있음)")
            sequence = row.get('sequence', list(range(len(cells))))
            animations[base] = {'frames': [f'{base}/{i}' for i in sequence], 'fps': row['fps'], 'loop': row.get('loop', True)}
    return sprites, anchors, animations, notes


def largest_component(mask: np.ndarray) -> np.ndarray:
    """4방향으로 이어진 가장 큰 덩어리만 남긴다"""
    seen = np.zeros_like(mask)
    best: list[tuple[int, int]] = []
    for start in zip(*np.nonzero(mask)):
        if seen[start]:
            continue
        stack, members = [start], []
        seen[start] = True
        while stack:
            y, x = stack.pop()
            members.append((y, x))
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(members) > len(best):
            best = members
    result = np.zeros_like(mask)
    for y, x in best:
        result[y, x] = True
    return result


def build_props(recipe: dict, source: Path, notes: list[str]) -> tuple[dict, dict, dict]:
    sprites, anchors, extras = {}, {}, {}
    sheets: dict[str, np.ndarray] = {}
    figures: dict[str, Figures] = {}
    for prop in recipe.get('props', []):
        if prop['sheet'] not in sheets:
            sheets[prop['sheet']] = load_keyed(source / prop['sheet'])
        sheet = sheets[prop['sheet']]
        h, w = sheet.shape[:2]
        if 'box' in prop:
            # box: 격자 칸 대신 원본 px 상자 [x0, y0, x1, y1] (v6 — 시트마다 그림 크기·배치가 달라 칸으로 나누면 걸친다)
            x0, y0, x1, y1 = prop['box']
        else:
            columns, rows = prop['grid']
            column, row = prop['cell']
            x0, x1 = column * w // columns, (column + 1) * w // columns
            y0, y1 = row * h // rows, (row + 1) * h // rows
        name = f"prop/{prop['id']}"
        # whole: 칸 안 조각을 다 남긴다 (나란히 건 액자 둘처럼 떨어진 조각이 한 소품). 기본은 가장 긴 덩어리만
        if recipe.get('slice') == 'figure':
            # 칸 경계가 아니라 덩어리 단위로 (소품 끝이 칸 경계를 넘은 원본도 안 잘린다)
            if prop['sheet'] not in figures:
                figures[prop['sheet']] = Figures(sheet, prop['sheet'])
            piece, piece_notes = figures[prop['sheet']].figure_piece(x0, y0, x1, y1, prop.get('whole', False))
            notes += [f'{name}: {note}' for note in piece_notes]
        else:
            part = sheet[y0:y1, x0:x1]
            piece = crop_bbox(part) if prop.get('whole') else main_piece(part)
        sprites[name] = fit_width(piece, prop['width'])
        anchors[name] = {'x': prop.get('anchor', [0.5, 1])[0], 'y': prop.get('anchor', [0.5, 1])[1]}
        if 'meta' in prop:
            extras[name] = prop['meta']
        if prop.get('screenOff'):
            # 켜진 모니터 화면(파란 픽셀)을 어두운 회색으로 바꾼 꺼짐 그림 prop/<id>-off 와 화면 영역 메타 screen
            on = sprites[name]
            rgb = on[..., :3].astype(int)
            blue = (on[..., 3] > 0) & (rgb[..., 2] > 170) & (rgb[..., 2] > rgb[..., 0] + 60) & (rgb[..., 2] > rgb[..., 1] + 15)  # 밝은 파랑만 (남색 칸막이·부스 벽은 빼려고)
            blue = largest_component(blue)  # 화면 한 덩어리만 (부스 벽 가장자리의 밝은 파랑 점들은 뺀다)
            off = on.copy()
            light = rgb[..., 2][blue] / 255
            off[..., :3][blue] = np.stack([38 + 34 * light, 44 + 34 * light, 54 + 40 * light], axis=1).round().astype(np.uint8)
            sprites[f'{name}-off'] = off
            anchors[f'{name}-off'] = anchors[name]
            ys, xs = np.nonzero(blue)
            extras[name] = {**extras.get(name, {}), 'screen': {'x': int(xs.min()), 'y': int(ys.min()), 'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1)}, 'off': f'{name}-off'}
        if 'glow' in prop:
            # glow: 불 켜진 유리만 따뜻한 색으로 칠한 prop/<id>-glow (나머지 투명). 화면이 노을·밤에 색조 없이 그 위에 겹친다
            sprites[f'{name}-glow'] = glow_sprite(sprites[name], prop['glow'])
            anchors[f'{name}-glow'] = anchors[name]
            extras[name] = {**extras.get(name, {}), 'glow': f'{name}-glow'}
        if prop.get('windows'):
            # windows: 키를 뺀 유리(투명 구멍) = 창. 화면이 그 뒤에 창 안 색과 사람을 그린다
            extras[name] = {**extras.get(name, {}), 'windows': window_holes(sprites[name])}
        if 'lifts' in prop:
            # lifts: band 줄 구간을 늘이고 줄여 높이만 다른 prop/<id>-h<높이> (의자 상판을 앉은 사람 엉덩이에 맞춘다. 다리는 바닥 그대로)
            b0, b1 = prop['lifts']['band']
            low, high = prop['lifts']['range']
            variants = {}
            for lift in range(low, high + 1):
                variant = name if lift == 0 else f"{name}-h{sprites[name].shape[0] + lift}"
                if lift:
                    sprites[variant] = lift_rows(sprites[name], b0, b1, lift)
                    anchors[variant] = anchors[name]
                variants[str(lift)] = variant
            extras[name] = {**extras.get(name, {}), 'lifts': variants}
    return sprites, anchors, extras


WARM_DARK = np.array([255, 196, 92])
WARM_LIGHT = np.array([255, 238, 170])


def glow_sprite(sprite: np.ndarray, spec: dict) -> np.ndarray:
    """
    kind 'glass': 밝은 하늘색 유리 덩어리(150px 이상·높이 10 이상 — 차양 줄무늬 조각은 빼려고)와 그 상자 안 흰 반사 줄.
    kind 'lamp': 위쪽 top 비율 안의 밝고 따뜻한 등 유리 (회색 기둥 하이라이트는 r-b 가 작아 빠진다).
    밝기에 따라 두 따뜻한 색 사이로 칠한다
    """
    rgb = sprite[..., :3].astype(int)
    solid = sprite[..., 3] > 0
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if spec['kind'] == 'glass':
        blue = solid & (b > 170) & (b > r + 35)
        labels = label_components(blue)
        mask = np.zeros_like(blue)
        for k in np.unique(labels)[1:]:
            part = labels == k
            ys, xs = np.nonzero(part)
            if part.sum() < 150 or ys.max() - ys.min() < 10:
                continue
            box = np.zeros_like(blue)
            box[ys.min():ys.max() + 1, xs.min():xs.max() + 1] = True
            mask |= part | (box & solid & (r + g + b > 560))
    else:
        top = np.zeros_like(solid)
        top[:max(1, round(sprite.shape[0] * spec.get('top', 0.3)))] = True
        mask = top & solid & (r > 225) & (g > 190) & (r - b >= 12)
    out = np.zeros_like(sprite)
    light = ((r + g + b)[mask] / 765)[:, None]
    out[..., :3][mask] = (WARM_DARK + (WARM_LIGHT - WARM_DARK) * light).round().astype(np.uint8)
    out[..., 3][mask] = 255
    return out


def window_holes(sprite: np.ndarray) -> list[dict]:
    """
    바깥과 이어지지 않은 투명 구멍(40px 이상) = 창 {x, y, w, h, frame}. frame = 구멍 위·왼쪽·오른쪽 가장자리에서 바깥으로
    진한 외곽선(2px 까지) + 이어진 밝은 창틀의 두께 (쪽마다 가운데 절반에서 잰 중앙값, 세 쪽의 가운데 값) — 창 안 사람의 머리는 이만큼 창틀 위로 나와도 된다
    """
    hole = sprite[..., 3] == 0
    solid = sprite[..., 3] > 0
    total = sprite[..., :3].astype(int).sum(axis=2)
    labels = label_components(hole)
    windows = []
    for k in np.unique(labels)[1:]:
        ys, xs = np.nonzero(labels == k)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        if y0 == 0 or x0 == 0 or y1 == sprite.shape[0] or x1 == sprite.shape[1] or len(ys) < 40:
            continue

        def thickness(points: list[tuple[int, int]], dy: int, dx: int) -> int:
            lengths = []
            for py, px in points:
                # 구멍 가장자리에서 바깥으로 15px 까지의 밝기 (그림 끝·투명에서 멈춘다)
                ray = []
                for step in range(1, 16):
                    y, x = py + dy * step, px + dx * step
                    if not (0 <= y < sprite.shape[0] and 0 <= x < sprite.shape[1] and solid[y, x]):
                        break
                    ray.append(total[y, x])
                n = 0
                while n < min(2, len(ray)) and ray[n] < 200:
                    n += 1
                while n < len(ray) and ray[n] > 600:
                    n += 1
                lengths.append(n)
            return int(np.median(lengths))

        xs_mid = range(x0 + (x1 - x0) // 4, x1 - (x1 - x0) // 4)
        ys_mid = range(y0 + (y1 - y0) // 4, y1 - (y1 - y0) // 4)
        # 세 쪽 중 가운데 값: 한쪽만 창틀 음영이 어둡거나(파란 집) 창틀과 벽 색이 비슷해도 흔들리지 않게
        frame = int(np.median([thickness([(y0, x) for x in xs_mid], -1, 0), thickness([(y, x0) for y in ys_mid], 0, -1), thickness([(y, x1 - 1) for y in ys_mid], 0, 1)]))
        windows.append({'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0), 'frame': frame})
    return sorted(windows, key=lambda window: window['x'])


def lift_rows(a: np.ndarray, b0: int, b1: int, lift: int) -> np.ndarray:
    """[b0, b1) 줄 구간 안에서 고르게 lift 줄을 겹쳐 넣거나(양수) 빼서(음수) 높이만 바꾼다"""
    count = abs(lift)
    picks = {b0 + int((i + 0.5) * (b1 - b0) / count) for i in range(count)}
    rows = []
    for y in range(a.shape[0]):
        if lift < 0 and y in picks:
            continue
        rows.append(y)
        if lift > 0 and y in picks:
            rows.append(y)
    return a[rows]


def build_tiles(recipe: dict, source: Path) -> tuple[dict, dict]:
    """
    반복 타일. 크기는 tiles(타일 수) 또는 size([폭, 높이] px, 한쪽이 null 이면 비율대로).
    keyed 면 마젠타를 투명으로 (창 유리처럼 뒤가 보이는 벽), dropRows 는 자를 영역 안 행 구간 [y0, y1) (시트 좌표) 을 빼고 잇는다,
    seamless 'x'·'y'·'xy' 면 그 방향으로 이음매 없이 반복되는 구간만 남긴다 (spritelib.seamless_crop),
    seamlessBands 면 가로 판자 줄마다 따로 가로 구간을 고른다 (spritelib.seamless_bands_x)
    """
    tile = recipe['spec']['tile']
    tiles, metas = {}, {}
    for item in recipe.get('tiles', []):
        x0, y0, x1, y1 = item['crop']
        is_keyed = item.get('keyed', False)
        image = load_keyed(source / item['sheet']) if is_keyed else opaque(load_rgb(source / item['sheet']))
        keep = np.ones(image.shape[0], bool)
        for d0, d1 in item.get('dropRows', []):
            keep[d0:d1] = False
        rows_kept = np.nonzero(keep[y0:y1])[0] + y0
        a = image[rows_kept][:, x0:x1]
        inset = item.get('inset', 0)
        if inset:
            a = a[inset:-inset, inset:-inset]
        if item.get('removeGridLines'):
            a = opaque(remove_grid_lines(a[..., :3]))
        if 'fillDarkLines' in item:
            a = opaque(fill_dark_lines(a[..., :3], tuple(item['fillDarkLines'].get('keep') or ()) or None))
        for axis in item.get('seamless', ''):
            a = seamless_crop(a, 1 if axis == 'x' else 0)
        if item.get('seamlessBands'):
            a = seamless_bands_x(a)
        if 'size' in item:
            width, height = item['size']
            width = width or max(1, round(a.shape[1] * height / a.shape[0]))
            height = height or max(1, round(a.shape[0] * width / a.shape[1]))
        else:
            width, height = item['tiles'][0] * tile, item['tiles'][1] * tile
        small = downscale(a, width, height)
        if not is_keyed:
            small = opaque(small[..., :3])
        if 'tone' in item:
            # tone: 평균색을 color 로 옮기고 무늬 대비를 contrast 배로 (생성한 카펫이 너무 거칠고 어두울 때)
            rgb = small[..., :3].astype(float)
            mean = rgb.reshape(-1, 3).mean(axis=0)
            rgb = np.array(item['tone']['color']) + (rgb - mean) * item['tone']['contrast']
            small[..., :3] = rgb.clip(0, 255).round().astype(np.uint8)
        tiles[item['id']] = small
        meta = {'top': mode_color(small[:2]), 'bottom': mode_color(small[-2:])}
        if is_keyed:
            # 투명 픽셀이 있는 행 구간 = 창 유리 (뒤에 창밖을 깐다)
            rows = np.nonzero((small[..., 3] == 0).any(axis=1))[0]
            if len(rows):
                meta['glass'] = {'y': int(rows.min()), 'h': int(rows.max() - rows.min() + 1)}
        metas[item['id']] = meta
    return tiles, metas


def pack(sprites: dict[str, np.ndarray], max_width: int = 1024) -> tuple[np.ndarray, dict]:
    """키가 큰 것부터 선반(shelf) 방식으로 채운다. 칸 사이 PADDING px 투명"""
    order = sorted(sprites, key=lambda name: (-sprites[name].shape[0], name))
    positions, x, y, shelf_h, width = {}, PADDING, PADDING, 0, 0
    for name in order:
        h, w = sprites[name].shape[:2]
        if x + w + PADDING > max_width:
            x, y, shelf_h = PADDING, y + shelf_h + PADDING, 0
        positions[name] = (x, y)
        x += w + PADDING
        shelf_h = max(shelf_h, h)
        width = max(width, x)
    height = y + shelf_h + PADDING
    atlas = np.zeros((height, width, 4), np.uint8)
    for name, (px, py) in positions.items():
        h, w = sprites[name].shape[:2]
        atlas[py:py + h, px:px + w] = sprites[name]
    return atlas, positions


def save_atlas(atlas: np.ndarray, path: Path, palette: int | None) -> None:
    """
    palette 가 없으면 RGBA 그대로. 있으면 그 색 수 + 투명 1칸의 팔레트 PNG (median cut, 디더링 없음).
    도트 축소(최빈색의 중앙값)는 색이 수십만 개라 RGBA 로는 크다 — v3 를 255 색으로 줄이면 2.3MB → 0.6MB, 평균 색 차이 3.6 (눈으로 구분 안 됨)
    """
    if not palette:
        Image.fromarray(atlas).save(path, optimize=True)
        return
    solid = atlas[..., 3] > 0
    quantized = Image.fromarray(atlas[..., :3]).quantize(colors=palette, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    colors = np.array(quantized.getpalette()[:palette * 3]).reshape(-1, 3)
    index = np.where(solid, np.array(quantized) + 1, 0).astype(np.uint8)
    image = Image.fromarray(index, 'P')
    image.putpalette([0, 0, 0] + colors.flatten().tolist())
    image.save(path, optimize=True, transparency=0)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--source-dir', required=True, type=Path, help='레시피의 파일 이름이 가리키는 생성 원본 폴더')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    # Windows 콘솔 기본 인코딩(cp949)이면 한글 출력이 깨진다
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

    recipe = json.loads(args.recipe.read_text(encoding='utf-8'))
    name = recipe['name']
    sprites, anchors, animations, notes = build_characters(recipe, args.source_dir)
    prop_sprites, prop_anchors, prop_meta = build_props(recipe, args.source_dir, notes)
    sprites.update(prop_sprites)
    anchors.update(prop_anchors)
    tiles, tile_metas = build_tiles(recipe, args.source_dir)
    keyed_tiles = {item['id'] for item in recipe.get('tiles', []) if item.get('keyed')}

    problems = [p for sprite_name, a in sprites.items() for p in check_sprite(sprite_name, a)]
    problems += [p for tile_name, a in tiles.items() for p in check_sprite(f'tile/{tile_name}', a, is_opaque_tile=tile_name not in keyed_tiles)]
    if problems:
        print('\n'.join(problems), file=sys.stderr)
        sys.exit(1)

    atlas, positions = pack(sprites)
    args.out.mkdir(parents=True, exist_ok=True)
    # palette: 팔레트 PNG 로 줄일 색 수 (v5). Pixi 는 읽을 때 RGBA 로 풀므로 화면 코드는 같다
    save_atlas(atlas, args.out / f'{name}.png', recipe.get('palette'))
    frames = {}
    for sprite_name in sorted(sprites):
        h, w = sprites[sprite_name].shape[:2]
        x, y = positions[sprite_name]
        frames[sprite_name] = {
            'frame': {'x': x, 'y': y, 'w': w, 'h': h},
            'rotated': False,
            'trimmed': False,
            'spriteSourceSize': {'x': 0, 'y': 0, 'w': w, 'h': h},
            'sourceSize': {'w': w, 'h': h},
            'anchor': anchors[sprite_name],
        }
    tile_files = {}
    for tile_name, a in tiles.items():
        file = f'{name}-tile-{tile_name}.png'
        Image.fromarray(a).save(args.out / file, optimize=True)
        tile_files[tile_name] = {'image': file, 'w': a.shape[1], 'h': a.shape[0], **tile_metas[tile_name]}
    data = {
        'frames': frames,
        'animations': {key: value['frames'] for key, value in animations.items()},
        'meta': {
            'app': 'jk-corp tools/sprites/build.py',
            'image': f'{name}.png',
            'format': 'RGBA8888',
            'size': {'w': int(atlas.shape[1]), 'h': int(atlas.shape[0])},
            'scale': 1,
            'jkCorp': {
                'spec': recipe['spec'],
                'characters': [
                    {'id': c['id'], 'pool': c.get('pool', 'member'), **({'gender': c['gender']} if 'gender' in c else {})}
                    for c in recipe.get('characters', [])
                ],
                'animations': {key: {'fps': value['fps'], 'loop': value['loop']} for key, value in animations.items()},
                'tiles': tile_files,
                'props': prop_meta,
                # 레시피 jkCorp: 화면이 쓸 배치 메타(자리 안 좌표·아이콘 등)를 그대로 싣는다
                **recipe.get('jkCorp', {}),
            },
        },
    }
    (args.out / f'{name}.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    files = [args.out / f'{name}.png', args.out / f'{name}.json'] + [args.out / t['image'] for t in tile_files.values()]
    for file in files:
        print(f'{file.as_posix()}  {file.stat().st_size / 1024:.1f} KB')
    print(f'아틀라스 {atlas.shape[1]}x{atlas.shape[0]}, 스프라이트 {len(sprites)}개, 애니메이션 {len(animations)}개, 타일 {len(tiles)}개')
    for note in notes:
        print('주의:', note)


if __name__ == '__main__':
    main()
