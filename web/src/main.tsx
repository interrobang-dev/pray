// 맨 먼저: 아래 모듈들이 불러올 때 localStorage 를 읽기 전에 옛 키를 옮긴다
import './copyLegacyStorage'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { DialogHost } from './Dialog'
import { Login } from './Login'
import './theme'
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
      <App isLocal={me.isLocal} />
      <DialogHost />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
