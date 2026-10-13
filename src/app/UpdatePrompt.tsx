import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Toast } from '../ui/Toast'

type Register = (opts: { onNeedRefresh: () => void }) => (reload?: boolean) => unknown

// A waiting service worker takes over only when the person taps Reload, so a
// half-filled harvest form is never lost to an automatic reload (12 §9).
// `register` is injected (virtual:pwa-register in the app, a stub in tests).
export function UpdatePrompt({ register }: { register: Register }) {
  const { t } = useTranslation()
  const [waiting, setWaiting] = useState(false)
  const [update, setUpdate] = useState<((reload?: boolean) => unknown) | null>(null)

  useEffect(() => {
    const fn = register({ onNeedRefresh: () => setWaiting(true) })
    setUpdate(() => fn)
  }, [register])

  if (!waiting) return null
  return (
    <Toast
      action={
        <button type="button" onClick={() => update?.(true)}>
          {t('app.update.reload')}
        </button>
      }
    >
      {t('app.update.ready')}
    </Toast>
  )
}
