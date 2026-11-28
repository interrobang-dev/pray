import { useEffect, useState } from 'react'
import { readUpdateVersion, updateBandText } from './updateReady'

const readVersion = () => readUpdateVersion(document.documentElement.dataset.updateReady)

/**
 * 트레이 창(설치판)이 업데이트를 다 받았을 때 화면 위쪽 띠. 트레이가 `<html data-update-ready>` 를 걸고(페이지를 읽을 때마다 다시),
 * 트레이 창에서 F5·Ctrl+R 을 누르면 트레이가 설치 확인 창을 띄운다 (desktop/src/main.ts). 브라우저에는 속성이 없어 안 뜬다
 */
export function UpdateBand() {
  const [version, setVersion] = useState(readVersion)
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion(readVersion()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-update-ready'] })
    setVersion(readVersion())
    return () => observer.disconnect()
  }, [])
  if (!version) return null
  return (
    <div className="update-band" role="status" aria-live="polite">
      <span className="update-text">{updateBandText(version)}</span>
    </div>
  )
}
