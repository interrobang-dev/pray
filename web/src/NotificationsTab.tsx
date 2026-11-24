import { useEffect, useRef, useState } from 'react'
import { NOTIFICATION_ROWS, parseNotificationSettings, revertNotificationSetting, withNotificationSetting, type NotificationKey } from './notificationSettings'
import type { NotificationSettings } from './types'

async function errorText(response: Response): Promise<string> {
  const answer = (await response.json().catch(() => null)) as { message?: string } | null
  return answer?.message ?? `HTTP ${response.status}`
}

/**
 * 설정 창 Notifications 탭: 이 PC 트레이 앱의 Windows 알림 켜기·끄기 (`/api/notification-settings`).
 * 열 때 GET, 스위치를 누르면 그 키만 PUT — 화면을 먼저 바꾸고 실패하면 되돌린다. PUT 은 한 줄로 차례대로 보낸다 (응답 순서가 꼬이지 않게)
 */
export function NotificationsTab() {
  const [settings, setSettings] = useState<NotificationSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const pendingCount = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/notification-settings', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorText(response))
        const parsed = parseNotificationSettings(await response.json().catch(() => null))
        if (!parsed) throw new Error('Unexpected response')
        setSettings(parsed)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [])

  function change(key: NotificationKey, value: boolean) {
    if (!settings) return
    const previous = settings[key]
    setSaveError(null)
    setSettings((current) => (current ? withNotificationSetting(current, key, value) : current))
    pendingCount.current += 1
    queue.current = queue.current.then(async () => {
      try {
        const response = await fetch('/api/notification-settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { [key]: value } }),
        })
        if (!response.ok) throw new Error(await errorText(response))
        const parsed = parseNotificationSettings(await response.json().catch(() => null))
        // 더 기다리는 요청이 없을 때만 서버가 합친 값을 따른다 (낙관적으로 바꾼 다른 키를 덮지 않게)
        if (parsed && pendingCount.current === 1) setSettings(parsed)
      } catch (error) {
        setSettings((current) => (current ? revertNotificationSetting(current, key, value, previous) : current))
        setSaveError(`Couldn't save notification settings: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        pendingCount.current -= 1
      }
    })
  }

  if (loadError) {
    return (
      <div className="appearance-scroll">
        <p className="notifications-error" role="alert">
          Couldn't load notification settings: {loadError}
        </p>
      </div>
    )
  }
  if (!settings) {
    return (
      <div className="appearance-scroll">
        <p className="appearance-hint notifications-hint">Loading…</p>
      </div>
    )
  }

  const isAllOn = settings.enabled
  return (
    <div className="appearance-scroll">
      <p className="appearance-hint notifications-hint">Windows notifications from the Pray tray app on this PC.</p>
      <section className="appearance-section">
        <NotificationRow label="Notifications" description={null} isOn={settings.enabled} isDisabled={false} onToggle={(value) => change('enabled', value)} />
      </section>
      <section className={`appearance-section notifications-list${isAllOn ? '' : ' is-off'}`}>
        {NOTIFICATION_ROWS.map((row) => (
          <NotificationRow key={row.key} label={row.label} description={row.description} isOn={settings[row.key]} isDisabled={!isAllOn} onToggle={(value) => change(row.key, value)} />
        ))}
      </section>
      {saveError && (
        <p className="notifications-error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}

function NotificationRow({ label, description, isOn, isDisabled, onToggle }: { label: string; description: string | null; isOn: boolean; isDisabled: boolean; onToggle: (isOn: boolean) => void }) {
  return (
    <div className="notification-row">
      <button type="button" role="switch" aria-checked={isOn} aria-label={label} disabled={isDisabled} className="switch" onClick={() => onToggle(!isOn)} />
      <span className="appearance-label">{label}</span>
      {description && <span className="appearance-hint">{description}</span>}
    </div>
  )
}
