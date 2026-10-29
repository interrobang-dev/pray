"""
ponytail 뒷모습(office-v5-up) 16칸의 하체를 뒷모습으로 고친다. v5-up 을 build.py 로 다시 뽑을 때마다 돌린다.

생성 원본 `sprite-src/v5/chars/ponytail-up.png` 은 프롬프트("Knees point away … only the heels of the shoes may peek out")와
달리 하체가 앞모습으로 앉은 모양이다 (허리 아래 무릎 둘·내려오는 정강이·발등 피부가 보이는 앞코 플랫슈즈. 16칸 전부).
그래서 의자 등받이 위로 무릎이, 라운지 의자 아래로 앞코가 보이고, 하체가 길어 윗몸이 다른 인물보다 14줄 높다.

고치는 법: 칸마다 줄 CUT 위(머리·블라우스·벨트·바지 맨 위·손)를 SHIFT 줄 내리고, 그 아래는 같은 상태 member 뒷모습 첫 칸의
줄 SEAT 아래(엉덩이·뒤꿈치)를 ponytail 바지·신발 색으로 바꿔 붙인다 (밝기 분포를 ponytail idle 첫 칸의 바지·신발에 맞춘다).
아틀라스의 기존 팔레트 색만 쓰고 ponytail up 16칸 밖의 팔레트 번호는 그대로 둔다 — 다른 인물 픽셀은 바뀌지 않는다.

두 번 돌려도 된다: 줄 SEAT 아래에 피부색 픽셀이 칸마다 SKIN_MIN 개 이상이면(원본 발등) 고치고, 16칸 모두 0 이면 이미 고친
것으로 보고 아무것도 쓰지 않는다 (종료 코드 0). 섞여 있으면 종료 코드 1.

v5-up 을 다시 뽑을 때 순서:
  1. python tools/sprites/build.py --recipe tools/sprites/recipes/office-v5-up.json \
         --source-dir ~/.claude/pray/sprite-src/v5 --out web/public/office
  2. python tools/sprites/patch_ponytail_up.py --atlas web/public/office/office-v5-up
  3. python tools/sprites/mask.py --recipe tools/sprites/recipes/office-v5-up-recolor.json \
         --atlas web/public/office/office-v5-up --sample-atlas web/public/office/office-v5-down
  4. python tools/sprites/check_edges.py --recipe tools/sprites/recipes/office-v5-up.json \
         --source-dir ~/.claude/pray/sprite-src/v5 --atlas web/public/office/office-v5-up   (고친 뒤에도 잘림 0개)
`--out` 을 주면 그 PNG 에 쓰고, 없으면 `--atlas` 의 PNG 를 고쳐 쓴다.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

STATES = ['typing', 'raise-hand', 'idle', 'doze']
CELL = (92, 128)
CUT = 90  # ponytail 은 이 줄 위만 남긴다
SHIFT = 14  # 윗몸을 내리는 줄 수 (ponytail 바지 맨 위 90 → member 엉덩이 맨 위 104)
SEAT = 104  # member 칸에서 이 줄 아래(엉덩이·뒤꿈치)를 가져온다
SKIN_MIN = 20  # 원본 칸의 줄 SEAT 아래 피부색 픽셀은 58~79 개


def luminance(colors: np.ndarray) -> np.ndarray:
    colors = colors.astype(float)
    return 0.299 * colors[..., 0] + 0.587 * colors[..., 1] + 0.114 * colors[..., 2]


def is_gray(pixels: np.ndarray) -> np.ndarray:
    return (pixels.max(1).astype(int) - pixels.min(1)) < 40


def skin_count(cell: np.ndarray) -> int:
    lower = cell[SEAT:].astype(int)
    r, g, b, a = lower[..., 0], lower[..., 1], lower[..., 2], lower[..., 3]
    return int(((a > 0) & (r > 180) & (g > 120) & (r - b > 40)).sum())


def solid_pixels(cell: np.ndarray, y0: int, y1: int) -> np.ndarray:
    band = cell[y0:y1]
    return band[band[..., 3] > 0][:, :3]


def match_luminance(colors: np.ndarray, source_pixels: np.ndarray, target_pixels: np.ndarray, targets: np.ndarray) -> list:
    """colors 마다 source 픽셀 밝기에서의 분위 → target 픽셀 밝기의 같은 분위 → 그 밝기에 가장 가까운 targets 색"""
    source = np.sort(luminance(source_pixels))
    target = np.sort(luminance(target_pixels))
    target_colors = luminance(targets)
    result = []
    for color in colors:
        quantile = np.searchsorted(source, luminance(color), side='right') / len(source)
        want = target[min(int(quantile * (len(target) - 1)), len(target) - 1)]
        result.append(targets[np.abs(target_colors - want).argmin()])
    return result


def seat_from(member: np.ndarray, pant_colors: np.ndarray, pant_pixels: np.ndarray, shoe_colors: np.ndarray, shoe_pixels: np.ndarray) -> np.ndarray:
    """member 칸의 줄 SEAT 아래를 ponytail 바지·신발 색으로 바꾼 칸 (그 위는 투명)"""
    seat = member.copy()
    seat[:SEAT] = 0
    solid = seat[..., 3] > 0
    pixels = seat[solid][:, :3].astype(int)
    colors = np.unique(pixels, axis=0)
    is_navy = (colors[:, 2] - colors[:, 0] > 15) & (colors.max(1) > 45)  # 남색 바지
    is_sneaker = (colors.max(1) - colors.min(1) < 40) & (colors.max(1) > 110)  # 흰·회색 운동화
    is_outline = colors.max(1) <= 45
    is_sweater = (colors[:, 0] > 120) & (colors[:, 2] < 110)  # 스웨터 끝단 → 바지 색
    def pixels_of(selected: np.ndarray) -> np.ndarray:
        return pixels[(pixels[:, None, :] == colors[selected][None, :, :]).all(2).any(1)]
    table = {}
    pant_like = is_navy | is_sweater
    for color, mapped in zip(colors[pant_like], match_luminance(colors[pant_like], pixels_of(is_navy), pant_pixels, pant_colors[1:])):
        table[tuple(color)] = mapped
    for color, mapped in zip(colors[is_sneaker], match_luminance(colors[is_sneaker], pixels_of(is_sneaker), shoe_pixels, shoe_colors)):
        table[tuple(color)] = mapped
    for color in colors[is_outline]:
        table[tuple(color)] = pant_colors[0]
    for color in colors:  # 나머지(갈색 그림자 등)는 밝기가 가까운 바지 색
        if tuple(color) not in table:
            table[tuple(color)] = pant_colors[np.abs(luminance(pant_colors) - luminance(color)).argmin()]
    for y, x in zip(*np.nonzero(solid)):
        seat[y, x, :3] = table[tuple(seat[y, x, :3].astype(int))]
    return seat


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--atlas', required=True, type=Path, help='office-v5-up 아틀라스 경로 (확장자 없이. .png·.json 을 읽는다)')
    parser.add_argument('--out', type=Path, help='쓸 PNG (없으면 --atlas 의 PNG 를 고쳐 쓴다)')
    args = parser.parse_args()
    # Windows 콘솔 기본 인코딩(cp949)이면 한글 출력이 깨진다
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')

    data = json.loads(args.atlas.with_suffix('.json').read_text(encoding='utf-8'))
    source = Image.open(args.atlas.with_suffix('.png'))
    if source.mode != 'P':
        print('팔레트 PNG 가 아니다', file=sys.stderr)
        return 1
    palette = np.array(source.getpalette()[:256 * 3]).reshape(-1, 3)
    rgba = np.array(source.convert('RGBA'))
    index = np.array(source)

    def rect(name: str) -> tuple[int, int, int, int]:
        frame = data['frames'][name]['frame']
        if (frame['w'], frame['h']) != CELL:
            raise SystemExit(f'{name}: 셀이 {CELL} 가 아니다 — 규격이 바뀌면 CUT·SHIFT·SEAT 를 다시 잰다')
        return frame['x'], frame['y'], frame['w'], frame['h']

    def cell(name: str) -> np.ndarray:
        x, y, w, h = rect(name)
        return rgba[y:y + h, x:x + w].copy()

    names = [f'char/ponytail/up/{state}/{i}' for state in STATES for i in range(4)]
    skins = [skin_count(cell(name)) for name in names]
    if all(count == 0 for count in skins):
        print('이미 고친 아틀라스다 (ponytail up 16칸 하체에 피부색 없음). 쓰지 않는다')
        return 0
    if not all(count >= SKIN_MIN for count in skins):
        print(f'원본도 고친 것도 아니다 — 칸마다 하체 피부색 픽셀 {skins}', file=sys.stderr)
        return 1

    # ponytail 바지·신발 색: idle 첫 칸의 줄 90~110 무채색(바지), 줄 116~124 무채색(신발). 가장 어두운 바지 색이 외곽선.
    # 바지 밝기 분포에서는 순검정(외곽선)을 뺀다 — 넣으면 엉덩이가 더 어두운 색으로 칠해진다
    idle = cell('char/ponytail/up/idle/0')
    pant_pixels = solid_pixels(idle, 90, 110)
    pant_pixels = pant_pixels[is_gray(pant_pixels)]
    shoe_pixels = solid_pixels(idle, 116, 125)
    shoe_pixels = shoe_pixels[is_gray(shoe_pixels)]
    pant_colors = np.unique(pant_pixels, axis=0)
    pant_pixels = pant_pixels[pant_pixels.max(1) > 0]
    pant_colors = pant_colors[np.argsort(luminance(pant_colors))]
    shoe_colors = np.unique(shoe_pixels, axis=0)
    shoe_colors = shoe_colors[np.argsort(luminance(shoe_colors))]

    color_index = {}
    for i, color in enumerate(palette):
        if i > 0:
            color_index.setdefault(tuple(int(v) for v in color), i)
    for state in STATES:
        seat = seat_from(cell(f'char/member/up/{state}/0'), pant_colors, pant_pixels, shoe_colors, shoe_pixels)
        for i in range(4):
            name = f'char/ponytail/up/{state}/{i}'
            x, y, w, h = rect(name)
            old = cell(name)
            new = seat.copy()
            upper = np.zeros_like(old)
            upper[SHIFT:CUT + SHIFT] = old[:CUT]
            new[upper[..., 3] > 0] = upper[upper[..., 3] > 0]
            patched = np.zeros((h, w), np.uint8)
            for py, px in zip(*np.nonzero(new[..., 3] > 0)):
                key = tuple(int(v) for v in new[py, px, :3])
                if key not in color_index:
                    print(f'{name}: 팔레트에 없는 색 {key}', file=sys.stderr)
                    return 1
                patched[py, px] = color_index[key]
            index[y:y + h, x:x + w] = patched

    out = args.out or args.atlas.with_suffix('.png')
    image = Image.fromarray(index, 'P')
    image.putpalette(source.getpalette())
    image.save(out, optimize=True, transparency=0)
    print(f'썼다: {out} (ponytail up {len(names)}칸)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
