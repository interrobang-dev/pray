import { describe, expect, it } from 'vitest'
import { btwBlockReason, composerRows, isBtwShortcut, isSuggestionVisible, MAX_BTW_ROWS, parseBtwCommand, withAttachmentPaths } from './composerText'

describe('btwBlockReason', () => {
  const free = { isAsking: false, isApprovalNeeded: false, isPending: false }

  it('막는 것이 없으면 null', () => {
    expect(btwBlockReason(free)).toBeNull()
  })

  it('질문 중·승인 대기는 서버 409 문구와 같다', () => {
    expect(btwBlockReason({ ...free, isAsking: true })).toBe("Can't ask while claude needs approval or is asking a question")
    expect(btwBlockReason({ ...free, isApprovalNeeded: true })).toBe("Can't ask while claude needs approval or is asking a question")
  })

  it('답하는 중이면 기다리라고 한다', () => {
    expect(btwBlockReason({ ...free, isPending: true })).toBe('Wait for the answer before asking again')
  })
})

describe('isBtwShortcut', () => {
  const key = { code: 'KeyB', key: 'B', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }

  it('Ctrl+Shift+B 와 Meta+Shift+B', () => {
    expect(isBtwShortcut(key)).toBe(true)
    expect(isBtwShortcut({ ...key, ctrlKey: false, metaKey: true })).toBe(true)
  })

  it('한글 자판(key 가 ㅠ)도 code 로 알아본다', () => {
    expect(isBtwShortcut({ ...key, key: 'ㅠ' })).toBe(true)
  })

  it('Shift·Ctrl 이 없거나 Alt 가 있거나 다른 키면 아니다', () => {
    expect(isBtwShortcut({ ...key, shiftKey: false })).toBe(false)
    expect(isBtwShortcut({ ...key, ctrlKey: false })).toBe(false)
    expect(isBtwShortcut({ ...key, altKey: true })).toBe(false)
    expect(isBtwShortcut({ ...key, code: 'KeyF', key: 'F' })).toBe(false)
  })
})

describe('composerRows', () => {
  it('최대 줄 수를 줄 수 있다 (곁가지 질문 카드)', () => {
    expect(composerRows('\n'.repeat(10), MAX_BTW_ROWS)).toBe(MAX_BTW_ROWS)
    expect(composerRows('a\nb', MAX_BTW_ROWS)).toBe(2)
  })

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

describe('parseBtwCommand', () => {
  it('/btw 질문은 질문, /btw 만이면 질문 없음', () => {
    expect(parseBtwCommand('/btw 지금 뭐 해?')).toEqual({ question: '지금 뭐 해?' })
    expect(parseBtwCommand('  /BTW  여러 줄\n질문  ')).toEqual({ question: '여러 줄\n질문' })
    expect(parseBtwCommand('/btw\n줄 다음 질문')).toEqual({ question: '줄 다음 질문' })
    expect(parseBtwCommand('/btw')).toEqual({ question: null })
    expect(parseBtwCommand('/btw   ')).toEqual({ question: null })
  })

  it('다른 글·다른 명령은 아니다', () => {
    for (const text of ['/btwx 질문', 'btw 질문', '질문 /btw', '/help', '/pray-btw abc', '']) expect(parseBtwCommand(text)).toBeNull()
  })
})

describe('isSuggestionVisible', () => {
  const shown = { suggestion: '테스트 돌려줘', isWritable: true, isWorking: false, isApprovalNeeded: false, isAsking: false, isDraftEmpty: true, hasUnconfirmedPending: false }

  it('조건이 모두 맞으면 보인다', () => {
    expect(isSuggestionVisible(shown)).toBe(true)
  })

  it('제안이 없거나 비면 안 보인다', () => {
    expect(isSuggestionVisible({ ...shown, suggestion: null })).toBe(false)
    expect(isSuggestionVisible({ ...shown, suggestion: undefined })).toBe(false)
    expect(isSuggestionVisible({ ...shown, suggestion: '' })).toBe(false)
  })

  it('하나라도 어긋나면 안 보인다', () => {
    for (const override of [{ isWritable: false }, { isWorking: true }, { isApprovalNeeded: true }, { isAsking: true }, { isDraftEmpty: false }, { hasUnconfirmedPending: true }]) {
      expect(isSuggestionVisible({ ...shown, ...override })).toBe(false)
    }
  })
})
