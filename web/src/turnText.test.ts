import { describe, expect, it } from 'vitest'
import { firstPlainLine, latestTurnText } from './turnText'
import type { ChatMessage } from './types'

let nextId = 0
const message = (role: ChatMessage['role'], text: string, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${nextId++}`,
  role,
  timestamp: '2026-10-22T10:00:00.000Z',
  text,
  toolUses: [],
  ...patch,
})

describe('latestTurnText', () => {
  it('마지막 사람 쪽 메시지 뒤의 글이 있는 마지막 claude 메시지', () => {
    const messages = [message('user', '해 줘'), message('assistant', '먼저 볼게요'), message('assistant', '  고치는 중  '), message('assistant', '')]
    expect(latestTurnText(messages)).toBe('고치는 중')
  })

  it('이번 차례에 글이 없으면 null (앞 차례 글을 쓰지 않는다)', () => {
    expect(latestTurnText([message('user', '1'), message('assistant', '앞 차례 답'), message('user', '2'), message('assistant', '')])).toBeNull()
    expect(latestTurnText([message('assistant', '답'), message('user', '다음')])).toBeNull()
    expect(latestTurnText([])).toBeNull()
  })

  it('대기 중 메시지는 차례 시작으로 치지 않는다', () => {
    const messages = [message('user', '해 줘'), message('assistant', '하는 중'), message('user', '이것도', { isQueued: true })]
    expect(latestTurnText(messages)).toBe('하는 중')
  })

  it('system 메시지(백그라운드 알림 등)는 지나간다', () => {
    const messages = [message('user', '해 줘'), message('assistant', '기다리는 중'), message('system', '<task-notification>…</task-notification>')]
    expect(latestTurnText(messages)).toBe('기다리는 중')
  })
})

describe('firstPlainLine', () => {
  it('제목·목록·인용·할 일 기호를 뺀다', () => {
    expect(firstPlainLine('## 결과 정리')).toBe('결과 정리')
    expect(firstPlainLine('- 첫 항목')).toBe('첫 항목')
    expect(firstPlainLine('12. 열두째')).toBe('열두째')
    expect(firstPlainLine('> 인용 글')).toBe('인용 글')
    expect(firstPlainLine('- [x] 끝난 일')).toBe('끝난 일')
  })

  it('굵게·기울임·취소선·인라인 코드·링크·그림은 글자만', () => {
    expect(firstPlainLine('**굵게** 와 *기울임* 과 _밑줄_ 과 ~~취소~~')).toBe('굵게 와 기울임 과 밑줄 과 취소')
    expect(firstPlainLine('`npm test` 를 돌렸습니다')).toBe('npm test 를 돌렸습니다')
    expect(firstPlainLine('[문서](https://example.com) 와 ![그림](a.png)')).toBe('문서 와 그림')
  })

  it('snake_case 와 곱셈 기호는 그대로', () => {
    expect(firstPlainLine('my_var_name 을 바꿈')).toBe('my_var_name 을 바꿈')
    expect(firstPlainLine('2 * 3 = 6')).toBe('2 * 3 = 6')
  })

  it('빈 줄·코드 울타리·가로줄·표 구분 줄을 건너뛴 첫 줄', () => {
    expect(firstPlainLine('\n\n  \n```ts\nconst a = 1\n```')).toBe('const a = 1')
    expect(firstPlainLine('---\n\n두 번째')).toBe('두 번째')
    expect(firstPlainLine('|---|:--:|\n| a | b |')).toBe('| a | b |')
    expect(firstPlainLine('#\n- \n본문')).toBe('본문')
  })

  it('글자가 없으면 null', () => {
    expect(firstPlainLine('')).toBeNull()
    expect(firstPlainLine('```\n```')).toBeNull()
  })
})
