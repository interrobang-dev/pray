"""
v5 칸막이 블록 모듈: 이어 붙이면 한 덩어리로 보이는 책상 섬 조각들을 생성 원본(v5-desks.png)의 책상 그림에서 코드로 짓는다.

생성한 책상(desk-down·desk-up·desk-right)은 원근 때문에 옆면이 비스듬해 옆으로 붙이면 이음매가 보인다. 그래서
- 책상의 빈 열(모니터·키보드가 없는 세로 한 줄)을 옆으로 반복해 직사각형으로 펴고, 모니터·키보드가 있는 가운데 열들만 원본 그대로 둔다
- 위·아래 책상을 가운데 가로 칸막이로 붙이고(desk-up 의 낮은 칸막이 = 윗책상 앞판을 가린다), 왼쪽 끝에 세로 칸막이를 세운다
결과는 생성 원본처럼 마젠타 바탕 격자 한 장(blocks.png, 칸 128x128)이고 office-v5-props 레시피가 다른 원본과 같은 방식으로 자른다.

모듈 (도트 px, 모두 높이 96 = 2타일):
- block-pair 96: 마주 보는 두 자리. 윗책상(모니터 뒷면) + 가운데 가로 칸막이 + 아랫책상(화면·키보드) + 왼쪽 세로 칸막이.
  아랫책상 화면은 레시피 screenOff 로 꺼짐 그림 block-pair-off 를 만든다
- block-end-right 6: 블록 오른쪽 끝 세로 칸막이
- block-end-left 12: 블록 왼쪽 끝 수납 칸막이 판 (지휘자 없는 섬)
- block-lead 48: 블록 왼쪽 끝 수납 칸막이 판 + 그 왼쪽에 붙은 지휘자 옆 책상(옆에서 본 모니터·키보드). screenOff 로 block-lead-off

사용:
  python tools/sprites/draw_blocks.py --source-dir ~/.claude/jk-corp/sprite-src/v5
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from build import build_props  # noqa: E402
from spritelib import label_components  # noqa: E402

RECIPE = Path(__file__).parent / 'recipes' / 'office-v5-props.json'
CELL = 128
MAGENTA = (255, 0, 255, 255)
HEIGHT = 96
OUTLINE = (31, 36, 48, 255)
RAIL = (227, 227, 225, 255)
RAIL_SHADE = (203, 203, 199, 255)
FABRIC = (178, 179, 183, 255)
FABRIC_SHADE = (150, 152, 158, 255)
SURFACE = (250, 250, 249, 255)
EDGE_LIGHT = (253, 253, 253, 255)
FRONT = (225, 226, 228, 255)
FRONT_LINE = (185, 189, 198, 255)
PANEL_TOP = (206, 209, 214, 255)
PANEL_FRONT = (168, 173, 181, 255)
PANEL_LINE = (138, 144, 155, 255)

TEMPLATE_X = 10  # 책상 그림에서 비어 있는 세로 한 줄 (모니터·키보드 없음, 비스듬한 옆면 안쪽)
TOP_ROWS = 35  # 윗책상(desk-down)에서 쓰는 줄 수: 모니터 위 끝 ~ 상판 앞 끝. 그 아래 앞판은 가운데 칸막이가 가린다
BOTTOM_ROWS = 61  # 아랫책상(desk-up) 전부: 낮은 칸막이(0~17) + 상판 + 앞판 + 아래 외곽선


def desks(source: Path) -> dict[str, np.ndarray]:
    recipe = json.loads(RECIPE.read_text(encoding='utf-8'))
    recipe['props'] = [p for p in recipe['props'] if p['id'] in ('desk-down', 'desk-up', 'desk-right')]
    for prop in recipe['props']:
        prop.pop('screenOff', None)
    sprites, _, _ = build_props(recipe, source, [])
    return {name.removeprefix('prop/'): a for name, a in sprites.items()}


def objects(a: np.ndarray, background: np.ndarray, margin: int) -> list[np.ndarray]:
    """
    배경(빈 열 또는 흰 상판)과 크게 다른 덩어리(모니터·키보드·마우스)의 모양 마스크들.
    12픽셀 미만 점(천 무늬 잡티)과 옆 가장자리 margin 안에 걸친 덩어리(비스듬한 옆면 외곽선)는 뺀다
    """
    differs = (np.abs(a[..., :3].astype(int) - background[..., :3].astype(int)).sum(axis=2) > 90) & (a[..., 3] > 0)
    labels = label_components(differs)
    shapes = []
    for label in range(1, int(labels.max()) + 1):
        ys, xs = np.nonzero(labels == label)
        if len(ys) < 12 or xs.min() < margin or xs.max() >= a.shape[1] - margin:
            continue
        # 줄마다 덩어리 왼쪽 끝 ~ 오른쪽 끝을 채운 모양 (화면 안 밝은 칸처럼 배경과 비슷한 속 픽셀까지. 상자 전체를 옮기면 옆 천 무늬 잡티가 따라온다)
        shape = np.zeros(a.shape[:2], bool)
        for y in np.unique(ys):
            row = xs[ys == y]
            shape[y, row.min():row.max() + 1] = True
        shapes.append(shape)
    return shapes


def stretch(desk: np.ndarray, rows: int, width: int) -> np.ndarray:
    """
    책상을 폭 width 직사각형으로 편다: 빈 열(TEMPLATE_X)을 옆으로 반복하고, 모니터·키보드·마우스 상자만 원본에서 가운데 자리로 옮긴다 —
    비스듬한 옆면과 천 무늬 잡티가 없어져 옆으로 붙여도 이어진다
    """
    a = desk[:rows]
    template = a[:, TEMPLATE_X]
    out = np.repeat(template[:, None], width, axis=1)
    offset = (width - a.shape[1]) // 2
    for shape in objects(a, np.repeat(template[:, None], a.shape[1], axis=1), TEMPLATE_X + 2):
        ys, xs = np.nonzero(shape & (a[..., 3] > 0))
        out[ys, xs + offset] = a[ys, xs]
    return out


def vertical_partition(height: int) -> np.ndarray:
    """세로 칸막이 6 폭: 외곽선 · 밝은 레일 · 천 · 천 · 그늘 · 외곽선. 위 끝 레일, 아래 끝 외곽선"""
    a = np.zeros((height, 6, 4), np.uint8)
    a[:, :] = FABRIC
    a[:, 1] = RAIL
    a[:, 4] = FABRIC_SHADE
    a[:, 0] = a[:, 5] = OUTLINE
    a[1:3, 1:5] = RAIL
    a[3, 1:5] = RAIL_SHADE
    a[0] = a[-1] = OUTLINE
    return a


def round_corners(a: np.ndarray) -> np.ndarray:
    """네 모서리 한 픽셀을 비운다 (네모 그대로면 build.py 가 '배경 키가 안 빠짐' 으로 거절하고, 도트 모서리도 부드럽다)"""
    a[0, 0] = a[0, -1] = a[-1, 0] = a[-1, -1] = 0
    return a


def pair(desk_down: np.ndarray, desk_up: np.ndarray) -> np.ndarray:
    top = stretch(desk_down, TOP_ROWS, 96)
    bottom = stretch(desk_up, BOTTOM_ROWS, 96)
    a = np.concatenate([top, bottom], axis=0)
    a[:, 0:6] = vertical_partition(HEIGHT)
    return a


def storage_panel(width: int) -> np.ndarray:
    """수납 칸막이 판: 위에서 본 윗면(옅은 회색, 서류철 몇 개) + 아래쪽 앞면(서랍 줄)"""
    a = np.zeros((HEIGHT, width, 4), np.uint8)
    face = HEIGHT - 16
    a[:face] = PANEL_TOP
    a[face:] = PANEL_FRONT
    a[face, :] = (230, 232, 236, 255)  # 윗면 앞 모서리 밝은 줄
    for y in (face + 6, face + 11):
        a[y, 2:-2] = PANEL_LINE
    a[face + 3:face + 5, width // 2 - 1:width // 2 + 1] = OUTLINE  # 손잡이
    # 윗면의 서류철·작은 상자 (참고 그림의 수납 칸 위 물건)
    for y0, color in ((10, (75, 120, 196, 255)), (16, (235, 196, 74, 255)), (22, (96, 168, 120, 255))):
        a[y0:y0 + 4, 3:width - 3] = color
        a[y0 + 4, 3:width - 3] = PANEL_LINE
    a[:, 0] = a[:, -1] = OUTLINE
    a[0] = a[-1] = OUTLINE
    return a


def side_desk(desk_right: np.ndarray, width: int) -> np.ndarray:
    """지휘자 옆 책상 (위에서 본 직사각형 상판 + 아래 앞판). desk-right 의 모니터·키보드(흰 상판이 아닌 픽셀)를 그대로 옮긴다"""
    a = np.zeros((HEIGHT, width, 4), np.uint8)
    face = HEIGHT - 18
    a[:face] = SURFACE
    a[face] = EDGE_LIGHT
    a[face + 1:] = FRONT
    a[face + 6, 1:-1] = FRONT_LINE
    # desk-right 의 모니터·키보드 (흰 상판과 다른 덩어리) 를 상판 위로 옮긴다. 가로는 원본 옆 책상 안쪽 위치를 폭에 맞춘다
    white = np.zeros_like(desk_right)
    white[..., :3] = SURFACE[:3]
    margin = 6
    for shape in objects(desk_right[:face], white[:face], margin):
        ys, xs = np.nonzero(shape & (desk_right[:face, :, 3] > 0))
        # 원본 옆 책상(48 폭, 옆면 외곽선 x 5 근처)보다 좁아 왼쪽으로 7 당긴다: 모니터가 오른쪽 수납 판 바로 앞, 키보드는 왼쪽(지휘자 쪽)
        a[ys + 6, xs - 7] = desk_right[ys, xs]
    a[:, 0] = a[:, -1] = OUTLINE
    a[0] = a[-1] = OUTLINE
    return a


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source-dir', required=True, type=Path)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    d = desks(args.source_dir)
    panel = storage_panel(12)
    lead = np.concatenate([side_desk(d['desk-right'], 36), panel], axis=1)
    pieces = [pair(d['desk-down'], d['desk-up']), round_corners(vertical_partition(HEIGHT)), round_corners(panel.copy()), round_corners(lead)]
    sheet = np.zeros((CELL, CELL * len(pieces), 4), np.uint8)
    sheet[:, :] = MAGENTA
    for i, piece in enumerate(pieces):
        h, w = piece.shape[:2]
        region = sheet[16:16 + h, i * CELL + 16:i * CELL + 16 + w]
        solid = piece[..., 3] > 0
        region[solid] = piece[solid]
    out = args.source_dir / 'blocks.png'
    Image.fromarray(sheet).save(out)
    print(f'썼다: {out} (칸 {len(pieces)}개: block-pair·block-end-right·block-end-left·block-lead)')


if __name__ == '__main__':
    main()
