import { describe, expect, it } from 'vitest'
import { codeBlockText, hastText, stripOneTrailingNewline, type HastNode } from './codeText'

const text = (value: string): HastNode => ({ type: 'text', value })
const element = (...children: HastNode[]): HastNode => ({ type: 'element', children })

describe('hastText', () => {
  it('강조 span 으로 쪼개진 글자를 순서대로 잇는다', () => {
    const pre = element(element(element(text('const')), text(' x = '), element(text('1')), text('\n')))
    expect(hastText(pre)).toBe('const x = 1\n')
  })

  it('노드가 없거나 비었으면 빈 글자', () => {
    expect(hastText(undefined)).toBe('')
    expect(hastText(element())).toBe('')
  })
})

describe('stripOneTrailingNewline', () => {
  it('끝 줄바꿈 하나만 뗀다', () => {
    expect(stripOneTrailingNewline('a\n')).toBe('a')
    expect(stripOneTrailingNewline('a\n\n')).toBe('a\n')
    expect(stripOneTrailingNewline('a\r\n')).toBe('a')
  })

  it('줄바꿈이 없으면 그대로', () => {
    expect(stripOneTrailingNewline('a')).toBe('a')
    expect(stripOneTrailingNewline('')).toBe('')
  })
})

describe('codeBlockText', () => {
  it('pre 노드의 코드에서 끝 줄바꿈 하나를 뗀다', () => {
    expect(codeBlockText(element(element(text('npm test\nnpm run build\n'))))).toBe('npm test\nnpm run build')
  })
})
