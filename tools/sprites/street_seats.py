"""
퇴근 거리(v6) 자리 메타를 인물 아틀라스에서 잰다. 인물 그림을 다시 만들면 다시 돌린다.

- sideSeatLift[상태][인물]: 옆모습(office-v5-right) 그 상태 모든 칸의 엉덩이 아래 선(셀 x backX+2..backX+14 에서 y 118 위 가장 아래
  불투명 줄) 중 가장 높은 것을 SEAT_LINE 에 맞추는 의자 높이 변화 = SEAT_LINE - 그 줄. 사람은 발(셀 y 123, 18명 모두 같다)을
  바닥에 두고, 의자를 그만큼 높이거나 낮춘 그림(prop/cafe-chair-h<높이>, 레시피 lifts)을 쓴다. 칸마다 1px 오르내리는 인물은
  가장 높은 칸에 맞춰 엉덩이가 상판에 1px 묻히는 쪽을 고른다 (뜨는 것보다 덜 보인다)
- headBox[인물]: 정면(office-v5-down) idle 모든 칸에서 머리 맨 위 줄부터 HEAD_ROWS 줄 안의 불투명 가로 범위 [x0, top, x1]
  (셀 좌표, 칸들의 합집합. top 은 가장 높은 칸). 집 창 얼굴 위치를 정한다 (설계 문서 "퇴근 거리 (v6)")

사용:
  python tools/sprites/street_seats.py --recipe tools/sprites/recipes/office-v6-street.json --atlas-dir web/public/office [--write]
--write 면 레시피 jkCorp.street 의 sideSeatLift·headBox 를 고쳐 쓴다 (아니면 출력만)
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

SEAT_LINE = 100
HEAD_ROWS = 27
STATES = ['typing', 'raise-hand', 'idle', 'doze']


def load(atlas_dir: Path, name: str) -> tuple[dict, np.ndarray]:
    data = json.loads((atlas_dir / f'{name}.json').read_text(encoding='utf-8'))
    return data, np.array(Image.open(atlas_dir / f'{name}.png').convert('RGBA'))[..., 3] > 0


def frame_alpha(data: dict, alpha: np.ndarray, key: str) -> np.ndarray:
    f = data['frames'][key]['frame']
    return alpha[f['y']:f['y'] + f['h'], f['x']:f['x'] + f['w']]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--atlas-dir', required=True, type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    down, down_alpha = load(args.atlas_dir, 'office-v5-down')
    right, right_alpha = load(args.atlas_dir, 'office-v5-right')
    back_x = right['meta']['jkCorp']['spec']['backX']
    characters = [c['id'] for c in down['meta']['jkCorp']['characters']]

    lifts: dict[str, dict[str, int]] = {}
    for state in STATES:
        lifts[state] = {}
        for character in characters:
            lines = []
            for key in right['animations'][f'char/{character}/right/{state}']:
                a = frame_alpha(right, right_alpha, key)
                lines.append(int(np.nonzero(a[:118, back_x + 2:back_x + 15].any(axis=1))[0].max()))
            lifts[state][character] = SEAT_LINE - min(lines)

    heads: dict[str, list[int]] = {}
    for character in characters:
        x0, x1, top = 999, -1, 999
        for key in down['animations'][f'char/{character}/idle']:
            a = frame_alpha(down, down_alpha, key)
            ys = np.nonzero(a.any(axis=1))[0]
            xs = np.nonzero(a[ys.min():ys.min() + HEAD_ROWS].any(axis=0))[0]
            x0, x1, top = min(x0, int(xs.min())), max(x1, int(xs.max()) + 1), min(top, int(ys.min()))
        heads[character] = [x0, top, x1]

    recipe = json.loads(args.recipe.read_text(encoding='utf-8'))
    chair = next(p for p in recipe['props'] if 'lifts' in p)
    low, high = chair['lifts']['range']
    used = [v for table in lifts.values() for v in table.values()]
    print(json.dumps({'sideSeatLift': lifts, 'headBox': heads}, ensure_ascii=False))
    print(f'의자 높이 변화 {min(used)}..{max(used)} (레시피 {chair["id"]} lifts.range {low}..{high})')
    if min(used) < low or max(used) > high:
        print('주의: 레시피 lifts.range 가 잰 범위를 덮지 못한다', file=sys.stderr)
        sys.exit(1)
    if args.write:
        street = recipe['jkCorp']['street']
        street['sideSeatLift'] = lifts
        street['headBox'] = heads
        args.recipe.write_text(json.dumps(recipe, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        print(f'{args.recipe.as_posix()} 에 썼다')


if __name__ == '__main__':
    main()
