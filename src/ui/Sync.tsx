import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, RefreshCw, Smartphone } from 'lucide-react'

import styles from './Sync.module.css'

export type SyncStatus = 'local' | 'sending' | 'sent' | 'attention'

const ICONS = { local: Smartphone, sending: RefreshCw, sent: Check, attention: AlertCircle }

// Where a harvest is, in words (03 §3.2): "on this phone", "sent", or "needs
// your attention". Icon + word + colour, never colour alone.
export function SyncBadge({ status, label }: { status: SyncStatus; label?: string }) {
  const { t } = useTranslation()
  const Icon = ICONS[status]
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <Icon aria-hidden="true" size={16} strokeWidth={2} />
      <span>{label ?? t(`ui.sync.${status}`)}</span>
    </span>
  )
}

export function SyncChip({ waiting }: { waiting: number }) {
  const { t } = useTranslation()
  const pending = waiting > 0
  return (
    <span role="status" className={`${styles.chip} ${pending ? styles.local : styles.sent}`}>
      {pending ? (
        <Smartphone aria-hidden="true" size={16} strokeWidth={2} />
      ) : (
        <Check aria-hidden="true" size={16} strokeWidth={2} />
      )}
      <span>{pending ? t('ui.sync.waiting', { count: waiting }) : t('ui.sync.allSent')}</span>
    </span>
  )
}
