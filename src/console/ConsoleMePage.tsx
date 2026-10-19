import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { useOutbox } from '../app/useOutbox'
import { useSessionApi, type Me } from '../auth/SessionContext'
import type { ActionRecord } from '../offline/outbox'
import { Button } from '../ui/Button'
import styles from './ConsoleMePage.module.css'
import { targetOf } from './work'

// A farmer's page holds this person's saved choices and new apiaries.
const FARMER_WORK = new Set(['consent.record', 'apiary.create'])

/** This person's saved staff work (steps, choices, apiaries), live. */
function useMyWork(userId: number) {
  const { outbox } = useOutbox()
  const [rows, setRows] = useState<ActionRecord[]>([])
  useEffect(() => {
    let live = true
    const load = () =>
      void outbox
        .list(userId)
        .then(
          (all) => live && setRows(all.filter((r) => targetOf(r.kind) || FARMER_WORK.has(r.kind))),
        )
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
  const work = useMyWork(me.user_id)
  // Only queued work will send at the next sign-in; refused work never will,
  // so it is listed apart, with the way back to where it can be removed.
  const queued = work.filter((r) => r.status === 'queued')
  const steps = queued.filter((r) => targetOf(r.kind)).length
  const changes = queued.length - steps
  const refused = work.filter((r) => r.status === 'needs_attention')
  return (
    <section className={styles.page}>
      <h1 className="serif">{me.display_name}</h1>
      <p className={styles.role}>{t(`console.roles.${me.role}`)}</p>
      <p className={styles.shared}>{t('console.me.shared')}</p>
      <Link href="/password" className={styles.link}>
        {t('password.change.title')}
      </Link>
      {steps > 0 ? (
        <p className={styles.note} role="status">
          {t('console.me.signOutWaiting', { count: steps })}
        </p>
      ) : null}
      {changes > 0 ? (
        <p className={styles.note} role="status">
          {t('console.me.signOutChanges', { count: changes })}
        </p>
      ) : null}
      {refused.length > 0 ? (
        <div className={styles.refused}>
          <p>{t('console.me.refused')}</p>
          <ul>
            {refused.map((r) => (
              <li key={r.id}>
                {targetOf(r.kind) ? (
                  <Link href={`/batches/${String(r.body.batch_id)}`} className={styles.link}>
                    {t('console.me.refusedStep', {
                      step: t(`console.steps.${targetOf(r.kind)}`),
                      id: String(r.body.batch_id),
                    })}
                  </Link>
                ) : (
                  <Link href={`/farmers/${String(r.body.farmer_id)}`} className={styles.link}>
                    {t(
                      r.kind === 'consent.record'
                        ? 'console.me.refusedChoice'
                        : 'console.me.refusedApiary',
                      { id: String(r.body.farmer_id) },
                    )}
                  </Link>
                )}
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
