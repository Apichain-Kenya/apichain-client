import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { useSync } from '../app/useSync'
import { useSessionApi, type Me } from '../auth/SessionContext'
import { Button } from '../ui/Button'
import styles from './ConsoleMePage.module.css'

/** Me: who is signed in and as what, their own password, and sign out. */
export function ConsoleMePage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const session = useSessionApi()
  const { waiting } = useSync()
  const [, navigate] = useLocation()
  return (
    <section className={styles.page}>
      <h1 className="serif">{me.display_name}</h1>
      <p className={styles.role}>{t(`console.roles.${me.role}`)}</p>
      <p className={styles.shared}>{t('console.me.shared')}</p>
      <Link href="/password" className={styles.link}>
        {t('password.change.title')}
      </Link>
      {waiting > 0 ? (
        <p className={styles.note} role="status">
          {t('console.me.signOutWaiting', { count: waiting })}
        </p>
      ) : null}
      <Button
        variant="secondary"
        onClick={() => void session.signOut().then(() => navigate('~/sign-in', { replace: true }))}
      >
        {t('console.me.signOut')}
      </Button>
    </section>
  )
}
