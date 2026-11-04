import { deflateSync } from 'node:zlib'

/** 외부 이미지 파일 없이 트레이·창·exe·알림 아이콘을 만든다: Pray 로고(U-2 마크). 16px 은 favicon.svg(16px 판)를 옮긴 격자를 1:1 로 찍고,
 *  그 밖의 크기는 logo.svg 의 path 사본(LOGO_PATHS)을 그 크기로 벡터로 그린다 (가장자리는 덮인 비율로 섞는다).
 *  그림을 고치면 logo.svg·favicon.svg 와 같이 고친다 */
const SIZE = 32
const INK_LINE = [0x45, 0x4c, 0x5b, 255]
const INK = [0x23, 0x26, 0x2e, 255]
// favicon.svg 16px 판의 바깥 모서리 (INK 를 45% 불투명으로)
const INK_FAINT = [0x23, 0x26, 0x2e, 115]
const GOLD = [0xf5, 0xb8, 0x41, 255]
const DOT = [0x3c, 0x42, 0x50, 255]
// 곡선 계단의 중간색 (그 색과 바탕 INK 의 가운데. favicon.svg 16px 판과 같은 값)
const GOLD_EDGE = [0x8c, 0x6f, 0x38, 255]
const WHITE_EDGE = [0x91, 0x93, 0x97, 255]
const DOT_EDGE = [0x30, 0x34, 0x3f, 255]
const RED = [0xe0, 0x5a, 0x5a, 255]
const WHITE = [0xff, 0xff, 0xff, 255]

/** 16줄 x 16글자. favicon.svg 를 그대로 옮긴 16px 판 (32 격자를 줄이면 2칸 틈·곡선이 뭉개져 손으로 맞춘 판을 쓴다) */
const MARK_16 = [
  '..aBBBBBBBBBBa..',
  '.aBFFFFFFFFFFBa.',
  'aBFFFGGGGGgFFFBa',
  'BFFFFGGGGGGgFFFB',
  'BFFFFGGGGGGGFFFB',
  'BFFFFFFFFFFFFFFB',
  'BFFFFWWWFWWWFFFB',
  'BFFFFWWWFWWWFFFB',
  'BFFFFWWWFWWwFFFB',
  'BFFFFFFFFFFFFFFB',
  'BFFFFWWWFcCcFFFB',
  'BFFFFWWWFCCCFFFB',
  'BFFFFWWWFcCcFFFB',
  'aBFFFFFFFFFFFFBa',
  '.aBFFFFFFFFFFBa.',
  '..aBBBBBBBBBBa..',
]
const MARK_COLORS: Record<string, number[]> = {
  B: INK_LINE, // 테두리
  a: INK_FAINT, // 16px 판 둥근 모서리의 반투명 가장자리
  F: INK, // 바탕
  G: GOLD, // 팀장 막대
  W: WHITE, // 책상
  C: DOT, // 작은 원
  g: GOLD_EDGE, // 팀장 막대 둥근 모서리
  w: WHITE_EDGE, // 책상 둥근 모서리
  c: DOT_EDGE, // 작은 원 모서리
}

/**
 * web/public/logo.svg 의 path 를 그대로 옮긴 것 (그리는 순서대로, 32 단위 좌표). desktop 은 web 파일을 읽지 않으므로 사본이고
 * icon.test.ts 가 logo.svg 와 같은지 본다 — 로고를 고치면 logo.svg 를 고치고 이것도 같이 고친다.
 * transform 은 logo.svg 의 translate(x, y) scale(s) 꼴만 (안쪽 바탕)
 */
export const LOGO_PATHS: readonly { d: string; fill: string; transform?: { translate: [number, number]; scale: number } }[] = [
  { d: 'M9,0H23C29.5,0 32,2.5 32,9V23C32,29.5 29.5,32 23,32H9C2.5,32 0,29.5 0,23V9C0,2.5 2.5,0 9,0Z', fill: '#454c5b' },
  {
    d: 'M9,0H23C29.5,0 32,2.5 32,9V23C32,29.5 29.5,32 23,32H9C2.5,32 0,29.5 0,23V9C0,2.5 2.5,0 9,0Z',
    fill: '#23262e',
    transform: { translate: [1, 1], scale: 0.9375 },
  },
  { d: 'M10.2,5H18A5,5 0 0 1 23,10V9.8A1.2,1.2 0 0 1 21.8,11H10.2A1.2,1.2 0 0 1 9,9.8V6.2A1.2,1.2 0 0 1 10.2,5Z', fill: '#f5b841' },
  { d: 'M18.2,13H21.8A1.2,1.2 0 0 1 23,14.2V14A5,5 0 0 1 18,19H18.2A1.2,1.2 0 0 1 17,17.8V14.2A1.2,1.2 0 0 1 18.2,13Z', fill: '#ffffff' },
  { d: 'M10.2,13H13.8A1.2,1.2 0 0 1 15,14.2V17.8A1.2,1.2 0 0 1 13.8,19H10.2A1.2,1.2 0 0 1 9,17.8V14.2A1.2,1.2 0 0 1 10.2,13Z', fill: '#ffffff' },
  { d: 'M10.2,21H13.8A1.2,1.2 0 0 1 15,22.2V25.8A1.2,1.2 0 0 1 13.8,27H10.2A1.2,1.2 0 0 1 9,25.8V22.2A1.2,1.2 0 0 1 10.2,21Z', fill: '#ffffff' },
  { d: 'M17.75,24A2.25,2.25 0 1 0 22.25,24A2.25,2.25 0 1 0 17.75,24Z', fill: '#3c4250' },
]
/** logo.svg 의 viewBox 한 변 */
const LOGO_UNITS = 32

type Point = [number, number]

/** 곡선·호를 이 길이(32 단위)보다 짧은 직선으로 나눈다 — 256px 에서 0.1px 남짓이라 꺾임이 안 보인다 */
const FLATTEN_STEP = 0.125

/** 절대 좌표 path(M·H·V·L·C·A·Z 만 — logo.svg 가 쓰는 것) → 닫힌 다각형들 */
export function flattenPath(d: string): Point[][] {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? []
  const polygons: Point[][] = []
  let current: Point[] = []
  let point: Point = [0, 0]
  let start: Point = [0, 0]
  let index = 0
  let command = ''
  const number = () => Number(tokens[index++])
  const lineTo = (next: Point) => {
    current.push(next)
    point = next
  }
  while (index < tokens.length) {
    if (/[A-Za-z]/.test(tokens[index])) command = tokens[index++]
    switch (command) {
      case 'M':
        if (current.length > 1) polygons.push(current)
        point = [number(), number()]
        start = point
        current = [point]
        command = 'L' // M 뒤에 이어지는 좌표는 L
        break
      case 'L':
        lineTo([number(), number()])
        break
      case 'H':
        lineTo([number(), point[1]])
        break
      case 'V':
        lineTo([point[0], number()])
        break
      case 'C': {
        const [x0, y0] = point
        const [x1, y1, x2, y2, x3, y3] = [number(), number(), number(), number(), number(), number()]
        const length = Math.hypot(x1 - x0, y1 - y0) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2)
        const steps = Math.max(2, Math.ceil(length / FLATTEN_STEP))
        for (let step = 1; step <= steps; step++) {
          const t = step / steps
          const u = 1 - t
          lineTo([
            u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          ])
        }
        break
      }
      case 'A': {
        const [rx, ry, rotation, isLarge, isSweep, x, y] = [number(), number(), number(), number(), number(), number(), number()]
        for (const next of arcPoints(point, rx, ry, rotation, isLarge === 1, isSweep === 1, [x, y])) lineTo(next)
        break
      }
      case 'Z':
      case 'z':
        if (current.length > 1) polygons.push(current)
        current = []
        point = start
        command = ''
        break
      default:
        throw new Error(`지원하지 않는 path 명령: ${command}`)
    }
  }
  if (current.length > 1) polygons.push(current)
  return polygons
}

/** SVG 끝점 호 → 점들 (끝점 포함, 시작점 제외). SVG 명세 F.6.5 의 중심 매개변수 변환 */
function arcPoints(from: Point, rxIn: number, ryIn: number, rotationDeg: number, isLarge: boolean, isSweep: boolean, to: Point): Point[] {
  let rx = Math.abs(rxIn)
  let ry = Math.abs(ryIn)
  if (rx === 0 || ry === 0) return [to]
  const phi = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from[0] - to[0]) / 2
  const dy = (from[1] - to[1]) / 2
  const x1p = cos * dx + sin * dy
  const y1p = -sin * dx + cos * dy
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    rx *= Math.sqrt(lambda)
    ry *= Math.sqrt(lambda)
  }
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const factor = (isLarge === isSweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / denominator))
  const cxp = (factor * rx * y1p) / ry
  const cyp = (-factor * ry * x1p) / rx
  const cx = cos * cxp - sin * cyp + (from[0] + to[0]) / 2
  const cy = sin * cxp + cos * cyp + (from[1] + to[1]) / 2
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const theta = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
  if (!isSweep && delta > 0) delta -= 2 * Math.PI
  if (isSweep && delta < 0) delta += 2 * Math.PI
  const steps = Math.max(2, Math.ceil((Math.abs(delta) * Math.max(rx, ry)) / FLATTEN_STEP))
  const points: Point[] = []
  for (let step = 1; step <= steps; step++) {
    if (step === steps) {
      points.push(to)
      break
    }
    const t = theta + (delta * step) / steps
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    points.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy])
  }
  return points
}

/** 한 픽셀을 나누는 가로줄 수 (줄마다 가로 덮인 길이는 정확히 잰다) */
const COVERAGE_ROWS = 16

/**
 * 다각형들(픽셀 좌표)이 덮는 비율 0~1 (size×size). 짝홀 규칙. 픽셀마다 가로줄 COVERAGE_ROWS 개에서 다각형 안쪽 구간을 구해
 * 그 구간이 각 픽셀에 걸친 길이를 더한다 — 가장자리가 부드럽게 섞인다
 */
function coverageOf(polygons: Point[][], size: number): Float32Array {
  const coverage = new Float32Array(size * size)
  const edges: [number, number, number, number][] = []
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const [x0, y0] = polygon[i]
      const [x1, y1] = polygon[(i + 1) % polygon.length]
      if (y0 !== y1) edges.push([x0, y0, x1, y1])
    }
  }
  const crossings: number[] = []
  for (let row = 0; row < size * COVERAGE_ROWS; row++) {
    const y = (row + 0.5) / COVERAGE_ROWS
    crossings.length = 0
    for (const [x0, y0, x1, y1] of edges) {
      if ((y0 <= y && y < y1) || (y1 <= y && y < y0)) crossings.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0))
    }
    crossings.sort((a, b) => a - b)
    const pixelRow = Math.floor(row / COVERAGE_ROWS) * size
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const left = Math.max(0, crossings[i])
      const right = Math.min(size, crossings[i + 1])
      for (let x = Math.floor(left); x < right && x < size; x++) {
        const covered = Math.min(right, x + 1) - Math.max(left, x)
        if (covered > 0) coverage[pixelRow + x] += covered / COVERAGE_ROWS
      }
    }
  }
  return coverage
}

function parseHexColor(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
}

/** 32 단위 좌표의 다각형들을 size 픽셀(offset 만큼 옮겨) 그림에 color 로 칠한다 (덮인 비율만큼 불투명) */
function fillPolygons(pixels: Uint8Array, size: number, polygons: Point[][], color: readonly number[], place: (point: Point) => Point): void {
  const placed = polygons.map((polygon) => polygon.map(place))
  const coverage = coverageOf(placed, size)
  for (let i = 0; i < coverage.length; i++) {
    const alpha = Math.min(1, coverage[i])
    if (alpha <= 0) continue
    blendOver(pixels, i * 4, [color[0], color[1], color[2], Math.round(color[3] * alpha)])
  }
}

/** logo.svg 의 다각형 (한 번만 나눈다) */
let logoPolygons: { polygons: Point[][]; color: number[] }[] | null = null

function logoLayers(): { polygons: Point[][]; color: number[] }[] {
  logoPolygons ??= LOGO_PATHS.map(({ d, fill, transform }) => {
    const polygons = flattenPath(d)
    const moved = transform
      ? polygons.map((polygon) =>
          polygon.map(([x, y]): Point => [x * transform.scale + transform.translate[0], y * transform.scale + transform.translate[1]]),
        )
      : polygons
    return { polygons: moved, color: [...parseHexColor(fill), 255] }
  })
  return logoPolygons
}

/** 로고 마크를 drawSize 픽셀로 canvas(한 변 canvasSize) 의 offset 자리에 벡터로 그린다 */
function drawLogo(pixels: Uint8Array, canvasSize: number, drawSize: number, offset: Point = [0, 0]): void {
  const snapX = pixelSnap(LOGO_EDGES_X, drawSize)
  const snapY = pixelSnap(LOGO_EDGES_Y, drawSize)
  const place = ([x, y]: Point): Point => [snapX(x) + offset[0], snapY(y) + offset[1]]
  for (const { polygons, color } of logoLayers()) fillPolygons(pixels, canvasSize, polygons, color, place)
}

/**
 * logo.svg 의 곧은 가장자리 자리 (32 단위): 바깥 테두리 0·32, 안쪽 바탕 1·31, 막대·책상 9·15·17·23 / 5·11·13·19·21·27.
 * 작은 크기에서 이 자리가 픽셀 사이에 떨어지면 막대·책상 가장자리가 회색으로 번져 흐려 보이므로 가장 가까운 픽셀 경계로 옮긴다
 */
const LOGO_EDGES_X = [0, 1, 9, 15, 17, 23, 31, 32]
const LOGO_EDGES_Y = [0, 1, 5, 11, 13, 19, 21, 27, 31, 32]

/**
 * 32 단위 좌표 → 픽셀 좌표. 곧은 가장자리 자리(edges)는 반올림한 픽셀 경계로, 그 사이(곡선·작은 원)는 양쪽 경계 사이를 고르게 늘려 놓는다 —
 * 곧은 가장자리는 또렷하고 곡선만 덮인 비율로 섞인다. 큰 크기에서는 옮기는 양이 1px 안이라 모양이 그대로다
 */
function pixelSnap(edges: readonly number[], drawSize: number): (value: number) => number {
  const scale = drawSize / LOGO_UNITS
  const targets = edges.map((edge) => Math.round(edge * scale))
  return (value) => {
    let index = edges.findIndex((edge, i) => i + 1 < edges.length && value <= edges[i + 1])
    if (index < 0) index = edges.length - 2
    const [from, to] = [edges[index], edges[index + 1]]
    const t = (value - from) / (to - from)
    return targets[index] + t * (targets[index + 1] - targets[index])
  }
}

/** 로고 마크 한 장 (size 픽셀, 투명 바탕). 16 은 손으로 맞춘 16 격자, 그 밖은 logo.svg 를 그 크기로 벡터로 그린다 */
function logoPixels(size: number): Uint8Array {
  if (size === MARK_16.length) return drawGrid(MARK_16)
  const pixels = new Uint8Array(size * size * 4)
  drawLogo(pixels, size, size)
  return pixels
}

/** 창 아이콘·exe 아이콘(.ico)에 넣는 크기. 화면 배율 125·150·200% 의 크기(20·40·72·96 등)도 넣어 Windows 가 늘이거나 줄이지 않게 한다 */
export const APP_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 72, 96, 128, 256] as const
/** 트레이 아이콘(.ico)에 넣는 크기: 트레이는 배율 100% 에서 16, 125% 20, 150% 24, 200% 32 로 그린다 */
export const TRAY_ICON_SIZES = [16, 20, 24, 32, 40, 48] as const

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}

/** 정사각 RGBA 픽셀 → PNG */
function encodePng(pixels: Uint8Array, size: number): Buffer {
  // 각 행 앞에 필터 바이트 0
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/** 격자 한 칸을 한 픽셀로 */
function drawGrid(grid: string[]): Uint8Array {
  const size = grid.length
  const pixels = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = MARK_COLORS[grid[y][x]]
      if (color) pixels.set(color, (y * size + x) * 4)
    }
  }
  return pixels
}

/** 승인 대기 빨간 점 (32 단위: 흰 10×10 을 x 21·y 1 에, 그 안에 빨강 8×8 — 확정한 자리). 크기마다 정수 픽셀에 맞춰 네모가 또렷하다 */
function drawAlert(pixels: Uint8Array, size: number): void {
  const scale = size / LOGO_UNITS
  const rect = (x: number, y: number, w: number, h: number, color: readonly number[]) => {
    const [x0, y0, x1, y1] = [x, y, x + w, y + h].map((value) => Math.round(value * scale))
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) pixels.set(color, (yy * size + xx) * 4)
  }
  rect(21, 1, 10, 10, WHITE)
  rect(22, 2, 8, 8, RED)
}

/** 트레이 아이콘 한 크기 (alert 면 오른쪽 위에 빨간 점) */
export function trayIconPng(isAlert: boolean, size: number = SIZE): Buffer {
  const pixels = logoPixels(size)
  if (isAlert) drawAlert(pixels, size)
  return encodePng(pixels, size)
}

/** 트레이 아이콘 .ico (TRAY_ICON_SIZES 전부). 경로로 주면 Electron 이 화면 배율에 맞는 크기를 고른다 */
export function trayIconIco(isAlert: boolean): Buffer {
  return icoFromPngs(TRAY_ICON_SIZES.map((size) => trayIconPng(isAlert, size)))
}

/** 창·exe 아이콘 한 크기. 16 은 손으로 맞춘 16 격자, 나머지는 logo.svg 를 그 크기로 벡터로 그린다 */
export function appIconPng(size: number): Buffer {
  return encodePng(logoPixels(size), size)
}

/** 알림 왼쪽 그림의 상태 색 테두리. 웹 style.css 다크 값 (--success·--yellow·--red·--blue-dot). desktop 은 CSS 를 못 읽어 따로 둔다 */
export const NOTICE_RING_COLORS = {
  done: [0x3f, 0x9c, 0x4b, 255],
  'my-turn': [0xe3, 0xb3, 0x41, 255],
  'needs-approval': [0xef, 0x7b, 0x72, 255],
  'hand-over': [0x4c, 0x93, 0xe6, 255],
} as const satisfies Record<string, readonly number[]>
export type NoticeRingKind = keyof typeof NOTICE_RING_COLORS

/** 알림 그림 크기: 토스트 appLogoOverride 는 48 epx 라 배율 200% 화면에서 96px 로 그린다 (작은 배율은 Windows 가 줄인다) */
export const NOTICE_ICON_SIZE = 96
const NOTICE_RING_OUTER = NOTICE_ICON_SIZE / 2
const NOTICE_RING_INNER = NOTICE_RING_OUTER - 6
const NOTICE_SAMPLES = 4
/** 알림 그림 가운데 로고 마크 한 변 (얼굴이 없을 때) */
const NOTICE_MARK_SIZE = 64

/** src 를 dst 위에 덮는다 (straight alpha 의 source-over) */
function blendOver(dst: Uint8Array, offset: number, src: readonly number[]): void {
  const srcAlpha = src[3] / 255
  if (srcAlpha === 0) return
  const dstAlpha = dst[offset + 3] / 255
  const outAlpha = srcAlpha + dstAlpha * (1 - srcAlpha)
  for (let i = 0; i < 3; i++) {
    dst[offset + i] = Math.round((src[i] * srcAlpha + dst[offset + i] * dstAlpha * (1 - srcAlpha)) / outAlpha)
  }
  dst[offset + 3] = Math.round(outAlpha * 255)
}

/** 알림 그림에 넣는 인물 머리: 정사각 RGBA (noticeFace.ts 의 facePixels, 보통 44px — 넓은 머리는 더 크다) */
export interface NoticeFace {
  pixels: Uint8Array
  size: number
}

/** 머리 그림을 늘려 그리는 한 변 (44px 면 2배, 더 큰 머리는 그만큼 덜 늘린다. 최근접 이웃) */
const NOTICE_FACE_DRAW_SIZE = 88

/** face 를 NOTICE_FACE_DRAW_SIZE 로 늘려 가운데에 놓았을 때 (px, py) 점의 색을 먹색 바탕 위에 덮은 것 */
function faceColorAt(face: NoticeFace, px: number, py: number): readonly number[] {
  const scale = NOTICE_FACE_DRAW_SIZE / face.size
  const start = (NOTICE_ICON_SIZE - NOTICE_FACE_DRAW_SIZE) / 2
  const fx = Math.floor((px - start) / scale)
  const fy = Math.floor((py - start) / scale)
  if (fx < 0 || fy < 0 || fx >= face.size || fy >= face.size) return INK
  const offset = (fy * face.size + fx) * 4
  const color = new Uint8Array(INK)
  blendOver(color, 0, [...face.pixels.subarray(offset, offset + 4)])
  return [...color]
}

/**
 * 알림 그림: 먹색 원판 + 상태 색 고리(6px). 토스트가 hint-crop="circle" 로 원으로 자르므로 원 바깥은 투명이고, 원 가장자리는 4x4 표본으로 부드럽게 한다.
 * face 가 없으면 32 격자 마크를 2배(64px)로 가운데에 찍는다 (최근접 이웃 그대로).
 * face(세션 도트 인물 머리)가 있으면 88px 로 늘려(44px 머리는 2배) 가운데에 놓고 고리 안쪽 원으로 자른다 — 원판 안쪽 표본마다 머리 픽셀을 먹색 위에 덮는다
 */
export function noticeIconPng(kind: NoticeRingKind, face: NoticeFace | null = null): Buffer {
  const size = NOTICE_ICON_SIZE
  const ring = NOTICE_RING_COLORS[kind]
  const pixels = new Uint8Array(size * size * 4)
  const center = size / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sum = [0, 0, 0, 0]
      for (let sy = 0; sy < NOTICE_SAMPLES; sy++) {
        for (let sx = 0; sx < NOTICE_SAMPLES; sx++) {
          const px = x + (sx + 0.5) / NOTICE_SAMPLES
          const py = y + (sy + 0.5) / NOTICE_SAMPLES
          const distance = Math.hypot(px - center, py - center)
          const inner = face ? faceColorAt(face, px, py) : INK
          const color = distance <= NOTICE_RING_INNER ? inner : distance <= NOTICE_RING_OUTER ? ring : null
          if (!color) continue
          for (let i = 0; i < 3; i++) sum[i] += color[i]
          sum[3] += 1
        }
      }
      if (sum[3] === 0) continue
      const offset = (y * size + x) * 4
      for (let i = 0; i < 3; i++) pixels[offset + i] = Math.round(sum[i] / sum[3])
      pixels[offset + 3] = Math.round((sum[3] / (NOTICE_SAMPLES * NOTICE_SAMPLES)) * 255)
    }
  }
  if (face) return encodePng(pixels, size)
  const markSize = NOTICE_MARK_SIZE
  const start = (size - markSize) / 2
  drawLogo(pixels, size, markSize, [start, start])
  return encodePng(pixels, size)
}

/** PNG 들을 그대로 담은 .ico (Vista 부터 ICO 항목에 PNG 를 넣을 수 있다). 크기는 각 PNG 의 IHDR 에서 읽는다 */
export function icoFromPngs(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(pngs.length, 4)
  const entries: Buffer[] = []
  let offset = header.length + pngs.length * 16
  for (const png of pngs) {
    const width = png.readUInt32BE(16)
    const height = png.readUInt32BE(20)
    const entry = Buffer.alloc(16)
    entry[0] = width >= 256 ? 0 : width // 0 = 256
    entry[1] = height >= 256 ? 0 : height
    entry[2] = 0 // 팔레트 색 수 (없음)
    entry[3] = 0 // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...pngs])
}

/** 창·exe 아이콘 .ico (APP_ICON_SIZES 전부) */
export function appIconIco(): Buffer {
  return icoFromPngs(APP_ICON_SIZES.map((size) => appIconPng(size)))
}
