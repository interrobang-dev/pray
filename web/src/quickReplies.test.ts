import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUICK_REPLIES,
  endsWithClaudeText,
  fillTextOf,
  isFillReply,
  isQuickRepliesVisible,
  normalizeQuickReplies,
  parseQuickReplies,
  quickReplyLabel,
  serializeQuickReplies,
} from './quickReplies'
import type { ChatMessage } from './types'

function message(partial: Partial<ChatMessage>): ChatMessage {
  return { id: 'm', role: 'assistant', timestamp: '2026-11-13T00:00:00Z', text: '', toolUses: [], ...partial }
}

const VISIBLE = {
  isWritable: true,
  isMember: false,
  isMyTurn: true,
  endsWithClaudeText: true,
  isWorking: false,
  isApprovalNeeded: false,
  isAsking: false,
  isHandingOver: false,
  hasUnconfirmedPending: false,
}

describe('normalizeQuickReplies', () => {
  it('trim·빈 것·중복을 빼고 6개까지', () => {
    expect(normalizeQuickReplies([' 진행 ', '', '  ', '진행', '보류', 'a', 'b', 'c', 'd', 'e'])).toEqual(['진행', '보류', 'a', 'b', 'c', 'd'])
  })
  it('40자에서 자르고 문자열이 아닌 것은 뺀다', () => {
    expect(normalizeQuickReplies(['x'.repeat(45), 3, null])).toEqual(['x'.repeat(40)])
  })
})

describe('parseQuickReplies', () => {
  it('없거나 못 읽으면 기본 칩', () => {
    expect(parseQuickReplies(null)).toEqual(DEFAULT_QUICK_REPLIES)
    expect(parseQuickReplies('{')).toEqual(DEFAULT_QUICK_REPLIES)
    expect(parseQuickReplies('null')).toEqual(DEFAULT_QUICK_REPLIES)
    expect(parseQuickReplies('{"format":2,"replies":["a"]}')).toEqual(DEFAULT_QUICK_REPLIES)
    expect(parseQuickReplies('{"format":1,"replies":"a"}')).toEqual(DEFAULT_QUICK_REPLIES)
  })
  it('저장한 목록을 정리해 읽고, 빈 배열은 꺼짐 그대로', () => {
    expect(parseQuickReplies('{"format":1,"replies":[" 좋아 ","좋아","수정:"]}')).toEqual(['좋아', '수정:'])
    expect(parseQuickReplies('{"format":1,"replies":[]}')).toEqual([])
  })
  it('저장 글과 오간다', () => {
    expect(serializeQuickReplies([' 진행', '진행', ''])).toBe('{"format":1,"replies":["진행"]}')
    expect(parseQuickReplies(serializeQuickReplies(['진행', '수정:']))).toEqual(['진행', '수정:'])
  })
})

describe('채우기 칩', () => {
  it(': 로 끝나면 채우기, 라벨은 …', () => {
    expect(isFillReply('수정:')).toBe(true)
    expect(isFillReply('진행')).toBe(false)
    expect(fillTextOf('수정:')).toBe('수정: ')
    expect(quickReplyLabel('수정:')).toBe('수정…')
    expect(quickReplyLabel('진행')).toBe('진행')
    expect(quickReplyLabel(':')).toBe(':')
  })
})

describe('endsWithClaudeText', () => {
  it('마지막(대기 중 제외)이 글 있는 claude 메시지일 때만', () => {
    expect(endsWithClaudeText([message({ text: '진행할까요?' })])).toBe(true)
    expect(endsWithClaudeText([message({ text: '진행할까요?' }), message({ role: 'user', text: '다음', isQueued: true })])).toBe(true)
    expect(endsWithClaudeText([message({ text: '  ' })])).toBe(false)
    expect(endsWithClaudeText([message({ text: '답' }), message({ role: 'system', text: '[Request interrupted by user]', isInterrupt: true })])).toBe(false)
    expect(endsWithClaudeText([message({ text: '답' }), message({ role: 'user', text: '진행' })])).toBe(false)
    expect(endsWithClaudeText([])).toBe(false)
  })
})

describe('isQuickRepliesVisible', () => {
  it('모든 조건이 맞으면 보인다', () => {
    expect(isQuickRepliesVisible(VISIBLE)).toBe(true)
  })
  it('하나라도 어긋나면 숨는다', () => {
    expect(isQuickRepliesVisible({ ...VISIBLE, isWritable: false })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, isMember: true })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, isMyTurn: false })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, endsWithClaudeText: false })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, isWorking: true })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, isApprovalNeeded: true })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, isAsking: true })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, isHandingOver: true })).toBe(false)
    expect(isQuickRepliesVisible({ ...VISIBLE, hasUnconfirmedPending: true })).toBe(false)
  })
})
