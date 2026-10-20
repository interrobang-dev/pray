/** 최근 출력만 남기는 문자열 버퍼. 상한을 넘으면 앞부분을 버린다. */
export class RingBuffer {
  private chunks: string[] = []
  private size = 0

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    if (chunk.length === 0) return
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.size > this.limit && this.chunks.length > 1) {
      this.size -= this.chunks.shift()!.length
    }
    if (this.size > this.limit) {
      const only = this.chunks[0]
      this.chunks = [only.slice(only.length - this.limit)]
      this.size = this.limit
    }
  }

  toString(): string {
    return this.chunks.join('')
  }
}
