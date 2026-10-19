import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'

import { localPhone } from '../auth/phone'
import type { Me } from '../auth/SessionContext'
import { useSync } from '../app/useSync'
import { Button } from '../ui/Button'
import { useFarm } from './FarmServices'
import { MyChoices } from './MyChoices'
import styles from './SimplePages.module.css'
import { useFarmData } from './useFarmData'
import { useMyChoices } from './useMyChoices'

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

/** Me: who is signed in, their message choices, whether the phone will
 *  keep saved work, and sign out. */
export function MePage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { session, outbox } = useFarm()
  const { persistent } = useSync()
  const [, navigate] = useLocation()
  const farmerId = me.farmer_id ?? null
  const { rows, contact, states } = useMyChoices(me.user_id, farmerId)
  // Harvests and choices are counted apart: a choice is not a harvest.
  const [harvests, setHarvests] = useState(0)
  useEffect(() => {
    let live = true
    const count = () =>
      void outbox.list(me.user_id).then((all) => {
        if (live)
          setHarvests(all.filter((r) => r.kind === 'batch.harvest' && r.status !== 'sent').length)
      })
    count()
    const off = outbox.subscribe(count)
    return () => {
      live = false
      off()
    }
  }, [outbox, me.user_id])
  const choices = (rows ?? []).filter((r) => r.status !== 'sent').length

  return (
    <section className={styles.page}>
      <h1 className="serif">{me.display_name}</h1>
      {contact ? (
        <dl className={styles.facts}>
          <div>
            <dt>{t('farm.me.phone')}</dt>
            <dd className="tnum">{localPhone(contact.phone)}</dd>
          </div>
        </dl>
      ) : null}
      {farmerId !== null ? (
        <MyChoices
          userId={me.user_id}
          farmerId={farmerId}
          rows={rows}
          contact={contact}
          states={states}
        />
      ) : null}
      {persistent !== null ? (
        <p>{persistent ? t('farm.me.storageOk') : t('farm.me.storageAsk')}</p>
      ) : null}
      <Link href="/password" className={styles.link}>
        {t('password.change.title')}
      </Link>
      {harvests > 0 ? (
        <p className={styles.note} role="status">
          {t('farm.me.signOutWaiting', { count: harvests })}
        </p>
      ) : null}
      {choices > 0 ? (
        <p className={styles.note} role="status">
          {t('farm.me.signOutChoices', { count: choices })}
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
