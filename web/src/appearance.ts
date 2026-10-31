/**
 * 화면 스타일 설정(Appearance)의 순수 로직: 고른 값 해석, 색 계산(명암비·섞기), 팔레트 펼치기, 강조색 파생 색, 대화 모양, 문서에 걸 값.
 * DOM 에 거는 것은 theme.ts, 팔레트 값은 palettes.ts, 설정 창은 AppearanceModal.tsx(App 탭)·ChatStyleTab.tsx(Chat 탭).
 * 색 변수 이름은 style.css 맨 위 `:root` 의 이름에서 `--` 를 뗀 것이다
 */
import { ACCENT_PRESETS, DEFAULT_VARS, PALETTES, type PaletteCore, type VarName, type Vars } from './palettes'

export type Mode = 'light' | 'dark'
export type FontSize = 'small' | 'normal' | 'large'

export interface Appearance {
  /** palettes.ts 의 팔레트 id */
  palette: string
  /** 'palette' = 팔레트 자체 강조색, 프리셋 id, 또는 직접 입력 '#rrggbb' (소문자) */
  accent: string
  fontSize: FontSize
  /** 대화 탭 모양 (설정 창 Chat 탭) */
  chat: ChatStyle
}

/** 화면 테마 선택 (헤더 테마 버튼·설정 창 Mode). 시스템이면 OS prefers-color-scheme 을 따른다 */
export type ThemeChoice = 'light' | 'dark' | 'system'

/** localStorage 키: 테마 선택 (theme.ts·index.html) */
export const THEME_KEY = 'pray.theme'

/** 저장된 테마 선택. 모르는 값이면 시스템 */
export function parseThemeChoice(raw: string | null): ThemeChoice {
  return raw === 'light' || raw === 'dark' ? raw : 'system'
}

export function resolveMode(choice: ThemeChoice, isOsDark: boolean): Mode {
  return choice === 'dark' || (choice === 'system' && isOsDark) ? 'dark' : 'light'
}

/** 대화 탭 모양. 바꾸는 범위는 대화 탭 안(style.css 의 .chat-scope — 대화 목록과 설정 창 미리보기)뿐이다 */
export interface ChatStyle {
  /** 내 말: 말풍선 / 왼쪽 강조색 세로줄 / 꾸밈 없이 */
  user: 'bubble' | 'bar' | 'plain'
  /** claude 답: 카드 / 테두리·바탕 없이 본문처럼 */
  reply: 'card' | 'plain'
  /** 사무실을 숨긴 넓은 화면의 대화 열 폭: 960px / 1200px / 양옆 16px 만 */
  width: 'normal' | 'wide' | 'full'
  /** 말풍선·마크다운 글자 크기. app = App 탭의 Font size 그대로 */
  fontSize: 'app' | FontSize
  lineSpacing: 'compact' | 'normal' | 'relaxed'
  /** 마크다운 표: 칸마다 테두리 / 줄 사이 선만 / 머리 아래 선만 */
  tables: 'box' | 'rules' | 'minimal'
  headings: 'default' | 'underline'
  /** 끝난 작업 묶음을 처음에 접을지 펼칠지 (사용자가 직접 접거나 펼친 묶음은 그대로 — isWorkOpen) */
  workBundles: 'collapsed' | 'expanded'
  /** 숫자·파일 경로 강조 켜기/끄기 (끄면 CSS 가 색만 끈다 — 글을 다시 파싱하지 않는다). 색은 colors.number·colors.path */
  numbers: 'on' | 'off'
  paths: 'on' | 'off'
  /** 나머지 색 줄의 켜기/끄기 (설정 창 Colors 줄 스위치). 끄면 CSS 가 그 줄의 색을 안 쓴다 — 골라 둔 값은 colors 에 남는다 */
  codeColor: 'on' | 'off'
  headingColor: 'on' | 'off'
  /** 글자 색. null = 팔레트 값 */
  colors: ChatColors
}

export interface ChatColors {
  code: string | null
  heading: string | null
  number: string | null
  path: string | null
}

type ChatChoiceKey = Exclude<keyof ChatStyle, 'colors'>

const ON_OFF: { value: 'on' | 'off'; label: string }[] = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

/** 대화 모양 선택지 (설정 창 순서). attribute 는 <html data-chat-…> 의 이름이고 첫 선택지가 기본값이다 — 기본값이면 속성을 걸지 않는다 */
export const CHAT_OPTIONS: { [K in ChatChoiceKey]: { attribute: string; label: string; options: { value: ChatStyle[K]; label: string }[] } } = {
  user: {
    attribute: 'user',
    label: 'Your messages',
    options: [
      { value: 'bubble', label: 'Bubble' },
      { value: 'bar', label: 'Bar' },
      { value: 'plain', label: 'Plain' },
    ],
  },
  reply: {
    attribute: 'reply',
    label: 'Claude replies',
    options: [
      { value: 'card', label: 'Card' },
      { value: 'plain', label: 'Plain' },
    ],
  },
  width: {
    attribute: 'width',
    label: 'Chat width',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full' },
    ],
  },
  fontSize: {
    attribute: 'font-size',
    label: 'Chat font size',
    options: [
      { value: 'app', label: 'App' },
      { value: 'small', label: 'Small' },
      { value: 'normal', label: 'Normal' },
      { value: 'large', label: 'Large' },
    ],
  },
  lineSpacing: {
    attribute: 'line',
    label: 'Line spacing',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'compact', label: 'Compact' },
      { value: 'relaxed', label: 'Relaxed' },
    ],
  },
  tables: {
    attribute: 'tables',
    label: 'Tables',
    options: [
      { value: 'box', label: 'Box' },
      { value: 'rules', label: 'Rules' },
      { value: 'minimal', label: 'Minimal' },
    ],
  },
  headings: {
    attribute: 'headings',
    label: 'Headings',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'underline', label: 'Underline' },
    ],
  },
  workBundles: {
    attribute: 'work',
    label: 'Work bundles',
    options: [
      { value: 'collapsed', label: 'Collapsed' },
      { value: 'expanded', label: 'Expanded' },
    ],
  },
  numbers: { attribute: 'numbers', label: 'Numbers', options: ON_OFF },
  paths: { attribute: 'paths', label: 'Paths', options: ON_OFF },
  codeColor: { attribute: 'code-color', label: 'Inline code', options: ON_OFF },
  headingColor: { attribute: 'heading-color', label: 'Headings', options: ON_OFF },
}

/** Colors 줄 스위치로만 바꾸는 켜기/끄기 키. 세그먼트 목록(설정 창 위쪽)에는 나오지 않는다 */
export type ChatSwitchKey = 'numbers' | 'paths' | 'codeColor' | 'headingColor'
const CHAT_SWITCH_KEYS: ChatChoiceKey[] = ['numbers', 'paths', 'codeColor', 'headingColor']

export const CHAT_CHOICE_KEYS = Object.keys(CHAT_OPTIONS) as ChatChoiceKey[]
export const CHAT_SEGMENT_KEYS = CHAT_CHOICE_KEYS.filter((key) => !CHAT_SWITCH_KEYS.includes(key))

/** 대화 글자 색. variable 은 <html> 에 인라인으로 거는 변수 이름이고, 비어 있으면 style.css 가 팔레트 값으로 대신한다 (var(--chat-heading, var(--md-heading))). switchKey = 그 줄 스위치 */
export const CHAT_COLOR_OPTIONS: { key: keyof ChatColors; label: string; variable: string; surfaces: VarName[]; switchKey: ChatSwitchKey }[] = [
  { key: 'number', label: 'Numbers', variable: 'chat-number', surfaces: ['panel', 'bg'], switchKey: 'numbers' },
  { key: 'path', label: 'Paths', variable: 'chat-path', surfaces: ['panel', 'bg'], switchKey: 'paths' },
  { key: 'heading', label: 'Headings', variable: 'chat-heading', surfaces: ['panel', 'bg'], switchKey: 'headingColor' },
  { key: 'code', label: 'Inline code', variable: 'chat-code', surfaces: ['code-bg'], switchKey: 'codeColor' },
]

export const DEFAULT_CHAT_STYLE: ChatStyle = {
  user: 'bubble',
  reply: 'card',
  width: 'normal',
  fontSize: 'app',
  lineSpacing: 'normal',
  tables: 'box',
  headings: 'default',
  workBundles: 'collapsed',
  numbers: 'on',
  paths: 'on',
  codeColor: 'on',
  headingColor: 'on',
  colors: { code: null, heading: null, number: null, path: null },
}

export const DEFAULT_APPEARANCE: Appearance = { palette: 'default', accent: 'palette', fontSize: 'normal', chat: DEFAULT_CHAT_STYLE }

/** 글자 크기 선택지. 기준(Normal)은 지금 화면의 14px 이고, 모든 글자가 같은 비율로 바뀐다 (style.css 의 --font-scale) */
export const FONT_SIZE_OPTIONS: { value: FontSize; label: string; px: number }[] = [
  { value: 'small', label: 'Small', px: 13 },
  { value: 'normal', label: 'Normal', px: 14 },
  { value: 'large', label: 'Large', px: 15 },
]

/** localStorage 키: 고른 값 / index.html 인라인 스크립트가 읽는 계산 결과 (CSS·React 전에 색을 정하려고 미리 계산해 둔다) */
export const APPEARANCE_KEY = 'pray.appearance'
export const APPEARANCE_BOOT_KEY = 'pray.appearanceBoot'

const HEX_PATTERN = /^#[0-9a-f]{6}$/

/** '#RGB'·'#RRGGBB'·앞뒤 공백·대문자를 '#rrggbb' 로. 아니면 null */
export function normalizeHex(value: string): string | null {
  const text = value.trim().toLowerCase()
  const withHash = text.startsWith('#') ? text : `#${text}`
  if (HEX_PATTERN.test(withHash)) return withHash
  if (/^#[0-9a-f]{3}$/.test(withHash)) return `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`
  return null
}

/** 저장된 글(JSON) → 설정. 읽지 못하거나 모르는 값은 그 항목만 기본값 */
export function parseAppearance(raw: string | null): Appearance {
  let value: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object') value = parsed as Record<string, unknown>
  } catch {
    // 깨진 값이면 기본값
  }
  const palette = typeof value.palette === 'string' && PALETTES.some((p) => p.id === value.palette) ? value.palette : DEFAULT_APPEARANCE.palette
  let accent = DEFAULT_APPEARANCE.accent
  if (typeof value.accent === 'string') {
    if (value.accent === 'palette' || ACCENT_PRESETS.some((preset) => preset.id === value.accent)) accent = value.accent
    else if (HEX_PATTERN.test(value.accent)) accent = value.accent
  }
  const fontSize = FONT_SIZE_OPTIONS.some((option) => option.value === value.fontSize) ? (value.fontSize as FontSize) : DEFAULT_APPEARANCE.fontSize
  return { palette, accent, fontSize, chat: parseChatStyle(value.chat) }
}

function parseChatStyle(raw: unknown): ChatStyle {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const chat: Record<string, unknown> = { ...DEFAULT_CHAT_STYLE }
  for (const key of CHAT_CHOICE_KEYS) {
    if (CHAT_OPTIONS[key].options.some((option) => option.value === value[key])) chat[key] = value[key]
  }
  const rawColors = value.colors && typeof value.colors === 'object' ? (value.colors as Record<string, unknown>) : {}
  const colors = { ...DEFAULT_CHAT_STYLE.colors }
  for (const { key } of CHAT_COLOR_OPTIONS) {
    const color = rawColors[key]
    if (typeof color === 'string' && HEX_PATTERN.test(color)) colors[key] = color
  }
  return { ...(chat as unknown as ChatStyle), colors }
}

/** <html data-chat-…> 에 걸 것 (기본값이 아닌 것만. 속성이 없으면 style.css 는 기본 모양이다) */
export function chatAttributes(chat: ChatStyle): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const key of CHAT_CHOICE_KEYS) {
    const { attribute, options } = CHAT_OPTIONS[key]
    if (chat[key] !== options[0].value) attributes[attribute] = chat[key]
  }
  return attributes
}

/** 대화 글자 색 변수 (고른 것만. 두 모드에 같은 값) */
export function chatColorVars(colors: ChatColors): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const { key, variable } of CHAT_COLOR_OPTIONS) {
    const color = colors[key]
    if (color) vars[variable] = color
  }
  return vars
}

/** 대화 글자 색이 바탕 대비 3 아래인 모드 (설정 창 경고). 제목·숫자·경로는 답 카드(패널)·Plain 답(바탕), 인라인 코드는 코드 바탕 기준 */
export function chatColorWarnings(colors: ChatColors, paletteId: string, chat: ChatStyle = DEFAULT_CHAT_STYLE): { key: keyof ChatColors; mode: Mode; ratio: number }[] {
  const warnings: { key: keyof ChatColors; mode: Mode; ratio: number }[] = []
  for (const { key, surfaces, switchKey } of CHAT_COLOR_OPTIONS) {
    const color = colors[key]
    // 끈 줄은 그 색이 안 쓰이므로 경고하지 않는다
    if (!color || chat[switchKey] === 'off') continue
    for (const mode of ['light', 'dark'] as const) {
      const vars = paletteVars(paletteId, mode)
      const ratio = Math.min(...surfaces.map((surface) => contrast(color, vars[surface])))
      if (ratio < 3) warnings.push({ key, mode, ratio })
    }
  }
  return warnings
}

/**
 * 작업 묶음이 펼쳐졌는지. toggle = 사용자가(또는 검색·점프가) 정한 값 — 있으면 그대로다 (Expanded 에서 직접 접은 것은 접힌 채, Collapsed 에서 펼친 것은 펼친 채).
 * 없으면 설정을 따르되 진행 중 묶음은 늘 접힌다 (진행 중에는 설명 글이 따로 말풍선으로 보인다)
 */
export function isWorkOpen(isInProgress: boolean, toggle: boolean | undefined, workBundles: ChatStyle['workBundles']): boolean {
  return toggle ?? (workBundles === 'expanded' && !isInProgress)
}

// ── 색 계산 ──────────────────────────────────────────────

type Rgb = [number, number, number]

function toRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG 상대 휘도 */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 명암비 (1 ~ 21) */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** sRGB 에서 섞기. weight = a 의 비율 (1 이면 a 그대로) */
export function mix(a: string, b: string, weight: number): string {
  const rgbA = toRgb(a)
  const rgbB = toRgb(b)
  return toHex([0, 1, 2].map((i) => rgbA[i] * weight + rgbB[i] * (1 - weight)) as Rgb)
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map((channel) => channel / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lightness = (max + min) / 2
  if (max === min) return [0, 0, lightness]
  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue = max === r ? (g - b) / delta + (g < b ? 6 : 0) : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return [hue / 6, saturation, lightness]
}

function fromHsl([hue, saturation, lightness]: [number, number, number]): string {
  if (saturation === 0) return toHex([lightness * 255, lightness * 255, lightness * 255])
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (t: number) => {
    const x = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return toHex([channel(hue + 1 / 3) * 255, channel(hue) * 255, channel(hue - 1 / 3) * 255])
}

/** 바탕들 모두와 명암비가 min 이상이 될 때까지 색조·채도는 두고 밝기(HSL)만 1%씩 올리거나 내린다. 이미 넘으면 그대로 */
export function ensureContrast(color: string, backgrounds: string[], min: number, direction: 'lighter' | 'darker'): string {
  const [hue, saturation, lightness] = toHsl(color)
  for (let step = 0; step <= 100; step++) {
    const next = direction === 'lighter' ? Math.min(1, lightness + step / 100) : Math.max(0, lightness - step / 100)
    const candidate = step === 0 ? color : fromHsl([hue, saturation, next])
    if (backgrounds.every((background) => contrast(candidate, background) >= min)) return candidate
  }
  return direction === 'lighter' ? '#ffffff' : '#000000'
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── 강조색 ──────────────────────────────────────────────

/** 강조색에서 파생되는 변수 (style.css 의 --accent*·--on-accent) */
export const ACCENT_VAR_NAMES = ['accent', 'accent-hover', 'accent-active', 'accent-soft', 'accent-line', 'accent-dash', 'accent-text', 'on-accent'] as const

/**
 * 강조색 하나 → 파생 색. 지금 Default 초록의 값들과 같은 비율로 만든다:
 * - accent: 테두리·채운 버튼·작은 글자. 라이트는 패널 대비 3 이상(테두리·채움), 다크는 글자로도 쓰여 4.5 이상이 되게 밝힌다 (Default 초록 3.5 / 4.7 과 같은 기준)
 * - hover·active: 라이트는 검정 쪽으로 11%·22%, 다크는 hover 를 흰색 쪽 8%·active 를 검정 쪽 12%
 * - soft(선택 줄·내 말풍선 바탕)·line(내 말풍선 테두리)·dash(대기 점선): 패널과 섞는다. soft 는 그 위 보통 글자(surface.text)가 4.5 이상이 되게 덜 섞기도 한다
 * - accent-text: soft·패널 위 글자, 둘 다 4.5 이상
 * - on-accent: 채운 버튼 글자. 흰색이 3 이상이면 흰색(Default 초록 버튼과 같게), 아니면 ink(라이트는 글자색, 다크는 바탕색)·흰색 중 더 잘 보이는 것
 */
export function accentVars(base: string, mode: Mode, surface: { panel: string; text: string; ink: string }): Pick<Vars, (typeof ACCENT_VAR_NAMES)[number]> {
  const { panel, text: bodyText, ink } = surface
  const isDark = mode === 'dark'
  const accent = isDark ? ensureContrast(base, [panel], 4.5, 'lighter') : ensureContrast(base, [panel], 3, 'darker')
  // soft 위에 보통 글자(선택 줄 이름·내 말풍선)가 놓이므로 그 대비가 4.5 아래면 강조색을 덜 섞는다 (글자가 흐린 팔레트)
  let softWeight = isDark ? 0.2 : 0.15
  while (softWeight > 0.04 && contrast(bodyText, mix(accent, panel, softWeight)) < 4.5) softWeight -= 0.02
  const soft = mix(accent, panel, softWeight)
  const textStart = isDark ? mix(accent, '#ffffff', 0.65) : mix(accent, '#000000', 0.78)
  const text = ensureContrast(textStart, [panel, soft], 4.5, isDark ? 'lighter' : 'darker')
  const onAccent = contrast('#ffffff', accent) >= 3 || contrast('#ffffff', accent) >= contrast(ink, accent) ? '#ffffff' : ink
  return {
    accent,
    'accent-hover': isDark ? mix(accent, '#ffffff', 0.92) : mix(accent, '#000000', 0.89),
    'accent-active': mix(accent, '#000000', isDark ? 0.88 : 0.78),
    'accent-soft': soft,
    'accent-line': mix(accent, panel, isDark ? 0.35 : 0.25),
    'accent-dash': mix(accent, panel, isDark ? 0.6 : 0.5),
    'accent-text': text,
    'on-accent': onAccent,
  }
}

// ── 팔레트 ──────────────────────────────────────────────

/**
 * 팔레트의 핵심 색(PaletteCore) → 변수 전부. 핵심 색은 palettes.ts 에 그대로 쓰고, 나머지는 여기 비율로 만든다
 * (옅은 바탕은 패널과 섞고, 반투명은 글자색). --floor 는 사무실 캔버스 바닥이라 넣지 않는다 (Default 값 그대로)
 */
export function expandPalette(core: PaletteCore, mode: Mode): Vars {
  const isDark = mode === 'dark'
  const { bg, panel, text } = core
  // 채운 빨강 버튼(흰 글자). 다크의 밝은 빨강은 그대로 채우면 흰 글자가 안 보여 어둡게 한다 (Default 도 다크에서 라이트 빨강을 쓴다)
  const redFill = ensureContrast(core.red, ['#ffffff'], 3.5, 'darker')
  const preBg = isDark ? mix(bg, panel, 0.6) : mix(text, panel, 0.035)
  const relayBg = mix(core.relay, panel, isDark ? 0.15 : 0.1)
  const searchCurrentBg = core.highlight
  // 검색 현재 결과 글자: 팔레트 글자·바탕 중 잘 보이는 것, 둘 다 4.5 아래면(중간 밝기 노랑) 검정·흰색 중 잘 보이는 것
  const byContrast = (colors: string[]) => colors.reduce((best, color) => (contrast(color, searchCurrentBg) > contrast(best, searchCurrentBg) ? color : best))
  const paletteInk = byContrast([text, bg])
  const searchCurrentText = contrast(paletteInk, searchCurrentBg) >= 4.5 ? paletteInk : byContrast(['#000000', '#ffffff'])
  return {
    ...DEFAULT_VARS[mode],
    bg,
    panel,
    line: core.line,
    'line-strong': core.lineStrong,
    text,
    muted: core.muted,
    ...accentVars(core.accent, mode, { panel, text, ink: isDark ? bg : text }),
    success: core.success,
    'success-text': core.successText,
    'on-red': '#ffffff',
    red: core.red,
    'red-fill': redFill,
    'red-dot': core.red,
    'red-soft': mix(core.red, panel, isDark ? 0.16 : 0.14),
    'red-line': mix(core.red, panel, 0.3),
    'red-border': mix(core.red, panel, 0.4),
    error: core.red,
    yellow: core.yellow,
    highlight: core.highlight,
    'search-match-bg': mix(core.highlight, panel, isDark ? 0.35 : 0.4),
    'search-current-bg': searchCurrentBg,
    'search-current-text': searchCurrentText,
    'blue-dot': core.blue,
    link: core.link,
    'relay-bg': relayBg,
    'relay-line': mix(core.relay, panel, isDark ? 0.35 : 0.25),
    'relay-text': ensureContrast(core.relay, [relayBg, panel], 4.5, isDark ? 'lighter' : 'darker'),
    'chip-bg': mix(text, panel, isDark ? 0.1 : 0.07),
    'code-bg': mix(text, panel, isDark ? 0.08 : 0.06),
    'pre-bg': preBg,
    'avatar-bg': mix(text, panel, isDark ? 0.11 : 0.16),
    overlay: isDark ? 'rgba(0, 0, 0, 0.55)' : rgba(text, 0.35),
    'scrollbar-thumb': rgba(text, isDark ? 0.2 : 0.22),
    'scrollbar-thumb-hover': rgba(text, isDark ? 0.36 : 0.4),
    'md-heading': core.markdown.heading,
    'md-code': core.markdown.code,
    'md-number': core.markdown.number,
    'md-path': core.markdown.path,
    'hl-text': text,
    'hl-keyword': core.syntax.keyword,
    'hl-entity': core.syntax.entity,
    'hl-constant': core.syntax.constant,
    'hl-string': core.syntax.string,
    'hl-variable': core.syntax.variable,
    'hl-comment': core.syntax.comment,
    'hl-tag': core.syntax.tag,
    'hl-section': core.syntax.section,
    'hl-bullet': core.syntax.bullet,
    'hl-addition': core.syntax.addition,
    'hl-addition-bg': mix(core.syntax.addition, preBg, isDark ? 0.22 : 0.14),
    'hl-deletion': core.syntax.deletion,
    'hl-deletion-bg': mix(core.syntax.deletion, preBg, isDark ? 0.22 : 0.14),
    'diff-hunk-bg': mix(core.link, panel, isDark ? 0.16 : 0.1),
    // 노랑은 글자로 쓰기엔 옅어 바탕 대비 4.5 까지 어둡게(다크는 밝게) 한다
    'vcs-modified': ensureContrast(core.yellow, [panel, bg], 4.5, isDark ? 'lighter' : 'darker'),
    'caution-text': ensureContrast(core.yellow, [panel, bg], 4.5, isDark ? 'lighter' : 'darker'),
  }
}

/** 강조색 파생의 기준 색 (팔레트의 패널·글자, 채운 버튼의 어두운 글자) */
export function accentSurface(vars: Vars, mode: Mode): { panel: string; text: string; ink: string } {
  return { panel: vars.panel, text: vars.text, ink: mode === 'dark' ? vars.bg : vars.text }
}

/** 이 팔레트·모드에서 화면에 보이는 변수 전부 (Default 는 style.css 값 그대로) */
export function paletteVars(paletteId: string, mode: Mode): Vars {
  const palette = PALETTES.find((p) => p.id === paletteId)
  const core = palette?.[mode]
  return core ? expandPalette(core, mode) : DEFAULT_VARS[mode]
}

/** 강조색 선택의 바탕 색 (파생 전). 'palette' 면 팔레트 자체 강조색 */
export function accentBase(accent: string, paletteId: string, mode: Mode): string {
  const preset = ACCENT_PRESETS.find((p) => p.id === accent)
  if (preset) return preset[mode]
  if (HEX_PATTERN.test(accent)) return accent
  return paletteVars(paletteId, mode).accent
}

/**
 * 설정·모드 → <html> 에 인라인으로 덮을 변수 (style.css 기본값과 다른 것만이 아니라, 팔레트가 정하는 것 전부).
 * Default 팔레트 + 팔레트 강조색이면 빈 객체 — style.css 값 그대로다
 */
export function overrideVars(appearance: Appearance, mode: Mode): Partial<Vars> {
  const isDefaultPalette = !PALETTES.some((p) => p.id === appearance.palette && p[mode])
  const isPaletteAccent = appearance.accent === 'palette'
  if (isDefaultPalette && isPaletteAccent) return {}
  const vars = paletteVars(appearance.palette, mode)
  const derived = isPaletteAccent ? {} : accentVars(accentBase(appearance.accent, appearance.palette, mode), mode, accentSurface(vars, mode))
  if (isDefaultPalette) return derived
  const { floor: _floor, ...paletteOwn } = vars
  return { ...paletteOwn, ...derived }
}

/** <html> 에 걸 것 전부. theme.ts 와 index.html 인라인 스크립트가 같은 결과를 내야 한다 (appearance.test.ts 가 맞춰 본다) */
export interface DocumentState {
  theme: Mode
  palette: string
  fontSize: FontSize
  /** data-chat-<이름> → 값 (기본값이 아닌 것만) */
  chat: Record<string, string>
  /** 인라인으로 덮을 변수 (팔레트·강조색·대화 글자 색) */
  vars: Record<string, string>
}

export function documentState(appearance: Appearance, mode: Mode): DocumentState {
  return {
    theme: mode,
    palette: appearance.palette,
    fontSize: appearance.fontSize,
    chat: chatAttributes(appearance.chat),
    vars: { ...overrideVars(appearance, mode), ...chatColorVars(appearance.chat.colors) },
  }
}

/** index.html 인라인 스크립트가 읽는 값: 두 모드의 결과를 미리 계산해 둔다 (시스템 모드는 그때 OS 에 맞는 쪽을 고른다) */
export interface AppearanceBoot {
  palette: string
  fontSize: FontSize
  chat: Record<string, string>
  light: Record<string, string>
  dark: Record<string, string>
}

export function appearanceBoot(appearance: Appearance): AppearanceBoot {
  const light = documentState(appearance, 'light')
  return { palette: appearance.palette, fontSize: appearance.fontSize, chat: light.chat, light: light.vars, dark: documentState(appearance, 'dark').vars }
}

/** 인라인으로 덮을 수 있는 변수 이름 전부 (바꿀 때 지난 값을 지우려고) */
export const ALL_VAR_NAMES: string[] = [...Object.keys(DEFAULT_VARS.light), ...CHAT_COLOR_OPTIONS.map((option) => option.variable)]

/** data-chat-<이름> 전부 (기본값으로 돌아간 것을 지우려고) */
export const CHAT_ATTRIBUTE_NAMES = CHAT_CHOICE_KEYS.map((key) => CHAT_OPTIONS[key].attribute)
