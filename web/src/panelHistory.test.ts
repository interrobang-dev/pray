import { describe, expect, it } from 'vitest'
import { PANEL_STATE, isPanelState, panelHistoryStep, shouldClosePanelOnPop } from './panelHistory'

describe('panelHistoryStep', () => {
  it('폰 폭에서 패널을 열면 쌓는다', () => {
    expect(panelHistoryStep(true, true, false)).toBe('push')
  })
  it('패널이 열린 채 세션만 바뀌면 그대로', () => {
    expect(panelHistoryStep(true, true, true)).toBeNull()
  })
  it('패널을 닫으면 되돌린다', () => {
    expect(panelHistoryStep(true, false, true)).toBe('back')
  })
  it('데스크톱 폭에서는 쌓지 않는다', () => {
    expect(panelHistoryStep(false, true, false)).toBeNull()
    expect(panelHistoryStep(false, false, false)).toBeNull()
  })
  it('폰에서 데스크톱 폭이 되면 쌓은 것을 되돌린다', () => {
    expect(panelHistoryStep(false, true, true)).toBe('back')
  })
  it('목록만 보이면 아무 일 없다', () => {
    expect(panelHistoryStep(true, false, false)).toBeNull()
  })
})

describe('shouldClosePanelOnPop', () => {
  it('쌓은 기록에서 뒤로 가면 닫는다', () => {
    expect(shouldClosePanelOnPop(true, null)).toBe(true)
  })
  it('앱이 되돌린 뒤의 popstate 는 무시', () => {
    expect(shouldClosePanelOnPop(false, null)).toBe(false)
  })
  it('아직 패널 기록 위면 닫지 않는다', () => {
    expect(shouldClosePanelOnPop(true, PANEL_STATE)).toBe(false)
  })
})

describe('isPanelState', () => {
  it('패널 state 만 알아본다', () => {
    expect(isPanelState(PANEL_STATE)).toBe(true)
    expect(isPanelState({ prayPanel: true })).toBe(true)
    expect(isPanelState(null)).toBe(false)
    expect(isPanelState({})).toBe(false)
    expect(isPanelState('x')).toBe(false)
  })
})
