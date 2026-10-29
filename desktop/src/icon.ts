import { deflateSync } from 'node:zlib'

/** 외부 이미지 파일 없이 트레이·창 아이콘을 만든다: Pray 로고(U-2 마크) 32x32 격자를 1:1 로 찍는다. alert 면 오른쪽 위에 빨간 점.
 *  격자는 web/public/logo.svg(32 격자 벡터판)를 픽셀 계단으로 옮긴 것이라(곡선은 계단 + 중간색 한 칸, 바깥 모서리는 반투명) 그림을 고치면 logo.svg·favicon.svg(16px 판)와 같이 고친다 */
const SIZE = 32
const INK_LINE = [0x45, 0x4c, 0x5b, 255]
const INK_LINE_SOFT = [0x45, 0x4c, 0x5b, 128]
const INK = [0x23, 0x26, 0x2e, 255]
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
const MARK_COLORS: Record<string, number[]> = {
  B: INK_LINE, // 테두리
  b: INK_LINE_SOFT, // 둥근 모서리의 반투명 가장자리
  F: INK, // 바탕
  G: GOLD, // 팀장 막대
  W: WHITE, // 책상
  C: DOT, // 작은 원
  g: GOLD_EDGE, // 팀장 막대 둥근 모서리
  w: WHITE_EDGE, // 책상 둥근 모서리
  c: DOT_EDGE, // 작은 원 모서리
}

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

export function trayIconPng(isAlert: boolean): Buffer {
  const pixels = new Uint8Array(SIZE * SIZE * 4)
  const put = (x: number, y: number, color: number[]) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    pixels.set(color, (y * SIZE + x) * 4)
  }
  const rect = (x: number, y: number, w: number, h: number, color: number[]) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(xx, yy, color)
  }
  for (let y = 0; y < MARK.length; y++) {
    for (let x = 0; x < MARK[y].length; x++) {
      const color = MARK_COLORS[MARK[y][x]]
      if (color) put(x, y, color)
    }
  }
  if (isAlert) {
    rect(21, 1, 10, 10, WHITE)
    rect(22, 2, 8, 8, RED)
  }

  // PNG: 각 행 앞에 필터 바이트 0
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0
    raw.set(pixels.subarray(y * SIZE * 4, (y + 1) * SIZE * 4), y * (SIZE * 4 + 1) + 1)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
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
