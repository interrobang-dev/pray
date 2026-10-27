import { describe, expect, it } from 'vitest'
import { summarizeTranscript, type TurnOutcome } from './transcript.js'

const line = (record: Record<string, unknown>) => JSON.stringify(record)
const human = (content: unknown = '해 줘', extra: Record<string, unknown> = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra })
const toolResult = () => human([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }])
const toolCall = (text?: string) =>
  line({
    type: 'assistant',
    message: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id: 't', name: 'Bash', input: {} }] },
  })
const finalText = (text: string, stopReason: string | null = 'end_turn', extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', message: { model: 'claude-opus-5-5', stop_reason: stopReason, content: [{ type: 'text', text }] }, ...extra })
const thinkingEnd = () => line({ type: 'assistant', message: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '…' }] } })
const costState = () => line({ type: 'cost-state', totalCostUSD: 1 })
const turnOf = (...lines: string[]): TurnOutcome => summarizeTranscript(lines.join('\n')).turn

describe('summarizeTranscript turn', () => {
  it('is none without any conversation line', () => {
    expect(turnOf()).toEqual({ kind: 'none', text: null })
    expect(turnOf(line({ type: 'ai-title', aiTitle: 't' }), costState())).toEqual({ kind: 'none', text: null })
  })

  it('is ended with the final text after the last human input, even with lines after it', () => {
    const hookLines = [line({ type: 'system', subtype: 'turn_duration' }), costState(), line({ type: 'last-prompt' }), costState()]
    expect(turnOf(human(), toolCall('먼저 확인'), toolResult(), finalText('끝냈습니다.'), ...hookLines)).toEqual({ kind: 'ended', text: '끝냈습니다.' })
  })

  it('keeps the text written before a trailing thinking-only end_turn line, and has null text when the turn wrote none', () => {
    expect(turnOf(human(), finalText('글'), thinkingEnd())).toEqual({ kind: 'ended', text: '글' })
    expect(turnOf(human(), finalText('앞 차례 글'), human('다음'), thinkingEnd())).toEqual({ kind: 'ended', text: null })
  })

  it('is interrupted when the last conversation line is an interrupt line', () => {
    expect(turnOf(human(), toolCall(), toolResult(), human([{ type: 'text', text: '[Request interrupted by user for tool use]' }]))).toMatchObject({ kind: 'interrupted' })
    expect(turnOf(human(), finalText('쓰던 글', null), human('[Request interrupted by user]'))).toMatchObject({ kind: 'interrupted' })
  })

  it('is in-progress in the middle of a turn without a process boundary', () => {
    expect(turnOf(human())).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(human(), toolCall())).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(human(), toolCall(), toolResult())).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(human(), finalText('쓰는 중', null))).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(human(), finalText('도구 앞 설명', 'tool_use'))).toMatchObject({ kind: 'in-progress' })
  })

  it('is cut when a process boundary (cost-state) follows the middle of a turn', () => {
    expect(turnOf(human(), toolCall(), costState())).toEqual({ kind: 'cut', text: null })
    expect(turnOf(human(), costState())).toMatchObject({ kind: 'cut' })
    expect(turnOf(human(), toolCall(), toolResult(), costState(), line({ type: 'last-prompt' }), costState())).toMatchObject({ kind: 'cut' })
  })

  it('forgets an old boundary once the conversation continues', () => {
    expect(turnOf(human(), toolCall(), costState(), human('이어서'))).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(human(), toolCall(), costState(), finalText('끝'))).toMatchObject({ kind: 'ended', text: '끝' })
  })

  it('takes a queued_command attachment as a human input that starts or continues a turn', () => {
    const queued = (prompt: string) => line({ type: 'attachment', attachment: { type: 'queued_command', prompt } })
    expect(turnOf(human(), finalText('끝'), queued('또 해 줘'))).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(human(), finalText('끝'), queued('<task-notification>x</task-notification>'))).toMatchObject({ kind: 'ended', text: '끝' })
  })

  it('skips notifications, slash commands, synthetic replies, sidechains, meta and compact summaries', () => {
    const base = [human(), finalText('끝')]
    expect(turnOf(...base, human('<task-notification>\n<task-id>b</task-id>\n</task-notification>'))).toMatchObject({ kind: 'ended', text: '끝' })
    expect(turnOf(...base, human('<local-command-stdout>ok</local-command-stdout>'))).toMatchObject({ kind: 'ended', text: '끝' })
    expect(turnOf(human(), toolCall(), line({ type: 'assistant', message: { model: '<synthetic>', stop_reason: 'stop_sequence', content: [{ type: 'text', text: 'No response requested.' }] } }))).toMatchObject({ kind: 'in-progress' })
    expect(turnOf(...base, human('사이드', { isSidechain: true }), toolCall().replace('}', ',"isSidechain":true}'))).toMatchObject({ kind: 'ended', text: '끝' })
    expect(turnOf(...base, human('메타', { isMeta: true }))).toMatchObject({ kind: 'ended', text: '끝' })
    expect(turnOf(...base, human('요약', { isCompactSummary: true }))).toMatchObject({ kind: 'ended', text: '끝' })
    expect(turnOf(human(), toolCall(), finalText('사이드 글', 'end_turn', { isSidechain: true }))).toMatchObject({ kind: 'in-progress' })
  })

  it('answers a notification wake-up in the same way: a cut after its tool call is a cut turn', () => {
    expect(turnOf(human(), finalText('끝'), human('<task-notification>x</task-notification>'), toolCall(), costState())).toMatchObject({ kind: 'cut' })
  })
})
