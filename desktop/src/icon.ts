import { deflateSync } from 'node:zlib'

/** 외부 이미지 파일 없이 트레이·창 아이콘을 만든다: 로고(도트 빌딩 마크) 16x16 격자를 2배로 찍은 32x32. alert 면 오른쪽 위에 빨간 점.
 *  격자는 web/public/favicon.svg 와 같은 그림이라 고치면 같이 고친다. 오른쪽 위는 빨간 점 자리라 비워 둔다 */
const SIZE = 32
const SCALE = SIZE / 16
const GREEN = [0x3f, 0x9c, 0x4b, 255]
const DARK_GREEN = [0x2a, 0x6e, 0x34, 255]
const LIGHT_GREEN = [0x5b, 0xb8, 0x66, 255]
const RED = [0xe0, 0x5a, 0x5a, 255]
const WHITE = [0xff, 0xff, 0xff, 255]

/** 16줄 x 16글자, '.' = 투명. 왼쪽 높은 동(안테나·지붕 띠·창 4층·출입문) + 오른쪽 낮은 별관 */
const MARK = [
  '.....A..........',
  '.....O..........',
  '.OOOOOOOOO......',
  '.OCCCCCCCO......',
  '.OWWWWWWWO......',
  '.OWLLWLLWO......',
  '.OWWWWWWWO......',
  '.OWLLWDDWOOOOOO.',
  '.OWWWWWWWOCCCCO.',
  '.OWDDWLLWOWLLWO.',
  '.OWWWWWWWOWWWWO.',
  '.OWLLWLLWOWDDWO.',
  '.OWWWWWWWOWWWWO.',
  '.OWWEEEWWOWLLWO.',
  '.OWWEEEWWOWWWWO.',
  '.OOOOOOOOOOOOOO.',
]
const MARK_COLORS: Record<string, number[]> = {
  O: DARK_GREEN, // 외곽선
  W: GREEN, // 벽
  C: LIGHT_GREEN, // 지붕 띠
  L: WHITE, // 켜진 창
  D: DARK_GREEN, // 꺼진 창
  E: DARK_GREEN, // 출입문
  A: DARK_GREEN, // 안테나 끝
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
  // 빌딩 마크: 격자 한 칸 = 2x2 픽셀
  for (let y = 0; y < MARK.length; y++) {
    for (let x = 0; x < MARK[y].length; x++) {
      const color = MARK_COLORS[MARK[y][x]]
      if (color) rect(x * SCALE, y * SCALE, SCALE, SCALE, color)
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
