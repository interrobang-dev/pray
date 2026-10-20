import { deflateSync } from 'node:zlib'

/** 외부 이미지 파일 없이 트레이 아이콘을 만든다: 32x32 도트 모니터. alert 면 오른쪽 위에 빨간 점 */
const SIZE = 32
const GREEN = [0x3f, 0x9c, 0x4b, 255]
const DARK = [0x2b, 0x2f, 0x3a, 255]
const SCREEN = [0x4a, 0xa3, 0xe8, 255]
const LIGHT = [0xdf, 0xf0, 0xff, 255]
const RED = [0xe0, 0x5a, 0x5a, 255]
const WHITE = [0xff, 0xff, 0xff, 255]

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
  // 모니터: 초록 베젤, 파란 화면, 받침
  rect(3, 5, 26, 18, GREEN)
  rect(5, 7, 22, 14, SCREEN)
  rect(7, 9, 8, 4, LIGHT)
  rect(17, 11, 6, 2, LIGHT)
  rect(7, 15, 14, 2, LIGHT)
  rect(13, 23, 6, 3, DARK)
  rect(9, 26, 14, 2, DARK)
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
