import { describe, expect, it } from 'vitest'
import { parseCollapsedGroupIds, statusSummary, summaryLabel, toggleCollapsedGroup } from './listCollapse'
import type { Attendance, SessionStatus } from './types'

function session(status: SessionStatus, attendance: Attendance = 'present') {
  return { status, attendance, isAlive: attendance === 'present' }
}

describe('parseCollapsedGroupIds', () => {
  it('글자 배열만 읽는다', () => {
    expect(parseCollapsedGroupIds('["a","b"]')).toEqual(['a', 'b'])
    expect(parseCollapsedGroupIds('["a",1,null,"b"]')).toEqual(['a', 'b'])
  })
  it('없거나 깨졌거나 배열이 아니면 []', () => {
    expect(parseCollapsedGroupIds(null)).toEqual([])
    expect(parseCollapsedGroupIds('')).toEqual([])
    expect(parseCollapsedGroupIds('[a')).toEqual([])
    expect(parseCollapsedGroupIds('{"a":1}')).toEqual([])
    expect(parseCollapsedGroupIds('"a"')).toEqual([])
  })
})

describe('toggleCollapsedGroup', () => {
  it('펼친 그룹은 접고 접힌 그룹은 편다', () => {
    expect(toggleCollapsedGroup(['a'], 'b', ['a', 'b'])).toEqual(['a', 'b'])
    expect(toggleCollapsedGroup(['a', 'b'], 'a', ['a', 'b'])).toEqual(['b'])
  })
  it('없어진 그룹 ID 는 같이 지운다', () => {
    expect(toggleCollapsedGroup(['gone', 'a'], 'b', ['a', 'b'])).toEqual(['a', 'b'])
    expect(toggleCollapsedGroup(['gone', 'a'], 'a', ['a'])).toEqual([])
  })
})

describe('statusSummary', () => {
  it('승인 대기 · 내 차례 · 작업 중 순서, 0 은 뺀다', () => {
    const sessions = [session('working'), session('my-turn'), session('needs-approval'), session('working'), session('idle')]
    expect(statusSummary(sessions)).toEqual([
      { status: 'needs-approval', count: 1 },
      { status: 'my-turn', count: 1 },
      { status: 'working', count: 2 },
    ])
    expect(statusSummary([session('working')])).toEqual([{ status: 'working', count: 1 }])
  })
  it('waiting·done·idle 은 세지 않고 셋 다 없으면 []', () => {
    expect(statusSummary([session('waiting'), session('done'), session('idle'), session('unknown')])).toEqual([])
    expect(statusSummary([])).toEqual([])
  })
  it('휴식·퇴근은 훅 상태가 남아 있어도 세지 않는다', () => {
    expect(statusSummary([session('working', 'break'), session('needs-approval', 'off')])).toEqual([])
  })
  it('attendance 가 없는 옛 응답은 isAlive 로 근무를 본다', () => {
    expect(statusSummary([{ status: 'working', isAlive: true }, { status: 'working', isAlive: false }])).toEqual([{ status: 'working', count: 1 }])
  })
})

describe('summaryLabel', () => {
  it('statusLabel 문구를 " · " 로 잇는다', () => {
    expect(summaryLabel([{ status: 'needs-approval', count: 1 }, { status: 'my-turn', count: 2 }])).toBe('1 Needs approval · 2 Your turn')
    expect(summaryLabel([])).toBe('')
  })
})
