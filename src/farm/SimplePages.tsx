import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import type { Me } from '../auth/SessionContext'
import { useSync } from '../app/useSync'
import { Button } from '../ui/Button'
import { useFarm } from './FarmServices'
import styles from './SimplePages.module.css'
import { useFarmData } from './useFarmData'

/** My apiaries: names, place and hives. The exact point stays off screen. */
export function ApiariesPage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { apiaries } = useFarmData(me.user_id, me.farmer_id ?? null)
  return (
    <section className={styles.page}>
      <h1 className="serif">{t('farm.apiaries.title')}</h1>
      {apiaries !== null && apiaries.length === 0 ? <p>{t('farm.apiaries.empty')}</p> : null}
      <ul className={styles.list}>
        {(apiaries ?? []).map((a) => (
          <li key={a.id}>
            <span className={styles.name}>{a.name}</span>
            <span className={styles.sub}>
              {a.locality ?? t('farm.apiaries.noPlace')}
              {a.hive_count ? `, ${t('farm.apiaries.hives', { count: a.hive_count })}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Me: who is signed in, whether the phone will keep saved work, sign out. */
export function MePage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { session } = useFarm()
  const { waiting, persistent } = useSync()
  const [, navigate] = useLocation()
  return (
    <section className={styles.page}>
      <h1 className="serif">{me.display_name}</h1>
      {persistent !== null ? (
        <p>{persistent ? t('farm.me.storageOk') : t('farm.me.storageAsk')}</p>
      ) : null}
      <Link href="/password" className={styles.link}>
        {t('password.change.title')}
      </Link>
      {waiting > 0 ? (
        <p className={styles.note} role="status">
          {t('farm.me.signOutWaiting', { count: waiting })}
        </p>
      ) : null}
      <Button
        variant="secondary"
        full
        onClick={() => void session.signOut().then(() => navigate('~/sign-in', { replace: true }))}
      >
        {t('farm.me.signOut')}
      </Button>
    </section>
  )
}
