import { describe, expect, it } from 'vitest'
import { MEMBER_EFFORTS, MEMBER_MODELS, memberExtraArgs, parseMemberModelChoice } from './memberModel.js'

describe('parseMemberModelChoice', () => {
  it('leaves both out when missing or null', () => {
    expect(parseMemberModelChoice({})).toEqual({ model: null, effort: null })
    expect(parseMemberModelChoice({ model: null, effort: null })).toEqual({ model: null, effort: null })
  })

  it('accepts every listed model and every effort, including the low ones', () => {
    for (const model of ['haiku', 'sonnet', 'opus', 'fable']) expect(parseMemberModelChoice({ model })).toEqual({ model, effort: null })
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) expect(parseMemberModelChoice({ effort })).toEqual({ model: null, effort })
    expect(parseMemberModelChoice({ model: 'haiku', effort: 'low' })).toEqual({ model: 'haiku', effort: 'low' })
    expect(MEMBER_MODELS).toEqual(['haiku', 'sonnet', 'opus', 'fable'])
    expect(MEMBER_EFFORTS).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('refuses values outside the lists, wrong case, padding and non-strings', () => {
    for (const model of ['', 'Opus', ' opus', 'opus ', 'claude-opus-5-5', 'gpt', 1, true, [], {}]) {
      expect(parseMemberModelChoice({ model }), JSON.stringify(model)).toBeUndefined()
    }
    for (const effort of ['', 'Max', 'ultra', 'none', 'high ', 3, false]) {
      expect(parseMemberModelChoice({ effort }), JSON.stringify(effort)).toBeUndefined()
    }
  })

  it('refuses the pair when only one side is wrong', () => {
    expect(parseMemberModelChoice({ model: 'sonnet', effort: 'huge' })).toBeUndefined()
    expect(parseMemberModelChoice({ model: 'gpt', effort: 'high' })).toBeUndefined()
  })
})

describe('memberExtraArgs', () => {
  it('keeps name and permission mode only when nothing is chosen', () => {
    expect(memberExtraArgs('[FE] Minji', 'bypassPermissions', { model: null, effort: null })).toEqual([
      '--name',
      '[FE] Minji',
      '--permission-mode',
      'bypassPermissions',
    ])
  })

  it('adds --model and --effort after them', () => {
    expect(memberExtraArgs('[QA] Junho', 'acceptEdits', { model: 'sonnet', effort: 'max' })).toEqual([
      '--name',
      '[QA] Junho',
      '--permission-mode',
      'acceptEdits',
      '--model',
      'sonnet',
      '--effort',
      'max',
    ])
    expect(memberExtraArgs('x', 'bypassPermissions', { model: 'haiku', effort: null }).slice(4)).toEqual(['--model', 'haiku'])
    expect(memberExtraArgs('x', 'bypassPermissions', { model: null, effort: 'low' }).slice(4)).toEqual(['--effort', 'low'])
  })
})
