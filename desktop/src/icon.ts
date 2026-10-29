import { deflateSync } from 'node:zlib'

/** 외부 이미지 파일 없이 트레이·창·exe 아이콘을 만든다: Pray 로고(U-2 마크) 격자를 찍는다. 트레이는 32x32 한 장, alert 면 오른쪽 위에 빨간 점.
 *  32 격자는 web/public/logo.svg(32 격자 벡터판)를, 16 격자는 favicon.svg(16px 판)를 픽셀 계단으로 옮긴 것이라(곡선은 계단 + 중간색 한 칸,
 *  바깥 모서리는 반투명) 그림을 고치면 logo.svg·favicon.svg 와 같이 고친다 */
const SIZE = 32
const INK_LINE = [0x45, 0x4c, 0x5b, 255]
const INK_LINE_SOFT = [0x45, 0x4c, 0x5b, 128]
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

/** 32줄 x 32글자, '.' = 투명. 먹색 squircle(옅은 테두리) 안에 금색 팀장 막대 · 흰 책상 둘 · 흰 책상 + 어두운 작은 원 = 책상 섬이 선 P */
const MARK = [
  '....bbBBBBBBBBBBBBBBBBBBBBbb....',
  '..bBBBFFFFFFFFFFFFFFFFFFFFBBBb..',
  '.bBBFFFFFFFFFFFFFFFFFFFFFFFFBBb.',
  '.BBFFFFFFFFFFFFFFFFFFFFFFFFFFBB.',
  'bBFFFFFFFFFFFFFFFFFFFFFFFFFFFFBb',
  'bBFFFFFFFGGGGGGGGGGGgFFFFFFFFFBb',
  'BFFFFFFFFGGGGGGGGGGGGgFFFFFFFFFB',
  'BFFFFFFFFGGGGGGGGGGGGGgFFFFFFFFB',
  'BFFFFFFFFGGGGGGGGGGGGGGFFFFFFFFB',
  'BFFFFFFFFGGGGGGGGGGGGGGFFFFFFFFB',
  'BFFFFFFFFGGGGGGGGGGGGGGFFFFFFFFB',
  'BFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFB',
  'BFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFWWWWWWFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFWWWWWWFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFWWWWWWFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFWWWWWwFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFWWWWwFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFWWWwFFFFFFFFFFB',
  'BFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFB',
  'BFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFFFFFFFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFFcCCcFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFFCCCCFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFFCCCCFFFFFFFFFB',
  'BFFFFFFFFWWWWWWFFFcCCcFFFFFFFFFB',
  'bBFFFFFFFWWWWWWFFFFFFFFFFFFFFFBb',
  'bBFFFFFFFFFFFFFFFFFFFFFFFFFFFFBb',
  '.BBFFFFFFFFFFFFFFFFFFFFFFFFFFBB.',
  '.bBBFFFFFFFFFFFFFFFFFFFFFFFFBBb.',
  '..bBBBFFFFFFFFFFFFFFFFFFFFBBBb..',
  '....bbBBBBBBBBBBBBBBBBBBBBbb....',
]
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
  b: INK_LINE_SOFT, // 둥근 모서리의 반투명 가장자리
  a: INK_FAINT, // 16px 판 둥근 모서리의 반투명 가장자리
  F: INK, // 바탕
  G: GOLD, // 팀장 막대
  W: WHITE, // 책상
  C: DOT, // 작은 원
  g: GOLD_EDGE, // 팀장 막대 둥근 모서리
  w: WHITE_EDGE, // 책상 둥근 모서리
  c: DOT_EDGE, // 작은 원 모서리
}

/** 창 아이콘·exe 아이콘(.ico)에 넣는 크기 */
export const APP_ICON_SIZES = [16, 24, 32, 48, 64, 256] as const

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

/** 최근접 이웃으로 크기 바꾸기: 새 픽셀 가운데가 놓이는 원래 픽셀을 그대로 쓴다 (새 색이 생기지 않아 또렷하다). 정수배면 칸을 n×n 으로 늘린 것과 같다 */
function scaleNearest(pixels: Uint8Array, from: number, to: number): Uint8Array {
  const scaled = new Uint8Array(to * to * 4)
  const source = (index: number) => Math.min(from - 1, Math.floor(((index + 0.5) * from) / to))
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const offset = (source(y) * from + source(x)) * 4
      scaled.set(pixels.subarray(offset, offset + 4), (y * to + x) * 4)
    }
  }
  return scaled
}

export function trayIconPng(isAlert: boolean): Buffer {
  const pixels = drawGrid(MARK)
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) pixels.set(color, (yy * SIZE + xx) * 4)
  }
  if (isAlert) {
    rect(21, 1, 10, 10, WHITE)
    rect(22, 2, 8, 8, RED)
  }
  return encodePng(pixels, SIZE)
}

/** 창·exe 아이콘 한 크기. 16 은 16 격자, 나머지는 32 격자를 최근접 이웃으로 (32·64·256 은 정수배, 24·48 은 0.75·1.5배) */
export function appIconPng(size: number): Buffer {
  const grid = size === 16 ? MARK_16 : MARK
  return encodePng(scaleNearest(drawGrid(grid), grid.length, size), size)
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
