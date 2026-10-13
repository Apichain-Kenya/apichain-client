import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { ScanLine } from 'lucide-react'

import { Brand } from '../ui/Brand'
import styles from './Landing.module.css'

// The front door is the jar check, because most visitors are holding one.
// Beekeepers get a quiet second door.
export default function Landing() {
  const { t } = useTranslation()
  return (
    <main className={styles.page}>
      <Brand />
      <h1 className={`serif ${styles.title}`}>{t('landing.title')}</h1>
      <p className={styles.lead}>{t('landing.lead')}</p>
      <Link href="/scan" className={styles.primary}>
        <ScanLine aria-hidden="true" size={22} strokeWidth={1.75} />
        {t('landing.scan')}
      </Link>
      <Link href="/sign-in" className={styles.quiet}>
        {t('landing.signIn')}
      </Link>
    </main>
  )
}
