/**
 * 화면 팔레트 값. 변수 이름은 style.css 맨 위 `:root` 의 이름에서 `--` 를 뗀 것이다.
 * DEFAULT_VARS 는 style.css 의 값을 그대로 옮긴 것이다 (appearance.test.ts 가 같은지 본다 — style.css 를 고치면 여기도 고친다).
 * 다른 팔레트는 핵심 색(PaletteCore)만 적고 나머지는 appearance.ts 의 expandPalette 가 만든다.
 * 상태 색(빨강·노랑·파랑·초록)·글자·링크는 --bg·--panel 대비 4.5 이상이어야 한다 (appearance.test.ts). 원래 테마 색이 못 미치면 같은 색조로 밝히거나 어둡게 바꿔 적었다
 */

const DEFAULT_LIGHT = {
  bg: '#f7f7fa',
  panel: '#ffffff',
  line: '#e2e3ea',
  'line-strong': '#c9ccd6',
  text: '#2b2f3a',
  muted: '#7a7f8e',
  accent: '#3f9c4b',
  'accent-hover': '#388c43',
  'accent-active': '#317a3a',
  'accent-soft': '#e3f3e5',
  'accent-line': '#cfe7d2',
  'accent-dash': '#9fcca6',
  'accent-text': '#2f7a39',
  'on-accent': '#ffffff',
  success: '#3f9c4b',
  'success-text': '#2f7a39',
  'on-red': '#ffffff',
  red: '#c84a3f',
  'red-fill': '#c84a3f',
  'red-dot': '#d6453d',
  'red-soft': '#fde3e0',
  'red-line': '#f5c4bf',
  'red-border': '#e8b4ae',
  error: '#b23b3b',
  yellow: '#e0a63a',
  highlight: '#e8b53a',
  'search-match-bg': '#fff0a8',
  'search-current-bg': '#ffc800',
  'search-current-text': '#2b2f3a',
  'blue-dot': '#3b82d6',
  link: '#2f6fd0',
  'relay-bg': '#eef1fb',
  'relay-line': '#d3daf2',
  'relay-text': '#5a68a6',
  'chip-bg': '#eceef3',
  'code-bg': '#f1f2f6',
  'pre-bg': '#f6f8fa',
  'avatar-bg': '#dcdde6',
  overlay: 'rgba(43, 47, 58, 0.35)',
  'scrollbar-thumb': 'rgba(43, 47, 58, 0.22)',
  'scrollbar-thumb-hover': 'rgba(43, 47, 58, 0.4)',
  floor: '#dcdde6',
  'md-heading': '#6f42c1',
  'md-code': '#b0306a',
  'md-number': '#af5109',
  'md-path': '#0f766e',
  'hl-text': '#24292e',
  'hl-keyword': '#d73a49',
  'hl-entity': '#6f42c1',
  'hl-constant': '#005cc5',
  'hl-string': '#032f62',
  'hl-variable': '#e36209',
  'hl-comment': '#6a737d',
  'hl-tag': '#22863a',
  'hl-section': '#005cc5',
  'hl-bullet': '#735c0f',
  'hl-addition': '#22863a',
  'hl-addition-bg': '#f0fff4',
  'hl-deletion': '#b31d28',
  'hl-deletion-bg': '#ffeef0',
  'diff-hunk-bg': '#e8f0fb',
  'vcs-modified': '#9a6700',
  'caution-text': '#9a6700',
  'surface-1': '#f3f4f7',
  'surface-2': '#eceef3',
  'surface-3': '#e2e4eb',
  'pop-bg': '#ffffff',
  'shadow-pop': '0 1px 3px rgba(43, 47, 58, 0.06), 0 6px 20px rgba(43, 47, 58, 0.1)',
  'shadow-modal': '0 2px 8px rgba(43, 47, 58, 0.08), 0 18px 48px rgba(43, 47, 58, 0.18)',
}

export type VarName = keyof typeof DEFAULT_LIGHT
export type Vars = Record<VarName, string>

export const DEFAULT_VARS: Record<'light' | 'dark', Vars> = {
  light: DEFAULT_LIGHT,
  dark: {
    ...DEFAULT_LIGHT,
    bg: '#16181d',
    panel: '#1f2228',
    line: '#343844',
    'line-strong': '#565c69',
    text: '#e3e5ea',
    muted: '#9aa0ad',
    'accent-hover': '#47a854',
    'accent-active': '#368a41',
    'accent-soft': '#1d3322',
    'accent-line': '#2c5233',
    'accent-dash': '#3f7a4a',
    'accent-text': '#7cc987',
    'success-text': '#7cc987',
    red: '#ef7b72',
    'red-dot': '#ee6b61',
    'red-soft': '#3b2224',
    'red-line': '#6a3532',
    'red-border': '#7a3f3a',
    error: '#ef7b72',
    yellow: '#e3b341',
    'blue-dot': '#4c93e6',
    'search-match-bg': '#5a4a10',
    'search-current-bg': '#b88a00',
    'search-current-text': '#ffffff',
    link: '#6ea8ff',
    'relay-bg': '#222a40',
    'relay-line': '#38446b',
    'relay-text': '#9fb0f0',
    'chip-bg': '#2c3039',
    'code-bg': '#2a2e37',
    'pre-bg': '#191c22',
    'avatar-bg': '#343844',
    overlay: 'rgba(0, 0, 0, 0.55)',
    'scrollbar-thumb': 'rgba(227, 229, 234, 0.2)',
    'scrollbar-thumb-hover': 'rgba(227, 229, 234, 0.36)',
    'md-heading': '#d2a8ff',
    'md-code': '#ff9bb8',
    'md-number': '#ffa657',
    'md-path': '#5ad1c2',
    'hl-text': '#c9d1d9',
    'hl-keyword': '#ff7b72',
    'hl-entity': '#d2a8ff',
    'hl-constant': '#79c0ff',
    'hl-string': '#a5d6ff',
    'hl-variable': '#ffa657',
    'hl-comment': '#8b949e',
    'hl-tag': '#7ee787',
    'hl-section': '#1f6feb',
    'hl-bullet': '#f2cc60',
    'hl-addition': '#aff5b4',
    'hl-addition-bg': '#033a16',
    'hl-deletion': '#ffdcd7',
    'hl-deletion-bg': '#67060c',
    'diff-hunk-bg': '#243049',
    'vcs-modified': '#d29922',
    'caution-text': '#d29922',
    'surface-1': '#262a31',
    'surface-2': '#2c3039',
    'surface-3': '#373c46',
    'pop-bg': '#262a31',
    'shadow-pop': '0 1px 3px rgba(0, 0, 0, 0.3), 0 6px 20px rgba(0, 0, 0, 0.35)',
    'shadow-modal': '0 2px 8px rgba(0, 0, 0, 0.35), 0 18px 48px rgba(0, 0, 0, 0.5)',
  },
}

/** 코드 강조 토큰 색 (highlight.js 클래스 묶음 — style.css 의 .hljs-* 규칙) */
export interface SyntaxColors {
  /** keyword·type·template */
  keyword: string
  /** 함수·클래스 이름 (title) */
  entity: string
  /** 숫자·literal·attr·selector */
  constant: string
  string: string
  /** built_in·symbol */
  variable: string
  comment: string
  /** 태그 이름·quote·selector-tag */
  tag: string
  /** 마크다운 제목 */
  section: string
  /** 목록 기호 */
  bullet: string
  addition: string
  deletion: string
}

/** 팔레트 한 벌(라이트 또는 다크)의 핵심 색 */
export interface PaletteCore {
  /** 화면 바탕 / 목록·패널·모달 바탕 */
  bg: string
  panel: string
  line: string
  lineStrong: string
  text: string
  muted: string
  /** 팔레트 자체 강조색 (Accent 가 Palette 일 때). 파생 색은 appearance.ts 의 accentVars */
  accent: string
  /** 상태 초록 (끝남·연결됨·복사됨) / 그 글자 */
  success: string
  successText: string
  /** 상태 빨강 (승인 대기·오류) */
  red: string
  /** 상태 노랑 (내 차례·경고) */
  yellow: string
  /** 상태 파랑 (작업 중) */
  blue: string
  link: string
  /** 팀장·파트장 지시 말풍선 색조 */
  relay: string
  /** 점프한 줄·검색 현재 결과 */
  highlight: string
  syntax: SyntaxColors
  /** 대화 마크다운 기본 글자 색 (제목·인라인 코드·숫자·파일 경로). --bg·--panel·지시 말풍선·코드 바탕 위에서 대비 4.5 이상 */
  markdown: MarkdownColors
}

/** 대화 마크다운 기본 글자 색. 설정 창 Chat 탭 Colors 에서 고른 값이 이긴다 */
export interface MarkdownColors {
  heading: string
  code: string
  number: string
  path: string
}

export interface Palette {
  id: string
  label: string
  /** null = Default 값 (style.css) */
  light: PaletteCore | null
  dark: PaletteCore | null
}

const GITHUB_LIGHT_SYNTAX: SyntaxColors = {
  keyword: '#cf222e',
  entity: '#8250df',
  constant: '#0550ae',
  string: '#0a3069',
  variable: '#953800',
  comment: '#59636e',
  tag: '#116329',
  section: '#0550ae',
  bullet: '#3b2300',
  addition: '#116329',
  deletion: '#82071e',
}

const GITHUB_DARK_SYNTAX: SyntaxColors = {
  keyword: '#ff7b72',
  entity: '#d2a8ff',
  constant: '#79c0ff',
  string: '#a5d6ff',
  variable: '#ffa657',
  comment: '#8b949e',
  tag: '#7ee787',
  section: '#79c0ff',
  bullet: '#f2cc60',
  addition: '#aff5b4',
  deletion: '#ffdcd7',
}

export const PALETTES: Palette[] = [
  { id: 'default', label: 'Default', light: null, dark: null },
  {
    id: 'github',
    label: 'GitHub',
    light: {
      bg: '#f6f8fa',
      panel: '#ffffff',
      line: '#d1d9e0',
      lineStrong: '#afb8c1',
      text: '#1f2328',
      muted: '#59636e',
      accent: '#1f883d',
      success: '#1a7f37',
      successText: '#1a7f37',
      red: '#cf222e',
      yellow: '#9a6700',
      blue: '#0969da',
      link: '#0969da',
      relay: '#8250df',
      highlight: '#d4a72c',
      markdown: { heading: '#7f4cde', code: '#cf222e', number: '#953800', path: '#116329' },
      syntax: GITHUB_LIGHT_SYNTAX,
    },
    dark: {
      bg: '#0d1117',
      panel: '#161b22',
      line: '#30363d',
      lineStrong: '#484f58',
      text: '#e6edf3',
      muted: '#8d96a0',
      accent: '#2ea043',
      success: '#3fb950',
      successText: '#3fb950',
      red: '#f85149',
      yellow: '#d29922',
      blue: '#58a6ff',
      link: '#4493f8',
      relay: '#ab7df8',
      highlight: '#d29922',
      markdown: { heading: '#d2a8ff', code: '#ff7b72', number: '#ffa657', path: '#7ee787' },
      syntax: GITHUB_DARK_SYNTAX,
    },
  },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    // Latte
    light: {
      bg: '#e6e9ef',
      panel: '#eff1f5',
      line: '#ccd0da',
      lineStrong: '#acb0be',
      text: '#4c4f69',
      muted: '#65687d',
      accent: '#8839ef',
      success: '#307820',
      successText: '#307820',
      red: '#cd0f38',
      yellow: '#925d13',
      blue: '#0b59f4',
      link: '#0b59f4',
      relay: '#7287fd',
      highlight: '#df8e1d',
      markdown: { heading: '#8230ee', code: '#c91b2a', number: '#b24101', path: '#127076' },
      syntax: {
        keyword: '#8839ef',
        entity: '#1e66f5',
        constant: '#fe640b',
        string: '#40a02b',
        variable: '#d20f39',
        comment: '#7c7f93',
        tag: '#7287fd',
        section: '#1e66f5',
        bullet: '#179299',
        addition: '#40a02b',
        deletion: '#d20f39',
      },
    },
    // Mocha
    dark: {
      bg: '#181825',
      panel: '#1e1e2e',
      line: '#313244',
      lineStrong: '#585b70',
      text: '#cdd6f4',
      muted: '#a6adc8',
      accent: '#cba6f7',
      success: '#a6e3a1',
      successText: '#a6e3a1',
      red: '#f38ba8',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      link: '#89b4fa',
      relay: '#b4befe',
      highlight: '#f9e2af',
      markdown: { heading: '#cba6f7', code: '#eba0ac', number: '#fab387', path: '#94e2d5' },
      syntax: {
        keyword: '#cba6f7',
        entity: '#89b4fa',
        constant: '#fab387',
        string: '#a6e3a1',
        variable: '#f38ba8',
        comment: '#9399b2',
        tag: '#b4befe',
        section: '#89b4fa',
        bullet: '#94e2d5',
        addition: '#a6e3a1',
        deletion: '#f38ba8',
      },
    },
  },
  {
    id: 'solarized',
    label: 'Solarized',
    light: {
      bg: '#eee8d5',
      panel: '#fdf6e3',
      line: '#e4ddc8',
      lineStrong: '#c9c2ac',
      text: '#073642',
      muted: '#566b72',
      accent: '#268bd2',
      success: '#5d6b00',
      successText: '#5d6b00',
      red: '#ca2522',
      yellow: '#826200',
      blue: '#1d6ca2',
      link: '#1d6ca2',
      relay: '#6c71c4',
      highlight: '#b58900',
      markdown: { heading: '#826200', code: '#bc2970', number: '#af4113', path: '#1d706a' },
      syntax: {
        keyword: '#859900',
        entity: '#268bd2',
        constant: '#2aa198',
        string: '#2aa198',
        variable: '#cb4b16',
        comment: '#93a1a1',
        tag: '#268bd2',
        section: '#268bd2',
        bullet: '#b58900',
        addition: '#859900',
        deletion: '#dc322f',
      },
    },
    dark: {
      bg: '#002b36',
      panel: '#073642',
      line: '#0e4452',
      lineStrong: '#2c5966',
      text: '#93a1a1',
      muted: '#8b9b9d',
      accent: '#268bd2',
      success: '#8ea300',
      successText: '#8ea300',
      red: '#e87775',
      yellow: '#c49500',
      blue: '#48a0de',
      link: '#48a0de',
      relay: '#6c71c4',
      highlight: '#b58900',
      markdown: { heading: '#d4a000', code: '#e68eb9', number: '#ef8f68', path: '#30b9af' },
      syntax: {
        keyword: '#859900',
        entity: '#268bd2',
        constant: '#2aa198',
        string: '#2aa198',
        variable: '#cb4b16',
        comment: '#586e75',
        tag: '#268bd2',
        section: '#268bd2',
        bullet: '#b58900',
        addition: '#859900',
        deletion: '#dc322f',
      },
    },
  },
  {
    id: 'gruvbox',
    label: 'Gruvbox',
    light: {
      bg: '#f2e5bc',
      panel: '#fbf1c7',
      line: '#ebdbb2',
      lineStrong: '#d5c4a1',
      text: '#3c3836',
      muted: '#6e6259',
      accent: '#af3a03',
      success: '#6b670c',
      successText: '#6b670c',
      red: '#9d0006',
      yellow: '#8c5b0f',
      blue: '#076678',
      link: '#076678',
      relay: '#8f3f71',
      highlight: '#b57614',
      markdown: { heading: '#87580f', code: '#af3a03', number: '#8f3f71', path: '#396a4c' },
      syntax: {
        keyword: '#9d0006',
        entity: '#79740e',
        constant: '#8f3f71',
        string: '#79740e',
        variable: '#af3a03',
        comment: '#928374',
        tag: '#076678',
        section: '#79740e',
        bullet: '#b57614',
        addition: '#79740e',
        deletion: '#9d0006',
      },
    },
    dark: {
      bg: '#1d2021',
      panel: '#282828',
      line: '#3c3836',
      lineStrong: '#665c54',
      text: '#ebdbb2',
      muted: '#a89984',
      accent: '#fe8019',
      success: '#b8bb26',
      successText: '#b8bb26',
      red: '#fb5643',
      yellow: '#fabd2f',
      blue: '#83a598',
      link: '#83a598',
      relay: '#d3869b',
      highlight: '#fabd2f',
      markdown: { heading: '#fabd2f', code: '#fe831e', number: '#d791a4', path: '#8ec07c' },
      syntax: {
        keyword: '#fb4934',
        entity: '#b8bb26',
        constant: '#d3869b',
        string: '#b8bb26',
        variable: '#fe8019',
        comment: '#928374',
        tag: '#83a598',
        section: '#b8bb26',
        bullet: '#fabd2f',
        addition: '#b8bb26',
        deletion: '#fb4934',
      },
    },
  },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    // Dawn
    light: {
      bg: '#f2e9e1',
      panel: '#fffaf3',
      line: '#dfdad9',
      lineStrong: '#cecacd',
      text: '#575279',
      muted: '#6a6683',
      accent: '#d7827e',
      success: '#286983',
      successText: '#286983',
      red: '#a44f67',
      yellow: '#945c0f',
      blue: '#765e92',
      link: '#286983',
      relay: '#907aa9',
      highlight: '#ea9d34',
      markdown: { heading: '#765e92', code: '#b63e39', number: '#945c0f', path: '#416f77' },
      syntax: {
        keyword: '#286983',
        entity: '#d7827e',
        constant: '#ea9d34',
        string: '#ea9d34',
        variable: '#b4637a',
        comment: '#9893a5',
        tag: '#56949f',
        section: '#907aa9',
        bullet: '#56949f',
        addition: '#286983',
        deletion: '#b4637a',
      },
    },
    // Main
    dark: {
      bg: '#191724',
      panel: '#1f1d2e',
      line: '#26233a',
      lineStrong: '#524f67',
      text: '#e0def4',
      muted: '#908caa',
      accent: '#ebbcba',
      success: '#9ccfd8',
      successText: '#9ccfd8',
      red: '#eb6f92',
      yellow: '#f6c177',
      blue: '#c4a7e7',
      link: '#9ccfd8',
      relay: '#c4a7e7',
      highlight: '#f6c177',
      markdown: { heading: '#c4a7e7', code: '#ebbcba', number: '#f6c177', path: '#9ccfd8' },
      syntax: {
        keyword: '#31748f',
        entity: '#ebbcba',
        constant: '#f6c177',
        string: '#f6c177',
        variable: '#eb6f92',
        comment: '#6e6a86',
        tag: '#9ccfd8',
        section: '#c4a7e7',
        bullet: '#9ccfd8',
        addition: '#9ccfd8',
        deletion: '#eb6f92',
      },
    },
  },
  {
    id: 'nord',
    label: 'Nord',
    // Nord 는 원래 다크 테마다. 라이트는 Snow Storm(nord4~6)을 바탕, Polar Night(nord0~3)을 글자로 쓰고 Frost·Aurora 를 밝은 바탕에서 읽히게 어둡게 했다
    light: {
      bg: '#e5e9f0',
      panel: '#eceff4',
      line: '#d8dee9',
      lineStrong: '#b8c2d3',
      text: '#2e3440',
      muted: '#4c566a',
      accent: '#5e81ac',
      success: '#546e3e',
      successText: '#546e3e',
      red: '#ac4650',
      yellow: '#846017',
      blue: '#4b6a91',
      link: '#4b6a91',
      relay: '#b48ead',
      highlight: '#d08770',
      markdown: { heading: '#47668a', code: '#9c4d33', number: '#815679', path: '#526b3c' },
      syntax: {
        keyword: '#5e81ac',
        entity: '#88c0d0',
        constant: '#b48ead',
        string: '#a3be8c',
        variable: '#d08770',
        comment: '#616e88',
        tag: '#81a1c1',
        section: '#88c0d0',
        bullet: '#ebcb8b',
        addition: '#a3be8c',
        deletion: '#bf616a',
      },
    },
    dark: {
      bg: '#242933',
      panel: '#2e3440',
      line: '#3b4252',
      lineStrong: '#4c566a',
      text: '#eceff4',
      muted: '#9aa5b8',
      accent: '#88c0d0',
      success: '#a3be8c',
      successText: '#a3be8c',
      red: '#cf8990',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      link: '#88c0d0',
      relay: '#b48ead',
      highlight: '#ebcb8b',
      markdown: { heading: '#88c0d0', code: '#dda796', number: '#c6aac1', path: '#a3be8c' },
      syntax: {
        keyword: '#81a1c1',
        entity: '#88c0d0',
        constant: '#b48ead',
        string: '#a3be8c',
        variable: '#8fbcbb',
        comment: '#616e88',
        tag: '#81a1c1',
        section: '#88c0d0',
        bullet: '#ebcb8b',
        addition: '#a3be8c',
        deletion: '#bf616a',
      },
    },
  },
]

/** 강조색 프리셋. 모드마다 바탕 색을 따로 두고, 파생 색은 appearance.ts 의 accentVars 가 지금 팔레트의 패널에 맞춰 만든다 */
export const ACCENT_PRESETS: { id: string; label: string; light: string; dark: string }[] = [
  { id: 'green', label: 'Green', light: '#3f9c4b', dark: '#3f9c4b' },
  { id: 'teal', label: 'Teal', light: '#13897b', dark: '#2bb3a3' },
  { id: 'blue', label: 'Blue', light: '#2f6fd0', dark: '#4c93e6' },
  { id: 'indigo', label: 'Indigo', light: '#5361d6', dark: '#8b95f0' },
  { id: 'purple', label: 'Purple', light: '#8a4fd0', dark: '#b48af0' },
  { id: 'pink', label: 'Pink', light: '#c2417f', dark: '#ec79b0' },
  { id: 'orange', label: 'Orange', light: '#c8611a', dark: '#f0924a' },
  { id: 'slate', label: 'Slate', light: '#5b6478', dark: '#9aa3b5' },
]
