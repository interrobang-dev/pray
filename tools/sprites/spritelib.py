"""사무실 스프라이트 공통 처리 (numpy·Pillow 만). 규격은 docs/plans/2026-10-22-office-sprites-design.md"""
from pathlib import Path

import numpy as np
from PIL import Image


def load_keyed(path: Path) -> np.ndarray:
    """마젠타(#FF00FF) 배경을 투명으로. 가장자리에 섞인 마젠타 기운까지 뺀다 (RGBA uint8)"""
    a = np.array(Image.open(path).convert('RGBA')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    magenta = (r - g > 90) & (b - g > 90) & (abs(r - b) < 90)
    a[magenta] = 0
    return a.astype(np.uint8)


def load_rgb(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert('RGB'))


def opaque(rgb: np.ndarray) -> np.ndarray:
    return np.dstack([rgb, np.full(rgb.shape[:2], 255, np.uint8)])


def crop_bbox(a: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(a[..., 3] > 127)
    if len(ys) == 0:
        raise ValueError('빈 그림 (불투명 픽셀 없음)')
    return a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def longest_run(mask) -> tuple[int, int]:
    """참이 가장 길게 이어진 구간 [start, end)"""
    runs, start = [], None
    for i, value in enumerate(list(mask) + [False]):
        if value and start is None:
            start = i
        elif not value and start is not None:
            runs.append((i - start, start, i))
            start = None
    if not runs:
        raise ValueError('빈 그림 (불투명 픽셀 없음)')
    _, begin, end = max(runs)
    return begin, end


def main_piece(a: np.ndarray) -> np.ndarray:
    """빈 줄·빈 열로 떨어진 조각(아래쪽 선, 떨어진 점)은 버리고 가장 긴 덩어리만 잘라 낸다"""
    y0, y1 = longest_run((a[..., 3] > 127).any(axis=1))
    b = a[y0:y1]
    x0, x1 = longest_run((b[..., 3] > 127).any(axis=0))
    return crop_bbox(b[:, x0:x1])


def downscale(a: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """
    도트를 흐리지 않는 축소: 블록마다 가장 많은 색(24 단위로 묶어 센 뒤 그 묶음의 중앙값).
    블록의 절반 넘게 불투명일 때만 칠하므로 알파는 0 또는 255 뿐이다
    """
    h, w = a.shape[:2]
    result = np.zeros((out_h, out_w, 4), np.uint8)
    xs = np.linspace(0, w, out_w + 1).astype(int)
    ys = np.linspace(0, h, out_h + 1).astype(int)
    for j in range(out_h):
        for i in range(out_w):
            block = a[ys[j]:max(ys[j + 1], ys[j] + 1), xs[i]:max(xs[i + 1], xs[i] + 1)].reshape(-1, 4)
            solid = block[block[:, 3] > 127]
            if len(solid) * 2 <= len(block):
                continue
            quant = (solid[:, :3] // 24).astype(int)
            keys = quant[:, 0] * 10000 + quant[:, 1] * 100 + quant[:, 2]
            values, counts = np.unique(keys, return_counts=True)
            members = solid[keys == values[counts.argmax()]][:, :3]
            result[j, i, :3] = np.median(members, axis=0)
            result[j, i, 3] = 255
    return result


def fit_width(a: np.ndarray, width: int) -> np.ndarray:
    return downscale(a, width, max(1, round(a.shape[0] * width / a.shape[1])))


# ---------- 캐릭터 ----------

def strip_slots(path: Path, count: int) -> list[np.ndarray]:
    """생성된 가로 한 줄 그림을 같은 폭 칸으로 나눠 칸마다 인물 덩어리만 잘라 낸다"""
    a = load_keyed(path)
    edges = np.linspace(0, a.shape[1], count + 1).astype(int)
    return [main_piece(a[:, edges[k]:edges[k + 1]]) for k in range(count)]


def grid_slots(path: Path, columns: int, rows: int, row: int) -> list[np.ndarray]:
    """생성된 격자 그림(rows 행 x columns 칸)의 row 번째 행을 칸마다 인물 덩어리만 잘라 낸다"""
    a = load_keyed(path)
    h, w = a.shape[:2]
    band = a[row * h // rows:(row + 1) * h // rows]
    edges = np.linspace(0, w, columns + 1).astype(int)
    return [main_piece(band[:, edges[k]:edges[k + 1]]) for k in range(columns)]


def body_metrics(frame: np.ndarray) -> tuple[float, int, int]:
    """
    (발 중심 x, 발 아래 끝 y, 머리 위 끝 y).
    머리 위 끝은 발 중심 ±18% 폭 띠 안에서만 본다 — 옆으로 든 팔·손이 키에 들어가지 않게
    """
    alpha = frame[..., 3] > 127
    h, w = alpha.shape
    bottom = int(np.nonzero(alpha.any(axis=1))[0].max())
    feet = alpha[bottom - int(h * 0.06):bottom + 1]
    feet_x = np.nonzero(feet.any(axis=0))[0]
    center = (feet_x.min() + feet_x.max()) / 2
    band = alpha[:, max(0, int(center - w * 0.18)):int(center + w * 0.18)]
    top = int(np.nonzero(band.any(axis=1))[0].min())
    return float(center), bottom, top


def normalize_row(frames: list[np.ndarray], cell_w: int, cell_h: int, body_h: int, baseline: int,
                  scale: float | None = None, back_x: int | None = None) -> list[np.ndarray]:
    """
    한 상태의 프레임들을 규격 셀에 놓는다: 발 아래 끝 = baseline - 1 행, 발 중심 = 셀 가운데,
    배율은 그 상태 프레임들의 (body_h / 몸 높이) 중앙값 하나 (팔이 머리 가까이 오면 키를 잘못 재는 프레임이 있어서).
    scale 을 주면 그 배율을 그대로 쓴다 (뒷모습·옆모습은 몸 높이로 못 맞춘다 — 머리 폭으로 정해 레시피에 적는다).
    back_x 를 주면 발 중심 대신 하체(아래 절반)의 왼쪽 끝(옆모습의 등·엉덩이)을 셀 x = back_x 에 놓는다
    """
    metrics = [body_metrics(frame) for frame in frames]
    if scale is None:
        scale = float(np.median([body_h / (bottom - top + 1) for _, bottom, top in metrics]))
    cells = []
    for frame, (center, bottom, _) in zip(frames, metrics):
        frame = frame[:bottom + 1]
        new_w = max(1, round(frame.shape[1] * scale))
        new_h = max(1, round(frame.shape[0] * scale))
        small = downscale(frame, new_w, new_h)
        cell = np.zeros((cell_h, cell_w, 4), np.uint8)
        if back_x is None:
            ox = round(cell_w / 2 - center * scale)
        else:
            lower = small[new_h // 2:, :, 3] > 127
            ox = back_x - int(np.nonzero(lower.any(axis=0))[0].min())
        oy = baseline - new_h
        sx0, sy0 = max(0, -ox), max(0, -oy)
        dx0, dy0 = max(0, ox), max(0, oy)
        width = min(new_w - sx0, cell_w - dx0)
        height = min(new_h - sy0, cell_h - dy0)
        cell[dy0:dy0 + height, dx0:dx0 + width] = small[sy0:sy0 + height, sx0:sx0 + width]
        cells.append(cell)
    return cells


# ---------- 바닥·벽 ----------

def remove_grid_lines(rgb: np.ndarray, dark_sum: int = 150, ratio: float = 0.2, grow: int = 2) -> np.ndarray:
    """모델이 그린 검은 타일 경계선: 어두운 픽셀 비율이 ratio 넘는 행·열과 그 양옆 grow px 를 지우고 이어 붙인다"""
    dark = rgb.astype(int).sum(axis=2) < dark_sum
    kernel = np.ones(2 * grow + 1, int)
    spread = lambda mask: np.convolve(mask.astype(int), kernel, mode='same') > 0
    keep_cols = ~spread(dark.mean(axis=0) > ratio)
    keep_rows = ~spread(dark[:, keep_cols].mean(axis=1) > ratio)
    return rgb[keep_rows][:, keep_cols]


def fill_dark_lines(rgb: np.ndarray, keep: tuple[int, int, int, int] | None, dark_sum: int = 150) -> np.ndarray:
    """어두운 선 픽셀을 왼쪽(없으면 위쪽)의 밝은 픽셀로 메운다. keep (x0, y0, x1, y1) 사각형(창 등)과 그 둘레 6px 는 건드리지 않는다"""
    out = rgb.copy()
    dark = rgb.astype(int).sum(axis=2) < dark_sum
    for y, x in zip(*np.nonzero(dark)):
        if keep and keep[0] - 6 <= x <= keep[2] + 6 and keep[1] - 6 <= y <= keep[3] + 6:
            continue
        sx = x
        while sx > 0 and dark[y, sx]:
            sx -= 1
        if not dark[y, sx]:
            out[y, x] = rgb[y, sx]
            continue
        sy = y
        while sy > 0 and dark[sy, x]:
            sy -= 1
        out[y, x] = rgb[sy, x]
    return out


def seamless_crop(a: np.ndarray, axis: int, min_fraction: float = 0.6) -> np.ndarray:
    """
    이음매 없이 반복되는 구간 [s, s+p) 를 고른다: 열(axis=1)·행(axis=0) s 와 s+p 가 가장 닮은 곳.
    그러면 반복할 때 s+p-1 다음에 오는 s 가 원래 그림의 s+p 와 같아 경계가 이어진다. p 는 길이의 min_fraction 이상
    """
    b = a[..., :3].astype(int)
    if axis == 0:
        b = b.transpose(1, 0, 2)
    length = b.shape[1]
    best = (float('inf'), 0, length)
    for period in range(int(length * min_fraction), length):
        diff = np.abs(b[:, :length - period] - b[:, period:]).mean(axis=(0, 2))
        start = int(diff.argmin())
        # 같으면 긴 구간 (반복이 덜 보인다)
        cost = float(diff[start]) - period * 1e-6
        if cost < best[0]:
            best = (cost, start, period)
    _, start, period = best
    return a[start:start + period] if axis == 0 else a[:, start:start + period]


def seamless_bands_x(a: np.ndarray, dark_ratio: float = 0.75) -> np.ndarray:
    """
    가로 판자처럼 줄(어두운 가로 이음선으로 나뉜 띠)마다 가로 반복 구간을 따로 고른다 — 한 구간을 통째로 고르면 줄마다 판자 색이 경계에서 끊긴다.
    띠마다 고른 폭이 달라 가장 긴 폭으로 늘려(최빈색 축소라 nearest 와 같다) 다시 쌓는다
    """
    brightness = a[..., :3].astype(int).sum(axis=2).mean(axis=1)
    is_line = brightness < np.median(brightness) * dark_ratio
    bands, start = [], 0
    for y in range(1, len(is_line)):
        # 이음선이 끝나는 곳에서 자른다 (이음선은 그 위 띠에 붙는다)
        if is_line[y - 1] and not is_line[y]:
            bands.append((start, y))
            start = y
    bands.append((start, len(is_line)))
    pieces = [seamless_crop(a[y0:y1], 1) for y0, y1 in bands if y1 - y0 > 0]
    width = max(piece.shape[1] for piece in pieces)
    return np.concatenate([downscale(piece, width, piece.shape[0]) for piece in pieces], axis=0)


def mode_color(pixels: np.ndarray) -> str:
    """불투명 픽셀의 최빈색 (24 단위로 묶어 센 뒤 그 묶음의 중앙값) '#rrggbb'"""
    solid = pixels.reshape(-1, pixels.shape[-1])
    if solid.shape[1] == 4:
        solid = solid[solid[:, 3] > 127]
    quant = (solid[:, :3] // 24).astype(int)
    keys = quant[:, 0] * 10000 + quant[:, 1] * 100 + quant[:, 2]
    values, counts = np.unique(keys, return_counts=True)
    color = np.median(solid[keys == values[counts.argmax()]][:, :3], axis=0).astype(int)
    return '#%02x%02x%02x' % tuple(color)


# ---------- 확인 ----------

def check_sprite(name: str, a: np.ndarray, is_opaque_tile: bool = False) -> list[str]:
    """
    알파 확인. 투명 처리 버그(전부 투명)·키가 안 빠짐(전부 불투명)·반투명 가장자리를 잡는다.
    돌려주는 것은 문제 문구 목록 (빈 목록 = 통과)
    """
    alpha = a[..., 3]
    problems = []
    filled = float((alpha > 0).mean())
    if filled == 0:
        problems.append(f'{name}: 전부 투명')
    if not is_opaque_tile and filled == 1:
        problems.append(f'{name}: 전부 불투명 (배경 키가 안 빠졌을 수 있음)')
    if is_opaque_tile and filled < 1:
        problems.append(f'{name}: 타일인데 투명 픽셀 있음')
    semi = int(((alpha > 0) & (alpha < 255)).sum())
    if semi:
        problems.append(f'{name}: 반투명 픽셀 {semi}개')
    return problems


def touches_edge(a: np.ndarray) -> list[str]:
    """셀 가장자리에 닿은 쪽 (잘렸을 수 있음)"""
    alpha = a[..., 3] > 0
    sides = {'위': alpha[0].any(), '아래': alpha[-1].any(), '왼쪽': alpha[:, 0].any(), '오른쪽': alpha[:, -1].any()}
    return [side for side, value in sides.items() if value]
