import { useTranslation } from 'react-i18next'
import { CloudOff } from 'lucide-react'

import styles from './OfflineBanner.module.css'
import { useOnline } from './useOnline'

// Quiet and informative, never alarming: offline is the normal case for a
// farmer at an apiary (03 §4).
// `unreachable`: the sync runner could not reach the server although the
// browser reports a connection (a network with no internet, common in rural
// Kenya). navigator.onLine alone misses that case (browser walk).
export function OfflineBanner({
  message,
  unreachable = false,
}: {
  message?: string
  unreachable?: boolean
}) {
  const { t } = useTranslation()
  const online = useOnline()
  if (online && !unreachable) return null
  return (
    <p className={styles.banner} role="status">
      <CloudOff aria-hidden="true" size={18} strokeWidth={1.75} />
      <span>{message ?? t('ui.offline')}</span>
    </p>
  )
}
