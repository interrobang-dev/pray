import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ACCENT_VAR_NAMES,
  CHAT_ATTRIBUTE_NAMES,
  CHAT_CHOICE_KEYS,
  CHAT_COLOR_OPTIONS,
  CHAT_OPTIONS,
  DEFAULT_APPEARANCE,
  DEFAULT_CHAT_STYLE,
  chatAttributes,
  chatColorVars,
  chatColorWarnings,
  isWorkOpen,
  accentVars,
  appearanceBoot,
  contrast,
  documentState,
  mix,
  normalizeHex,
  overrideVars,
  paletteVars,
  parseAppearance,
  parseThemeChoice,
  resolveMode,
  type Appearance,
  type Mode,
  type ThemeChoice,
} from './appearance'
import { ACCENT_PRESETS, DEFAULT_VARS, PALETTES, type VarName } from './palettes'

const styleCss = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const MODES: Mode[] = ['light', 'dark']

/** style.css 의 한 선택자 블록 안 `--이름: 값;` */
function cssVars(selector: string): Record<string, string> {
  const start = styleCss.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const body = styleCss.slice(start, styleCss.indexOf('\n}', start))
  return Object.fromEntries([...body.matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2].trim()]))
}

describe('parseAppearance', () => {
  it('없거나 깨진 값은 기본값', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('{')).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('"x"')).toEqual(DEFAULT_APPEARANCE)
  })
  it('모르는 항목만 기본값', () => {
    expect(parseAppearance(JSON.stringify({ palette: 'nord', accent: 'nope', fontSize: 'huge' }))).toEqual({ palette: 'nord', accent: 'palette', fontSize: 'normal', chat: DEFAULT_CHAT_STYLE })
    expect(parseAppearance(JSON.stringify({ palette: 'nope', accent: '#12ab34', fontSize: 'large' }))).toEqual({ palette: 'default', accent: '#12ab34', fontSize: 'large', chat: DEFAULT_CHAT_STYLE })
    expect(parseAppearance(JSON.stringify({ accent: '#12AB34' })).accent).toBe('palette')
  })
  it('테마 선택', () => {
    expect(parseThemeChoice('dark')).toBe('dark')
    expect(parseThemeChoice('nope')).toBe('system')
    expect(resolveMode('system', true)).toBe('dark')
    expect(resolveMode('light', true)).toBe('light')
  })
})

describe('color math', () => {
  it('normalizeHex', () => {
    expect(normalizeHex(' #ABCDEF ')).toBe('#abcdef')
    expect(normalizeHex('abc')).toBe('#aabbcc')
    expect(normalizeHex('#abcd')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
  })
  it('contrast·mix', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#777777', '#777777')).toBe(1)
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})

describe('Default 팔레트', () => {
  it('palettes.ts 의 DEFAULT_VARS 가 style.css 맨 위 변수와 같다', () => {
    const light = cssVars(':root')
    const dark = { ...light, ...cssVars(":root[data-theme='dark']") }
    const { 'font-scale': _scale, ...lightColors } = light
    const { 'font-scale': _darkScale, ...darkColors } = dark
    expect(DEFAULT_VARS.light).toEqual(lightColors)
    expect(DEFAULT_VARS.dark).toEqual(darkColors)
  })
  it('Default + 팔레트 강조색이면 덮을 변수가 없다 (style.css 그대로)', () => {
    for (const mode of MODES) expect(overrideVars(DEFAULT_APPEARANCE, mode)).toEqual({})
  })
})

describe('팔레트', () => {
  const others = PALETTES.filter((palette) => palette.id !== 'default')

  it('Default 밖의 팔레트는 라이트·다크 두 벌이 다 있다', () => {
    for (const palette of others) {
      expect(palette.light, palette.id).not.toBeNull()
      expect(palette.dark, palette.id).not.toBeNull()
    }
  })

  it('펼친 변수는 Default 와 이름이 같고, 사무실 바닥(--floor)은 건드리지 않는다', () => {
    for (const palette of others) {
      for (const mode of MODES) {
        const vars = paletteVars(palette.id, mode)
        expect(Object.keys(vars).sort()).toEqual(Object.keys(DEFAULT_VARS[mode]).sort())
        expect(vars.floor).toBe(DEFAULT_VARS[mode].floor)
        expect(overrideVars({ ...DEFAULT_APPEARANCE, palette: palette.id }, mode)).not.toHaveProperty('floor')
      }
    }
  })

  /** 글자로 쓰이는 색 → 그 바탕들. 상태 색(빨강·노랑·파랑·초록)은 점·테두리로도 쓰이지만 글자로도 쓰여(경고·승인 대기) 같은 기준이다 */
  const TEXT_ON_SURFACE: VarName[] = ['text', 'muted', 'red', 'red-dot', 'error', 'yellow', 'blue-dot', 'success', 'success-text', 'link', 'accent-text']

  function failures(paletteId: string, mode: Mode, names: VarName[]): string[] {
    const vars = paletteVars(paletteId, mode)
    const result: string[] = []
    for (const name of names) {
      for (const surface of ['bg', 'panel'] as const) {
        const ratio = contrast(vars[name], vars[surface])
        if (ratio < 4.5) result.push(`${paletteId}/${mode} --${name} ${vars[name]} on --${surface} ${vars[surface]} = ${ratio.toFixed(2)}`)
      }
    }
    return result
  }

  it('다크: 모든 팔레트(Default 포함)의 글자·상태 색이 --bg·--panel 대비 4.5 이상', () => {
    expect(PALETTES.flatMap((palette) => failures(palette.id, 'dark', [...TEXT_ON_SURFACE, 'accent']))).toEqual([])
  })

  it('라이트: Default 밖의 팔레트는 글자·상태 색이 4.5 이상 (Default 라이트는 지금 색 그대로라 뺀다 — 노랑·파랑·초록·회색 글자가 못 미친다)', () => {
    expect(others.flatMap((palette) => failures(palette.id, 'light', TEXT_ON_SURFACE))).toEqual([])
  })

  it('대화 마크다운 기본색(제목·인라인 코드·숫자·경로)은 모든 팔레트·모드에서 바탕·패널·지시 말풍선·코드 바탕·표 머리 위에서 4.5 이상', () => {
    const result: string[] = []
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        const vars = paletteVars(palette.id, mode)
        for (const name of ['md-heading', 'md-code', 'md-number', 'md-path'] as const) {
          for (const surface of ['bg', 'panel', 'relay-bg', 'code-bg', 'pre-bg'] as const) {
            const ratio = contrast(vars[name], vars[surface])
            if (ratio < 4.5) result.push(`${palette.id}/${mode} --${name} ${vars[name]} on --${surface} ${vars[surface]} = ${ratio.toFixed(2)}`)
          }
        }
      }
    }
    expect(result).toEqual([])
  })

  it('네 가지 색이 한 팔레트·모드 안에서 서로 다르다', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        const vars = paletteVars(palette.id, mode)
        expect(new Set([vars['md-heading'], vars['md-code'], vars['md-number'], vars['md-path']]).size, `${palette.id}/${mode}`).toBe(4)
      }
    }
  })

  it('지시 말풍선 글자·검색 현재 결과 글자·채운 버튼 글자', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        const vars = paletteVars(palette.id, mode)
        const label = `${palette.id}/${mode}`
        expect(contrast(vars['relay-text'], vars['relay-bg']), label).toBeGreaterThanOrEqual(4.5)
        // Default 다크는 지금 색 그대로(흰 글자 / #b88a00 = 3.1)라 뺀다
        if (label !== 'default/dark') expect(contrast(vars['search-current-text'], vars['search-current-bg']), label).toBeGreaterThanOrEqual(4.5)
        expect(contrast(vars['on-red'], vars['red-fill']), label).toBeGreaterThanOrEqual(3.5)
        expect(contrast(vars['on-accent'], vars.accent), label).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('강조색', () => {
  const ACCENTS = ['palette', ...ACCENT_PRESETS.map((preset) => preset.id), '#ffffff', '#000000', '#ffff00', '#123456']

  it('어느 팔레트·모드·강조색이든 파생 색의 대비가 맞다', () => {
    for (const palette of PALETTES) {
      for (const mode of MODES) {
        for (const accent of ACCENTS) {
          const appearance: Appearance = { ...DEFAULT_APPEARANCE, palette: palette.id, accent }
          const vars = { ...DEFAULT_VARS[mode], ...overrideVars(appearance, mode) }
          const label = `${palette.id}/${mode}/${accent}`
          // Default 팔레트 강조색은 style.css 값 그대로라 계산 기준(라이트 3·다크 4.5)과 같은지만 본다
          expect(contrast(vars.accent, vars.panel), label).toBeGreaterThanOrEqual(mode === 'dark' ? 4.5 : 3)
          expect(contrast(vars['accent-text'], vars.panel), label).toBeGreaterThanOrEqual(4.5)
          expect(contrast(vars['accent-text'], vars['accent-soft']), label).toBeGreaterThanOrEqual(4.5)
          expect(contrast(vars['on-accent'], vars.accent), label).toBeGreaterThanOrEqual(3)
          // 선택 줄·내 말풍선 바탕 위 보통 글자
          expect(contrast(vars.text, vars['accent-soft']), label).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('강조색만 바꾸면 상태 초록은 그대로', () => {
    for (const mode of MODES) {
      const vars = overrideVars({ ...DEFAULT_APPEARANCE, accent: 'pink' }, mode)
      expect(Object.keys(vars).sort()).toEqual([...ACCENT_VAR_NAMES].sort())
      expect(vars).not.toHaveProperty('success')
    }
  })

  it('Default 초록은 그대로 쓰고 흰 글자 (지금 버튼과 같다)', () => {
    for (const mode of MODES) {
      const derived = accentVars('#3f9c4b', mode, { panel: DEFAULT_VARS[mode].panel, text: DEFAULT_VARS[mode].text, ink: '#2b2f3a' })
      expect(derived.accent).toBe('#3f9c4b')
      expect(derived['on-accent']).toBe('#ffffff')
    }
  })

  it('패널 대비가 모자란 강조색은 라이트는 어둡게, 다크는 밝게 바꾼다', () => {
    const light = accentVars('#ffff00', 'light', { panel: '#ffffff', text: '#2b2f3a', ink: '#2b2f3a' })
    expect(contrast(light.accent, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(light['on-accent']).toBe('#ffffff')
    const dark = accentVars('#123456', 'dark', { panel: '#1f2228', text: '#e3e5ea', ink: '#16181d' })
    expect(contrast(dark.accent, '#1f2228')).toBeGreaterThanOrEqual(4.5)
    // 밝은 강조색은 흰 글자가 3 아래라 ink(다크 바탕색) 글자
    expect(accentVars('#cba6f7', 'dark', { panel: '#1e1e2e', text: '#cdd6f4', ink: '#181825' })['on-accent']).toBe('#181825')
  })
})

describe('대화 모양', () => {
  it('저장 값 해석: 모르는 항목·틀린 색만 기본값', () => {
    const parsed = parseAppearance(
      JSON.stringify({ chat: { user: 'bar', reply: 'nope', width: 'full', fontSize: 'small', tables: 'rules', workBundles: 'expanded', colors: { code: '#ABCDEF', link: '#00aa11', quote: 'red' } } }),
    )
    expect(parsed.chat).toEqual({
      ...DEFAULT_CHAT_STYLE,
      user: 'bar',
      width: 'full',
      fontSize: 'small',
      tables: 'rules',
      workBundles: 'expanded',
      colors: { code: null, link: '#00aa11', heading: null, quote: null, number: null, path: null },
    })
    expect(parseAppearance(JSON.stringify({ chat: 'x' })).chat).toEqual(DEFAULT_CHAT_STYLE)
  })

  it('선택지의 첫 값이 기본값이고, 기본값이면 속성을 걸지 않는다', () => {
    for (const key of CHAT_CHOICE_KEYS) expect(CHAT_OPTIONS[key].options[0].value, key).toBe(DEFAULT_CHAT_STYLE[key])
    expect(chatAttributes(DEFAULT_CHAT_STYLE)).toEqual({})
    expect(chatAttributes({ ...DEFAULT_CHAT_STYLE, user: 'plain', fontSize: 'large', lineSpacing: 'relaxed', workBundles: 'expanded' })).toEqual({
      user: 'plain',
      'font-size': 'large',
      line: 'relaxed',
      work: 'expanded',
    })
    // 숫자·경로 강조는 기본이 On 이라 Off 일 때만 속성이 걸린다
    expect(chatAttributes({ ...DEFAULT_CHAT_STYLE, numbers: 'off' })).toEqual({ numbers: 'off' })
    expect(chatAttributes({ ...DEFAULT_CHAT_STYLE, paths: 'off' })).toEqual({ paths: 'off' })
    expect(parseAppearance(JSON.stringify({ chat: { numbers: 'off', paths: 'nope' } })).chat).toMatchObject({ numbers: 'off', paths: 'on' })
    expect(new Set(CHAT_ATTRIBUTE_NAMES).size).toBe(CHAT_ATTRIBUTE_NAMES.length)
  })

  it('색 줄 스위치: 기본 On 이라 속성이 없고, Off 만 걸리며, 옛 저장 값은 그대로 읽힌다', () => {
    expect(chatAttributes({ ...DEFAULT_CHAT_STYLE, codeColor: 'off', linkColor: 'off', headingColor: 'off', quoteColor: 'off' })).toEqual({
      'code-color': 'off',
      'link-color': 'off',
      'heading-color': 'off',
      'quote-color': 'off',
    })
    // 새 키가 없는 옛 저장 값: numbers·paths·colors 는 그대로, 나머지 넷은 On
    const old = parseAppearance(JSON.stringify({ chat: { numbers: 'off', colors: { link: '#00aa11' } } })).chat
    expect(old).toMatchObject({ numbers: 'off', paths: 'on', codeColor: 'on', linkColor: 'on', headingColor: 'on', quoteColor: 'on' })
    expect(old.colors.link).toBe('#00aa11')
    // 끄면 골라 둔 색 값은 남는다 (변수도 그대로, CSS 가 안 쓴다)
    const off = parseAppearance(JSON.stringify({ chat: { linkColor: 'off', colors: { link: '#00aa11' } } })).chat
    expect(off.linkColor).toBe('off')
    expect(chatColorVars(off.colors)).toEqual({ 'chat-link': '#00aa11' })
    expect(CHAT_COLOR_OPTIONS.map((option) => option.label)).toEqual(['Numbers', 'Paths', 'Headings', 'Inline code', 'Links', 'Quotes'])
  })

  it('끈 줄은 대비 경고를 하지 않는다', () => {
    const colors = { ...DEFAULT_CHAT_STYLE.colors, link: '#ffffff', heading: '#2b2f3a' }
    expect(chatColorWarnings(colors, 'default', { ...DEFAULT_CHAT_STYLE, linkColor: 'off' }).map((warning) => warning.key)).toEqual(['heading'])
  })

  it('글자 색은 고른 것만 두 모드에 같은 변수로', () => {
    const appearance: Appearance = { ...DEFAULT_APPEARANCE, chat: { ...DEFAULT_CHAT_STYLE, colors: { ...DEFAULT_CHAT_STYLE.colors, link: '#ff0088' } } }
    expect(chatColorVars(appearance.chat.colors)).toEqual({ 'chat-link': '#ff0088' })
    expect(chatColorVars({ ...DEFAULT_CHAT_STYLE.colors, number: '#aa5500', path: '#007766' })).toEqual({ 'chat-number': '#aa5500', 'chat-path': '#007766' })
    for (const mode of MODES) expect(documentState(appearance, mode).vars).toEqual({ 'chat-link': '#ff0088' })
  })

  it('바탕 대비 3 아래인 색은 그 모드를 경고한다', () => {
    const colors = { ...DEFAULT_CHAT_STYLE.colors, link: '#ffffff', heading: '#2b2f3a', quote: '#3a3d45' }
    const warnings = chatColorWarnings(colors, 'default')
    expect(warnings.map((warning) => `${warning.key}/${warning.mode}`).sort()).toEqual(['heading/dark', 'link/light', 'quote/dark'].sort())
    expect(warnings.every((warning) => warning.ratio < 3)).toBe(true)
    expect(chatColorWarnings(DEFAULT_CHAT_STYLE.colors, 'nord')).toEqual([])
  })

  it('작업 묶음: 사람이 정한 것이 먼저, 없으면 설정 (진행 중은 늘 접힘)', () => {
    expect(isWorkOpen(false, undefined, 'collapsed')).toBe(false)
    expect(isWorkOpen(false, undefined, 'expanded')).toBe(true)
    expect(isWorkOpen(true, undefined, 'expanded')).toBe(false)
    expect(isWorkOpen(false, false, 'expanded')).toBe(false)
    expect(isWorkOpen(false, true, 'collapsed')).toBe(true)
    expect(isWorkOpen(true, true, 'collapsed')).toBe(true)
  })
})

describe('index.html 첫 화면 스크립트', () => {
  const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)![1]

  /** 가짜 브라우저에서 인라인 스크립트를 돌려 <html> 에 걸린 것을 돌려준다 */
  function runInline(storage: Record<string, string>, isOsDark: boolean, isStorageBlocked = false) {
    const vars: Record<string, string> = {}
    const chat: Record<string, string> = {}
    const root = {
      dataset: {} as Record<string, string>,
      style: { colorScheme: '', setProperty: (name: string, value: string) => (vars[name.slice(2)] = value) },
      setAttribute: (name: string, value: string) => (chat[name.replace('data-chat-', '')] = value),
    }
    const localStorage = {
      getItem: (key: string) => {
        if (isStorageBlocked) throw new Error('blocked')
        return storage[key] ?? null
      },
    }
    const window = { matchMedia: () => ({ matches: isOsDark }) }
    new Function('document', 'localStorage', 'window', script)({ documentElement: root }, localStorage, window)
    return { theme: root.dataset.theme, colorScheme: root.style.colorScheme, palette: root.dataset.palette, fontSize: root.dataset.fontSize, chat, vars }
  }

  const APPEARANCES: Appearance[] = [
    DEFAULT_APPEARANCE,
    { palette: 'nord', accent: 'palette', fontSize: 'small', chat: DEFAULT_CHAT_STYLE },
    { palette: 'default', accent: 'blue', fontSize: 'large', chat: { ...DEFAULT_CHAT_STYLE, user: 'bar', tables: 'minimal' } },
    { palette: 'catppuccin', accent: '#e05a00', fontSize: 'normal', chat: { ...DEFAULT_CHAT_STYLE, fontSize: 'large', colors: { ...DEFAULT_CHAT_STYLE.colors, link: '#ff0088' } } },
    { palette: 'default', accent: 'palette', fontSize: 'normal', chat: { ...DEFAULT_CHAT_STYLE, reply: 'plain', width: 'full', workBundles: 'expanded', colors: { code: '#123456', link: null, heading: '#abcdef', quote: '#654321', number: '#aa5500', path: '#007766' } } },
    { palette: 'solarized', accent: 'slate', fontSize: 'large', chat: DEFAULT_CHAT_STYLE },
  ]
  const CHOICES: ThemeChoice[] = ['light', 'dark', 'system']

  it('theme.ts 가 저장해 둔 값으로 theme.ts 와 같은 결과를 건다', () => {
    for (const appearance of APPEARANCES) {
      for (const choice of CHOICES) {
        for (const isOsDark of [false, true]) {
          const storage = { 'jk-corp.theme': choice, 'jk-corp.appearanceBoot': JSON.stringify(appearanceBoot(appearance)) }
          const expected = documentState(appearance, resolveMode(choice, isOsDark))
          expect(runInline(storage, isOsDark)).toEqual({ ...expected, colorScheme: expected.theme })
        }
      }
    }
  })

  it('저장된 것이 없거나 읽지 못하면 Default·시스템', () => {
    const expected = documentState(DEFAULT_APPEARANCE, 'dark')
    expect(runInline({}, true)).toEqual({ ...expected, colorScheme: 'dark' })
    expect(runInline({ 'jk-corp.theme': 'light' }, true, true)).toEqual({ ...expected, colorScheme: 'dark' })
    expect(runInline({ 'jk-corp.theme': 'light', 'jk-corp.appearanceBoot': '{' }, true).theme).toBe('light')
  })
})
