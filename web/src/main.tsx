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
      <App />
      <DialogHost />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
