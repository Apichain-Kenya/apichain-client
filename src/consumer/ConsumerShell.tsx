import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { ScanLine } from 'lucide-react'

import { Brand } from '../ui/Brand'
import styles from './ConsumerShell.module.css'

// The consumer has no account and no navigation to learn: a brand, one way
// to scan another jar, and the page (12 §4.5).
export function ConsumerShell({
  children,
  scanLink = true,
}: {
  children: ReactNode
  scanLink?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <Link href="/" className={styles.home}>
          <Brand />
        </Link>
        {scanLink ? (
          <Link href="/scan" className={styles.scan}>
            <ScanLine aria-hidden="true" size={20} strokeWidth={1.75} />
            {t('scan.scanAnother')}
          </Link>
        ) : null}
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
