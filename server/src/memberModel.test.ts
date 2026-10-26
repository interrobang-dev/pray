import { describe, expect, it } from 'vitest'
import { MEMBER_EFFORTS, MEMBER_MODELS, memberExtraArgs, modelSettingOf, parseMemberModelChoice, withModelSetting } from './memberModel.js'

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

/** 팀장 extraArgs 꼴 (leadExtraArgs). 지침·MCP 설정 값 자리에 `--model`·`--effort` 같은 글자가 와도 값으로 남아야 한다 */
const LEAD_ARGS = [
  '--name',
  '개발 팀장',
  '--permission-mode',
  'bypassPermissions',
  '--append-system-prompt',
  '지침\n--model opus 는 쓰지 마라',
  '--mcp-config',
  '{"mcpServers":{"jk-corp":{"args":["--effort","max"]}}}',
]

describe('modelSettingOf', () => {
  it('reads nothing from args without model or effort', () => {
    expect(modelSettingOf([])).toEqual({ model: null, effort: null })
    expect(modelSettingOf(LEAD_ARGS)).toEqual({ model: null, effort: null })
  })

  it('reads the member spawn args', () => {
    expect(modelSettingOf(memberExtraArgs('[FE] Minji', 'bypassPermissions', { model: 'sonnet', effort: 'high' }))).toEqual({
      model: 'sonnet',
      effort: 'high',
    })
    expect(modelSettingOf(memberExtraArgs('x', 'bypassPermissions', { model: null, effort: 'low' }))).toEqual({ model: null, effort: 'low' })
  })

  it('reads the --option=value form and keeps values that are not aliases as they are', () => {
    expect(modelSettingOf(['--model=claude-opus-5-5', '--effort=xhigh'])).toEqual({ model: 'claude-opus-5-5', effort: 'xhigh' })
  })

  it('takes the last one when repeated, like claude does', () => {
    expect(modelSettingOf(['--model', 'haiku', '--model=opus', '--effort', 'low', '--effort', 'max'])).toEqual({ model: 'opus', effort: 'max' })
  })

  it('does not read an option name that sits in a value slot', () => {
    expect(modelSettingOf(['--name', '--model', '--append-system-prompt', '--effort'])).toEqual({ model: null, effort: null })
    expect(modelSettingOf(['--model', '--effort', '--effort', 'low'])).toEqual({ model: '--effort', effort: 'low' })
  })

  it('treats a missing or empty value as none', () => {
    expect(modelSettingOf(['--model'])).toEqual({ model: null, effort: null })
    expect(modelSettingOf(['--model=', '--effort='])).toEqual({ model: null, effort: null })
  })
})

describe('withModelSetting', () => {
  it('adds model and effort after the lead args and leaves their values untouched', () => {
    expect(withModelSetting(LEAD_ARGS, { model: 'opus', effort: 'max' })).toEqual([...LEAD_ARGS, '--model', 'opus', '--effort', 'max'])
  })

  it('replaces the member values in place of the old ones, matching a fresh member spawn', () => {
    const before = memberExtraArgs('[FE] Minji', 'bypassPermissions', { model: 'haiku', effort: 'low' })
    expect(withModelSetting(before, { model: 'sonnet', effort: 'high' })).toEqual(
      memberExtraArgs('[FE] Minji', 'bypassPermissions', { model: 'sonnet', effort: 'high' }),
    )
  })

  it('only drops --effort when effort is null', () => {
    const before = memberExtraArgs('x', 'acceptEdits', { model: 'opus', effort: 'max' })
    expect(withModelSetting(before, { model: 'opus', effort: null })).toEqual(['--name', 'x', '--permission-mode', 'acceptEdits', '--model', 'opus'])
    expect(withModelSetting(before, { model: null, effort: null })).toEqual(['--name', 'x', '--permission-mode', 'acceptEdits'])
  })

  it('drops the --option=value form and repeated ones', () => {
    expect(withModelSetting(['--model=haiku', '--name', 'x', '--effort=low', '--model', 'opus'], { model: 'fable', effort: 'medium' })).toEqual([
      '--name',
      'x',
      '--model',
      'fable',
      '--effort',
      'medium',
    ])
  })

  it('keeps a value that reads like --model or --effort together with its option', () => {
    const args = ['--name', '--model', '--append-system-prompt', '--effort', '--model', 'haiku']
    expect(withModelSetting(args, { model: 'opus', effort: null })).toEqual(['--name', '--model', '--append-system-prompt', '--effort', '--model', 'opus'])
  })

  it('keeps unknown tokens in order, one by one', () => {
    expect(withModelSetting(['--verbose', 'extra', '--model', 'haiku', '--x=1'], { model: 'sonnet', effort: null })).toEqual([
      '--verbose',
      'extra',
      '--x=1',
      '--model',
      'sonnet',
    ])
  })

  it('reads back what it wrote', () => {
    for (const model of MEMBER_MODELS) {
      for (const effort of [...MEMBER_EFFORTS, null]) {
        expect(modelSettingOf(withModelSetting(LEAD_ARGS, { model, effort }))).toEqual({ model, effort })
      }
    }
  })
})
