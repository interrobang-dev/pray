"""
잘림 검사: 그림이 셀·원본 칸 가장자리에 닿은 곳(잘렸을 수 있는 곳)을 모두 센다. 0 개여야 통과 (종료 코드 0).

- 인물: 아틀라스의 인물 프레임(char/...)마다 셀 네 가장자리 줄에 불투명 픽셀이 있는지.
  발은 기준선(baseline) 위에서 끝나므로 아래 가장자리도 닿으면 안 된다
- 소품: 레시피의 원본 칸에서 잘라 낸 덩어리가 그 칸 경계에 닿았는지 (아틀라스의 소품 프레임은 덩어리 크기로 잘라 둬서
  프레임 가장자리로는 알 수 없다). 원본 그림 끝에 닿은 것도 센다. 상자(box)로 자르는 소품은 상자 경계·상자 바로 밖·그림 끝
- 인물 원본 자르기: 칸 경계로 자르는 판은 덩어리가 칸 경계에 닿은 칸을, slice 'figure' 판은 주의 문구(그림 끝에 닿음·이웃과 붙음)를 센다

사용:
  python tools/sprites/check_edges.py --recipe tools/sprites/recipes/office-v5-right.json \
      --source-dir ~/.claude/jk-corp/sprite-src/v5 --atlas web/public/office/office-v5-right
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from spritelib import Figures, figure_slots, load_keyed, longest_run  # noqa: E402


def character_problems(atlas_path: Path) -> list[str]:
    data = json.loads(atlas_path.with_suffix('.json').read_text(encoding='utf-8'))
    atlas = np.array(Image.open(atlas_path.with_suffix('.png')).convert('RGBA'))
    problems = []
    for name, entry in data['frames'].items():
        if not name.startswith('char/'):
            continue
        f = entry['frame']
        alpha = atlas[f['y']:f['y'] + f['h'], f['x']:f['x'] + f['w'], 3] > 0
        sides = {'위': alpha[0], '아래': alpha[-1], '왼쪽': alpha[:, 0], '오른쪽': alpha[:, -1]}
        touched = [f'{side} {int(line.sum())}px' for side, line in sides.items() if line.any()]
        if touched:
            problems.append(f"{name}: 셀 가장자리에 닿음 ({', '.join(touched)})")
    return problems


def piece_touches(solid: np.ndarray, is_whole: bool = False) -> list[str]:
    """칸 하나(불투명 여부)에서 build.py 가 잘라 낼 덩어리가 칸 경계에 닿은 쪽"""
    if is_whole:
        ys, xs = np.nonzero(solid)
        top, bottom, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    else:
        # main_piece 와 같은 덩어리: 가장 긴 줄 구간 → 그 안에서 가장 긴 열 구간
        top, bottom = longest_run(solid.any(axis=1))
        left, right = longest_run(solid[top:bottom].any(axis=0))
        ys = np.nonzero(solid[top:bottom, left:right].any(axis=1))[0]
        top, bottom = top + ys.min(), top + ys.max() + 1
    h, w = solid.shape
    return [side for side, value in (('위', top == 0), ('아래', bottom == h), ('왼쪽', left == 0), ('오른쪽', right == w)) if value]


def box_problems(prop: dict, solid: np.ndarray) -> list[str]:
    """
    상자(box)로 자르는 소품: 덩어리가 상자 경계에 닿았는지, 상자 바로 밖 1px 고리에 불투명 픽셀이 있는지(상자를 넉넉히 잡았어도
    이웃 그림과 붙었거나 그림이 상자 밖으로 이어진 것), 상자가 원본 그림 끝에 닿았는지
    """
    x0, y0, x1, y1 = prop['box']
    h, w = solid.shape
    name, problems = f"prop/{prop['id']}", []
    touched = piece_touches(solid[y0:y1, x0:x1], prop.get('whole', False))
    if touched:
        problems.append(f"{name}: 원본 {prop['sheet']} 상자 {prop['box']} 의 {'·'.join(touched)} 경계에 닿음")
    ring = np.zeros_like(solid)
    ring[max(0, y0 - 1):min(h, y1 + 1), max(0, x0 - 1):min(w, x1 + 1)] = True
    ring[y0:y1, x0:x1] = False
    if (solid & ring).any():
        problems.append(f"{name}: 상자 바로 밖에 불투명 픽셀 {int((solid & ring).sum())}개 (이웃 그림과 붙었을 수 있음)")
    if x0 <= 0 or y0 <= 0 or x1 >= w or y1 >= h:
        problems.append(f"{name}: 상자가 원본 그림 끝에 닿음")
    return problems


def prop_problems(recipe: dict, source: Path) -> list[str]:
    problems = []
    sheets: dict[str, np.ndarray] = {}
    figures: dict[str, Figures] = {}
    for prop in recipe.get('props', []):
        if prop['sheet'] not in sheets:
            sheets[prop['sheet']] = load_keyed(source / prop['sheet'])
        sheet = sheets[prop['sheet']]
        if 'box' in prop:
            problems += box_problems(prop, sheet[..., 3] > 127)
            continue
        columns, rows = prop['grid']
        column, row = prop['cell']
        h, w = sheet.shape[:2]
        y0, y1 = row * h // rows, (row + 1) * h // rows
        x0, x1 = column * w // columns, (column + 1) * w // columns
        if recipe.get('slice') == 'figure':
            # 덩어리 단위로 자르는 판: 칸 경계는 상관없고 그림 끝에 닿았거나 이웃과 붙은 것만
            if prop['sheet'] not in figures:
                figures[prop['sheet']] = Figures(sheet, prop['sheet'])
            _, notes = figures[prop['sheet']].figure_piece(x0, y0, x1, y1, prop.get('whole', False))
            problems += [f"prop/{prop['id']}: {note}" for note in notes]
            continue
        touched = piece_touches(sheet[y0:y1, x0:x1, 3] > 127, prop.get('whole', False))
        if touched:
            problems.append(f"prop/{prop['id']}: 원본 {prop['sheet']} 칸 {prop['cell']} 의 {'·'.join(touched)} 경계에 닿음")
    return problems


def slice_problems(recipe: dict, source: Path) -> list[str]:
    problems = []
    is_figure = recipe.get('slice') == 'figure'
    sheets: dict[Path, np.ndarray] = {}
    for character in recipe.get('characters', []):
        for row in character['rows']:
            path = source / (row['grid'] if 'grid' in row else row['strip'])
            columns, rows, row_index = (*row['gridSize'], row['gridRow']) if 'grid' in row else (row['count'], 1, 0)
            if not is_figure:
                # 칸 경계로 자르는 판: 덩어리가 칸 경계에 닿으면 거기서 잘렸다
                if path not in sheets:
                    sheets[path] = load_keyed(path)[..., 3] > 127
                solid = sheets[path]
                h, w = solid.shape
                band = solid[row_index * h // rows:(row_index + 1) * h // rows]
                edges = np.linspace(0, w, columns + 1).astype(int)
                for k in range(columns):
                    touched = piece_touches(band[:, edges[k]:edges[k + 1]])
                    if touched:
                        problems.append(f"char/{character['id']}/{row['state']} {k}칸: 원본 {path.name} 칸 {'·'.join(touched)} 경계에 닿음")
                continue
            if 'grid' in row:
                _, notes = figure_slots(source / row['grid'], row['gridSize'][0], row['gridSize'][1], row['gridRow'])
            else:
                _, notes = figure_slots(source / row['strip'], row['count'], 1, 0)
            problems += [f"char/{character['id']}/{row['state']}: {note}" for note in notes]
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--recipe', required=True, type=Path)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--atlas', required=True, type=Path, help='아틀라스 경로 (확장자 없이)')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')
    recipe = json.loads(args.recipe.read_text(encoding='utf-8'))
    problems = character_problems(args.atlas) + prop_problems(recipe, args.source_dir) + slice_problems(recipe, args.source_dir)
    for problem in problems:
        print(problem)
    print(f"{recipe['name']}: 잘림 {len(problems)}개")
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
