import { describe, expect, it } from 'vitest'
import { composerRows, withAttachmentPaths } from './composerText'

describe('composerRows', () => {
  it('줄바꿈 수만큼, 빈 글은 한 줄', () => {
    expect(composerRows('')).toBe(1)
    expect(composerRows('한 줄')).toBe(1)
    expect(composerRows('a\nb\nc')).toBe(3)
  })

  it('8줄까지만 자란다', () => {
    expect(composerRows('\n'.repeat(7))).toBe(8)
    expect(composerRows('\n'.repeat(20))).toBe(8)
  })
})

describe('withAttachmentPaths', () => {
  it('첨부가 없으면 글 그대로', () => {
    expect(withAttachmentPaths('지시', [])).toBe('지시')
    expect(withAttachmentPaths('', [])).toBe('')
  })

  it('글 + 빈 줄 + 첨부 파일 목록 (경로는 백틱)', () => {
    expect(withAttachmentPaths('봐 줘', ['C:\\a\\1.png', 'C:\\a\\2.txt'])).toBe('봐 줘\n\n첨부 파일:\n`C:\\a\\1.png`\n`C:\\a\\2.txt`')
  })

  it('글 없이 첨부만이면 목록만', () => {
    expect(withAttachmentPaths('', ['C:\\a\\1.png'])).toBe('첨부 파일:\n`C:\\a\\1.png`')
  })
})
