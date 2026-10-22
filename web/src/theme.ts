/**
 * 화면 테마. 고른 값(라이트·다크·시스템)은 이 브라우저의 localStorage 에 두고, 실제 색은 <html data-theme="light|dark"> 로 정한다 (style.css 의 변수).
 * 시스템이면 OS 설정(prefers-color-scheme)을 따르고 OS 가 바뀌면 바로 따라간다 (로그인 화면 포함 — 이 모듈은 main.tsx 가 불러온다).
 * index.html 의 인라인 스크립트가 React 전에 같은 규칙으로 한 번 정한다 (첫 화면이 밝게 번쩍이지 않게) — 규칙을 바꾸면 거기도 같이 바꾼다
 */
export type ThemeChoice = 'light' | 'dark' | 'system'

const THEME_KEY = 'jk-corp.theme'
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** 저장된 선택. 읽지 못하거나(저장소가 막힌 브라우저 등) 모르는 값이면 시스템 */
function readStoredChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** 저장에 실패해도 이 페이지에서는 고른 값을 쓰도록 메모리에도 둔다 */
let currentChoice = readStoredChoice()

function applyTheme() {
  const isDark = currentChoice === 'dark' || (currentChoice === 'system' && darkQuery.matches)
  const root = document.documentElement
  root.dataset.theme = isDark ? 'dark' : 'light'
  // CSS 를 읽기 전에도 스크롤바·폼·빈 화면 바탕이 테마를 따르게
  root.style.colorScheme = isDark ? 'dark' : 'light'
}

export function themeChoice(): ThemeChoice {
  return currentChoice
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

darkQuery.addEventListener('change', () => {
  if (currentChoice === 'system') applyTheme()
})
applyTheme()
