import { describe, expect, it } from 'vitest'
import { sessionMenuEntries } from './sessionMenu'

describe('sessionMenuEntries', () => {
  it('근무 중인 웹 세션: 이름·모델·구분선·종료', () => {
    expect(sessionMenuEntries({ kind: 'web', attendance: 'present', isAlive: true })).toEqual(['rename', 'model', 'separator', 'end'])
  })
  it('휴식 웹 세션은 이름만', () => {
    expect(sessionMenuEntries({ kind: 'web', attendance: 'break', isAlive: false })).toEqual(['rename'])
  })
  it('퇴근 웹 세션: 이름·다시 출근·구분선·기록 지우기', () => {
    expect(sessionMenuEntries({ kind: 'web', attendance: 'off', isAlive: false })).toEqual(['rename', 'clock-in', 'separator', 'delete-record'])
  })
  it('외부 세션은 이름만', () => {
    expect(sessionMenuEntries({ kind: 'external', attendance: 'present', isAlive: true })).toEqual(['rename'])
  })
  it('attendance 가 없는 옛 응답: 산 웹 세션은 근무, 끝난 세션은 이름만', () => {
    expect(sessionMenuEntries({ kind: 'web', isAlive: true })).toEqual(['rename', 'model', 'separator', 'end'])
    expect(sessionMenuEntries({ kind: 'web', isAlive: false })).toEqual(['rename'])
  })
})
