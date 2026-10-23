"""
생성하지 않고 코드로 그리는 v5 도트 그림: 머리 위 상태 아이콘 3종(작업 중은 3프레임)과 짝 사이 세로 칸막이.
16~20 도트 px 아이콘은 생성 모델이 이 크기로 또렷하게 못 그리고, 세로 칸막이는 원근이 틀리게 나와서 손으로 찍는다.
결과는 생성 원본처럼 마젠타 바탕 격자 한 장(칸 40x160, 그림은 칸 왼쪽 위)이고 레시피가 다른 원본과 같은 방식으로 자른다.

사용:
  python tools/sprites/draw_icons.py --out ~/.claude/jk-corp/sprite-src/v5/drawn.png
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

CELL_W, CELL_H = 40, 160
MAGENTA = (255, 0, 255, 255)
OUTLINE = (31, 36, 48, 255)
WHITE = (255, 255, 255, 255)
RED = (229, 72, 77, 255)
RED_SHADE = (190, 46, 56, 255)
WHITE_SHADE = (214, 220, 230, 255)
LINE = (138, 147, 163, 255)
DOT_ON = (47, 111, 222, 255)
DOT_OFF = (184, 192, 204, 255)

# 말풍선 18x16: 몸통 18x13 (모서리 1px 깎음) + 왼쪽 아래 꼬리
BUBBLE = [
    '.################.',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ffffffffffffffff#',
    '#ssssssssssssssss#',
    '.################.',
    '...#ff#...........',
    '...#f#............',
    '...##.............',
]


def bubble(fill, shade) -> np.ndarray:
    a = np.zeros((len(BUBBLE), len(BUBBLE[0]), 4), np.uint8)
    for y, row in enumerate(BUBBLE):
        for x, ch in enumerate(row):
            if ch == '#':
                a[y, x] = OUTLINE
            elif ch == 'f':
                a[y, x] = fill
            elif ch == 's':
                a[y, x] = shade
    return a


def approval() -> np.ndarray:
    a = bubble(RED, RED_SHADE)
    a[2:7, 8:10] = WHITE   # 느낌표 막대
    a[8:10, 8:10] = WHITE  # 점
    return a


def my_turn() -> np.ndarray:
    a = bubble(WHITE, WHITE_SHADE)
    a[3:5, 4:14] = LINE  # 글 줄 둘
    a[6:8, 4:11] = LINE
    return a


def working(active: int) -> np.ndarray:
    a = bubble(WHITE, WHITE_SHADE)
    for i, x in enumerate((4, 8, 12)):
        a[4:7, x:x + 2] = DOT_ON if i == active else DOT_OFF
    return a


def partition() -> np.ndarray:
    """짝 사이 세로 칸막이 8x144 (자리 한 칸 높이. 위에서 본 얇은 판: 윗면 레일 + 천 면 + 양옆 외곽선)"""
    h, w = 144, 8
    a = np.zeros((h, w, 4), np.uint8)
    a[:, :] = (201, 205, 211, 255)
    a[:, 0] = a[:, -1] = (93, 100, 112, 255)
    a[:, 1] = (178, 183, 191, 255)
    a[::6, 2:6] = (189, 194, 201, 255)  # 천 무늬
    a[0] = a[-1] = (93, 100, 112, 255)
    a[1:3, 1:-1] = (154, 161, 171, 255)  # 위 끝 레일
    a[0, 0] = a[0, -1] = a[-1, 0] = a[-1, -1] = 0  # 모서리를 깎는다 (네모 그대로면 build.py 가 '배경 키가 안 빠짐' 으로 거절)
    return a


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    pieces = [approval(), my_turn(), working(0), working(1), working(2), partition()]
    sheet = np.zeros((CELL_H, CELL_W * len(pieces), 4), np.uint8)
    sheet[:, :] = MAGENTA
    for i, piece in enumerate(pieces):
        h, w = piece.shape[:2]
        region = sheet[4:4 + h, i * CELL_W + 4:i * CELL_W + 4 + w]
        solid = piece[..., 3] > 0
        region[solid] = piece[solid]
    Image.fromarray(sheet).save(args.out)
    print(f'썼다: {args.out} (칸 {len(pieces)}개: approval·my-turn·working 0~2·partition-v)')


if __name__ == '__main__':
    main()
