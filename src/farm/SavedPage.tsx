import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearch } from 'wouter'

import type { Me } from '../auth/SessionContext'
import { useFarm } from './FarmServices'
import styles from './SavedPage.module.css'

const HEX = 'M32 3 L60 19 L60 53 L32 69 L4 53 L4 19 Z'

// After "Save harvest" (approved board): the words say exactly where the
// record is. "Saved on this phone" until the server has it, then "Sent".
export function SavedPage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { outbox } = useFarm()
  const id = new URLSearchParams(useSearch()).get('id')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const check = () =>
      void outbox
        .list(me.user_id)
        .then((rows) => setSent(rows.find((r) => r.id === id)?.status === 'sent'))
    check()
    return outbox.subscribe(check)
  }, [outbox, me.user_id, id])

  return (
    <section className={styles.page}>
      <svg
        className={`${styles.cell} ${sent ? styles.sent : styles.local}`}
        viewBox="0 0 64 72"
        aria-hidden="true"
      >
        <path d={HEX} />
        <path d="M20 37l8 8 16-17" className={styles.check} />
      </svg>
      <h1 className="serif">{sent ? t('farm.saved.sent') : t('farm.saved.local')}</h1>
      <p role="status">{sent ? t('farm.saved.sentBody') : t('farm.saved.localBody')}</p>
      <div className={styles.actions}>
        <Link href="/" className={styles.primary}>
          {t('farm.saved.done')}
        </Link>
        <Link href="/register" className={styles.secondary}>
          {t('farm.saved.another')}
        </Link>
      </div>
    </section>
  )
}
