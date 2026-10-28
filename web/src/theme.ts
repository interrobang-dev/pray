/**
 * 화면 테마·스타일 적용. 고른 값(모드 라이트·다크·시스템, 팔레트·강조색·글자 크기, 대화 모양)은 이 브라우저의 localStorage 에 두고,
 * <html> 에 data-theme="light|dark"·data-palette·data-font-size·data-chat-*(대화 모양, 기본값이 아닌 것만)와 팔레트·강조색·대화 글자 색 변수(인라인 style)로 건다 (계산은 appearance.ts).
 * 시스템이면 OS 설정(prefers-color-scheme)을 따르고 OS 가 바뀌면 바로 따라간다 (로그인 화면 포함 — 이 모듈은 main.tsx 가 불러온다).
 * index.html 의 인라인 스크립트가 React·CSS 전에 같은 결과를 한 번 건다 (첫 화면이 번쩍이지 않게). 그 스크립트는 여기서 미리 계산해 둔
 * APPEARANCE_BOOT_KEY 값을 그대로 걸기만 한다 — 거는 규칙을 바꾸면 거기도 같이 바꾼다 (appearance.test.ts 가 두 곳의 결과를 맞춰 본다)
 */
import {
  ALL_VAR_NAMES,
  APPEARANCE_BOOT_KEY,
  APPEARANCE_KEY,
  CHAT_ATTRIBUTE_NAMES,
  DEFAULT_APPEARANCE,
  THEME_KEY,
  appearanceBoot,
  documentState,
  parseAppearance,
  parseThemeChoice,
  resolveMode,
  type Appearance,
  type Mode,
  type ThemeChoice,
} from './appearance'

export type { ThemeChoice } from './appearance'

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** 저장된 선택. 읽지 못하거나(저장소가 막힌 브라우저 등) 모르는 값이면 시스템 */
function readStoredChoice(): ThemeChoice {
  try {
    return parseThemeChoice(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

function readStoredAppearance(): Appearance {
  try {
    return parseAppearance(localStorage.getItem(APPEARANCE_KEY))
  } catch {
    return DEFAULT_APPEARANCE
  }
}

/** 저장에 실패해도 이 페이지에서는 고른 값을 쓰도록 메모리에도 둔다 */
let currentChoice = readStoredChoice()
let currentAppearance = readStoredAppearance()
let currentMode: Mode = resolveMode(currentChoice, darkQuery.matches)

const listeners = new Set<() => void>()

function applyTheme() {
  currentMode = resolveMode(currentChoice, darkQuery.matches)
  const state = documentState(currentAppearance, currentMode)
  const root = document.documentElement
  root.dataset.theme = state.theme
  // CSS 를 읽기 전에도 스크롤바·폼·빈 화면 바탕이 테마를 따르게
  root.style.colorScheme = state.theme
  root.dataset.palette = state.palette
  root.dataset.fontSize = state.fontSize
  for (const name of CHAT_ATTRIBUTE_NAMES) {
    const value = state.chat[name]
    if (value) root.setAttribute(`data-chat-${name}`, value)
    else root.removeAttribute(`data-chat-${name}`)
  }
  for (const name of ALL_VAR_NAMES) {
    const value = state.vars[name]
    if (value) root.style.setProperty(`--${name}`, value)
    else root.style.removeProperty(`--${name}`)
  }
  for (const listener of listeners) listener()
}

/** index.html 인라인 스크립트가 읽을 계산 결과를 저장한다. 계산 규칙이 바뀌었을 수 있어 페이지를 열 때마다 다시 쓴다 */
function storeBoot() {
  try {
    localStorage.setItem(APPEARANCE_BOOT_KEY, JSON.stringify(appearanceBoot(currentAppearance)))
  } catch {
    // 저장하지 못하면 다음 첫 화면은 Default 로 시작했다가 이 모듈이 바꾼다
  }
}

/** 헤더 테마 버튼·설정 창이 같은 값을 보도록 (useSyncExternalStore) */
export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function themeChoice(): ThemeChoice {
  return currentChoice
}

/** 지금 화면에 걸린 모드 (시스템이면 OS 에 맞춘 쪽) */
export function themeMode(): Mode {
  return currentMode
}

export function setThemeChoice(choice: ThemeChoice) {
  currentChoice = choice
  try {
    localStorage.setItem(THEME_KEY, choice)
  } catch {
    // 저장하지 못하면 이 페이지에서만 바뀐다
  }
  applyTheme()
}

export function appearance(): Appearance {
  return currentAppearance
}

export function setAppearance(next: Appearance) {
  currentAppearance = next
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next))
  } catch {
    // 저장하지 못하면 이 페이지에서만 바뀐다
  }
  storeBoot()
  applyTheme()
}

darkQuery.addEventListener('change', () => {
  if (currentChoice === 'system') applyTheme()
})
storeBoot()
applyTheme()
