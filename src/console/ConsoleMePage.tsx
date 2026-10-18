import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { useOutbox } from '../app/useOutbox'
import { useSessionApi, type Me } from '../auth/SessionContext'
import type { ActionRecord } from '../offline/outbox'
import { Button } from '../ui/Button'
import styles from './ConsoleMePage.module.css'
import { targetOf } from './work'

/** This person's saved staff steps, live from the outbox. */
function useMySteps(userId: number) {
  const { outbox } = useOutbox()
  const [rows, setRows] = useState<ActionRecord[]>([])
  useEffect(() => {
    let live = true
    const load = () =>
      void outbox.list(userId).then((all) => live && setRows(all.filter((r) => targetOf(r.kind))))
    load()
    const off = outbox.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [outbox, userId])
  return rows
}

/** Me: who is signed in and as what, their own password, and sign out. */
export function ConsoleMePage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const session = useSessionApi()
  const [, navigate] = useLocation()
  const steps = useMySteps(me.user_id)
  // Only a queued step will send at the next sign-in; a refused one never
  // will, so it is listed apart, with the way back to its card (review).
  const queued = steps.filter((r) => r.status === 'queued').length
  const refused = steps.filter((r) => r.status === 'needs_attention')
  return (
    <section className={styles.page}>
      <h1 className="serif">{me.display_name}</h1>
      <p className={styles.role}>{t(`console.roles.${me.role}`)}</p>
      <p className={styles.shared}>{t('console.me.shared')}</p>
      <Link href="/password" className={styles.link}>
        {t('password.change.title')}
      </Link>
      {queued > 0 ? (
        <p className={styles.note} role="status">
          {t('console.me.signOutWaiting', { count: queued })}
        </p>
      ) : null}
      {refused.length > 0 ? (
        <div className={styles.refused}>
          <p>{t('console.me.refused')}</p>
          <ul>
            {refused.map((r) => (
              <li key={r.id}>
                <Link href={`/batches/${String(r.body.batch_id)}`} className={styles.link}>
                  {t('console.me.refusedStep', {
                    step: t(`console.steps.${targetOf(r.kind)}`),
                    id: String(r.body.batch_id),
                  })}
                </Link>
              </li>
            ))}
          </ul>
        </div>
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
