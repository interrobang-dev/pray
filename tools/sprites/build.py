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
    fit_width,
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
    spec = recipe['spec']
    cell_w, cell_h = spec['cell']
    sprites, anchors, animations, notes = {}, {}, {}, []
    anchor = {'x': 0.5, 'y': spec['baseline'] / cell_h}
    for character in recipe.get('characters', []):
        for row in character['rows']:
            if 'strip' in row:
                frames = strip_slots(source / row['strip'], row['count'])
            else:
                frames = [main_piece(load_keyed(source / name)) for name in row['frames']]
            frames = [frames[i] for i in row.get('use', range(len(frames)))]
            # 행 bodyHeight: 웅크리게 그린 행은 머리~발이 짧아 규격 몸 높이로 맞추면 다른 상태보다 커진다 — 그 행만 더 작은 값으로
            cells = normalize_row(frames, cell_w, cell_h, row.get('bodyHeight', spec['bodyHeight']), spec['baseline'])
            base = f"char/{character['id']}/{row['state']}"
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


def build_props(recipe: dict, source: Path) -> tuple[dict, dict, dict]:
    sprites, anchors, extras = {}, {}, {}
    sheets: dict[str, np.ndarray] = {}
    for prop in recipe.get('props', []):
        if prop['sheet'] not in sheets:
            sheets[prop['sheet']] = load_keyed(source / prop['sheet'])
        sheet = sheets[prop['sheet']]
        columns, rows = prop['grid']
        column, row = prop['cell']
        h, w = sheet.shape[:2]
        part = sheet[row * h // rows:(row + 1) * h // rows, column * w // columns:(column + 1) * w // columns]
        name = f"prop/{prop['id']}"
        # whole: 칸 안 조각을 다 남긴다 (나란히 건 액자 둘처럼 떨어진 조각이 한 소품). 기본은 가장 긴 덩어리만
        sprites[name] = fit_width(crop_bbox(part) if prop.get('whole') else main_piece(part), prop['width'])
        anchors[name] = {'x': prop.get('anchor', [0.5, 1])[0], 'y': prop.get('anchor', [0.5, 1])[1]}
        if 'meta' in prop:
            extras[name] = prop['meta']
    return sprites, anchors, extras


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
    prop_sprites, prop_anchors, prop_meta = build_props(recipe, args.source_dir)
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
    Image.fromarray(atlas).save(args.out / f'{name}.png', optimize=True)
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
