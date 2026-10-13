import { useTranslation } from 'react-i18next'
import { CloudOff } from 'lucide-react'

import styles from './OfflineBanner.module.css'
import { useOnline } from './useOnline'

// Quiet and informative, never alarming: offline is the normal case for a
// farmer at an apiary (03 §4).
export function OfflineBanner({ message }: { message?: string }) {
  const { t } = useTranslation()
  const online = useOnline()
  if (online) return null
  return (
    <p className={styles.banner} role="status">
      <CloudOff aria-hidden="true" size={18} strokeWidth={1.75} />
      <span>{message ?? t('ui.offline')}</span>
    </p>
  )
}
