// 맨 먼저: 아래 모듈들이 불러올 때 localStorage 를 읽기 전에 옛 키를 옮긴다
import './copyLegacyStorage'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { IsLocalPage } from './ChatLink'
import { DialogHost } from './Dialog'
import { Login } from './Login'
import './theme'
// 본문 글꼴 Pretendard (npm pretendard, OFL-1.1). 동적 서브셋이라 화면에 쓰인 글자 범위의 woff2 만 받는다 — Vite 가 파일을 번들해 외부 망 요청이 없다
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './fonts.css'
import './style.css'

interface Me {
  isAuthenticated: boolean
  isLocal: boolean
  canLogin: boolean
}

function Root() {
  const [me, setMe] = useState<Me | null>(null)
  const load = () =>
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then(setMe)
  useEffect(() => {
    void load()
  }, [])
  if (!me) return null
  if (!me.isAuthenticated) return <Login canLogin={me.canLogin} onLoggedIn={() => void load()} />
  return (
    <>
      <IsLocalPage.Provider value={me.isLocal}>
        <App isLocal={me.isLocal} />
      </IsLocalPage.Provider>
      <DialogHost />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
