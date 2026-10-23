"""
라운지 소품 자리 메타(office-v5-props 의 jkCorp.lounge)를 인물 아틀라스에서 재고, 앉힌 미리보기를 그린다. 인물 그림을 다시 만들면 다시 돌린다.

- 자리(seats: x·y·dir·front)는 레시피에 손으로 적는다 (그림을 보고 정한 값. 규칙은 설계 문서 "라운지 자리")
- sideOffsetY[상태][인물]: 옆모습(office-v5-right) 그 상태 모든 칸의 엉덩이 아래 선(street_seats.py 와 같은 잣대) 중 가장 높은 것을
  SEAT_LINE 에 맞추는 사람 y 변화 = SEAT_LINE - 그 줄 (양수 = 아래로). 의자가 소품 그림에 붙어 있어 거리처럼 의자를 바꿀 수 없으니
  사람을 옮긴다. 발은 그만큼 오르내리지만 라운지 바닥에는 발을 맞출 선이 없다. 칸마다 1px 오르내리는 인물은 엉덩이가 의자에 1px
  묻히는 쪽을 고른다 (뜨는 것보다 덜 보인다)
- --preview <폴더>: 소품마다·상태마다 인물 18명을 모든 자리에 앉힌 그림(lounge-<소품>-<상태>-f<칸>.png)을 쓴다.
  화면과 같은 순서로 그린다: 소품 → 자리를 y 작은 것부터 [사람 → 그 자리 front]

사용:
  python tools/sprites/lounge_seats.py --recipe tools/sprites/recipes/office-v5-props.json --atlas-dir web/public/office [--write] [--preview <폴더>]
--write 면 레시피 jkCorp.lounge.sideOffsetY 를 고쳐 쓴다 (아니면 출력만). 그다음 build.py 로 아틀라스 JSON 을 다시 만든다
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SEAT_LINE = 100
STATES = ['idle', 'doze']
FLOOR = (250, 240, 226)


def load(atlas_dir: Path, name: str) -> tuple[dict, np.ndarray]:
    data = json.loads((atlas_dir / f'{name}.json').read_text(encoding='utf-8'))
    return data, np.array(Image.open(atlas_dir / f'{name}.png').convert('RGBA'))


def frame_pixels(data: dict, pixels: np.ndarray, key: str) -> np.ndarray:
    f = data['frames'][key]['frame']
    return pixels[f['y']:f['y'] + f['h'], f['x']:f['x'] + f['w']]


def side_offsets(right: dict, right_pixels: np.ndarray, characters: list[str]) -> dict[str, dict[str, int]]:
    back_x = right['meta']['jkCorp']['spec']['backX']
    offsets: dict[str, dict[str, int]] = {}
    for state in STATES:
        offsets[state] = {}
        for character in characters:
            lines = []
            for key in right['animations'][f'char/{character}/right/{state}']:
                a = frame_pixels(right, right_pixels, key)[..., 3] > 0
                lines.append(int(np.nonzero(a[:118, back_x + 2:back_x + 15].any(axis=1))[0].max()))
            offsets[state][character] = SEAT_LINE - min(lines)
    return offsets


def person(atlases: dict, direction: str, character: str, state: str, frame: int) -> tuple[Image.Image, int, int]:
    """그 방향 인물 칸 그림과 앵커(칸 안 x, y). left 는 right 를 좌우 반전 (앵커 = 등)"""
    name = 'right' if direction == 'left' else direction
    data, pixels = atlases[name]
    key = f'char/{character}/{state}' if name == 'down' else f'char/{character}/{name}/{state}'
    frames = data['animations'][key]
    image = Image.fromarray(frame_pixels(data, pixels, frames[frame % len(frames)]))
    spec = data['meta']['jkCorp']['spec']
    anchor_x = spec.get('backX', spec.get('anchorX', image.width // 2))
    if direction == 'left':
        return image.transpose(Image.Transpose.FLIP_LEFT_RIGHT), image.width - anchor_x, spec['baseline']
    return image, anchor_x, spec['baseline']


def compose(prop: Image.Image, seats: list[dict], atlases: dict, offsets: dict, character: str, state: str, frame: int,
            margin: tuple[int, int, int, int]) -> Image.Image:
    """소품 + 모든 자리에 같은 인물. margin = (왼쪽, 위, 오른쪽, 아래) 여백. 소품 왼쪽 위 = (왼쪽, 위)"""
    left, top, right, bottom = margin
    canvas = Image.new('RGBA', (left + prop.width + right, top + prop.height + bottom), FLOOR + (255,))
    canvas.alpha_composite(prop, (left, top))
    anchor_x, anchor_y = left + prop.width / 2, top + prop.height
    for seat in sorted(seats, key=lambda s: s['y']):
        image, cell_x, cell_y = person(atlases, seat['dir'], character, state, frame)
        dy = offsets[state][character] if seat['dir'] in ('right', 'left') else 0
        x = round(anchor_x + seat['x'] - cell_x)
        y = round(anchor_y + seat['y'] + dy - cell_y)
        layer = Image.new('RGBA', canvas.size)
        layer.paste(image, (x, y))
        canvas.alpha_composite(layer)
        for fx, fy, fw, fh in seat.get('front', []):
            canvas.alpha_composite(prop.crop((fx, fy, fx + fw, fy + fh)), (left + fx, top + fy))
    return canvas


def preview(out: Path, props_data: dict, props_pixels: np.ndarray, lounge: dict, atlases: dict, offsets: dict,
            characters: list[str], scale: int, frames: list[int]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    columns = 6
    for prop_id, seats in lounge['seats'].items():
        prop = Image.fromarray(frame_pixels(props_data, props_pixels, f'prop/{prop_id}'))
        # 사람이 소품 밖으로 나오는 만큼 여백 (위로 머리, 옆으로 옆모습, 아래로 발)
        margin = (40, 70, 40, 40)
        for state in STATES:
            for frame in frames:
                tiles = [compose(prop, seats, atlases, offsets, c, state, frame, margin) for c in characters]
                w, h = tiles[0].width * scale, tiles[0].height * scale + 14
                sheet = Image.new('RGBA', (columns * (w + 4), -(-len(tiles) // columns) * (h + 4)), (90, 90, 90, 255))
                draw = ImageDraw.Draw(sheet)
                for i, (character, tile) in enumerate(zip(characters, tiles)):
                    x, y = (i % columns) * (w + 4), (i // columns) * (h + 4)
                    sheet.paste(tile.resize((tile.width * scale, tile.height * scale), Image.Resampling.NEAREST), (x, y + 14))
                    draw.text((x + 2, y + 1), f'{character} {state} {frame}', fill=(255, 255, 255, 255))
                path = out / f'lounge-{prop_id}-{state}-f{frame}.png'
                sheet.save(path)
                print(path.as_posix())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--atlas-dir', required=True, type=Path)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--preview', type=Path)
    parser.add_argument('--scale', type=int, default=2)
    parser.add_argument('--frames', default='0', help='미리보기 칸 번호들 (쉼표)')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    atlases = {name: load(args.atlas_dir, f'office-v5-{name}') for name in ('down', 'up', 'right')}
    right, right_pixels = atlases['right']
    characters = [c['id'] for c in atlases['down'][0]['meta']['jkCorp']['characters']]
    offsets = side_offsets(right, right_pixels, characters)
    print(json.dumps({'sideOffsetY': offsets}, ensure_ascii=False))

    recipe = json.loads(args.recipe.read_text(encoding='utf-8'))
    lounge = recipe['jkCorp']['lounge']
    if args.write:
        lounge['sideOffsetY'] = offsets
        args.recipe.write_text(json.dumps(recipe, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print(f'{args.recipe.as_posix()} 에 썼다')
    if args.preview:
        props_data, props_pixels = load(args.atlas_dir, 'office-v5-props')
        frames = [int(v) for v in args.frames.split(',')]
        preview(args.preview, props_data, props_pixels, lounge, atlases, offsets, characters, args.scale, frames)


if __name__ == '__main__':
    main()
