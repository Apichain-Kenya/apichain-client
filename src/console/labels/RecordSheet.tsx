import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { ArrowLeft, Printer } from 'lucide-react'

import { interpretAuthenticity } from '../../api/authenticity'
import type { Me } from '../../auth/SessionContext'
import { stepsDone, trustState, type VerifyResponse } from '../../consumer/trustState'
import { Button } from '../../ui/Button'
import listStyles from '../BatchesPage.module.css'
import { shortDay, timeline, type BatchDetail, type StateKey } from '../work'
import styles from './Labels.module.css'
import { declaredDay, eatTime, jarLink, longDay, useBatchSheet, useQr } from './sheet'

// The day a person declared, where the step has one (13 §0 #10): the harvest
// day and the day the lab tested. Every other step's day is when it was
// recorded.
const DECLARED: Partial<Record<StateKey, (v: VerifyResponse) => unknown>> = {
  HARVESTED: (v) => v.verification.harvest?.payload?.harvest_date,
  LAB_VERIFIED: (v) => v.verification.lab?.payload?.tested_at,
}

// The batch record sheet (13 §10 item 3, D13): v1's consumer "certificate",
// redesigned for staff. It states the trust state *as of the moment it was
// printed*, in the jar page's own words (12 D8) and the lab in D9's, with the
// code to the live record. It never says "verified" or "authentic", and shows
// no raw measurement: a test locks both. The browser's "Save as PDF" makes the
// PDF.
export function RecordSheet({ me, id }: { me: Me; id: number }) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const { batch, verify } = useBatchSheet(id)
  const back = (
    <button
      type="button"
      className={`${listStyles.back} ${styles.screenOnly}`}
      onClick={() => navigate(`/batches/${id}`)}
    >
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
      {batch.status === 'ok' ? batch.data.batch_code : t('console.batches.title')}
    </button>
  )
  if (batch.status !== 'ok' || verify === null || verify.status !== 'ok') {
    const failed = batch.status === 'error' || verify?.status === 'error'
    const offline = batch.status === 'offline' || verify?.status === 'offline'
    return (
      <section className={styles.page}>
        {back}
        <p role={failed ? 'alert' : 'status'}>
          {t(failed ? 'console.loadFailed' : offline ? 'console.offline' : 'app.loading')}
        </p>
      </section>
    )
  }
  return <Sheet me={me} b={batch.data} v={verify.data} back={back} />
}

function Sheet({ me, b, v, back }: { me: Me; b: BatchDetail; v: VerifyResponse; back: ReactNode }) {
  const { t } = useTranslation()
  // The moment this sheet speaks for, fixed when it was opened.
  const [at] = useState(() => new Date())
  const qr = useQr(jarLink(b.public_id))
  const state = trustState(v)
  const honeyKey = b.metadata?.honey_type
  const honey = honeyKey ? t(`scan.honey.${honeyKey}`, { defaultValue: honeyKey }) : null
  const heading = honey
    ? v.place
      ? t('console.record.heading', { honey, place: v.place })
      : t('console.record.headingNoPlace', { honey })
    : t('console.record.headingBatch', { code: b.batch_code })

  const kg = Number(v.verification.harvest?.payload?.quantity_kg)
  const jars = Number(v.verification.packaging?.payload?.unit_count)
  const facts = [
    b.farmer_display_name ? t('console.record.beekeeper', { name: b.farmer_display_name }) : null,
    b.apiary?.name ?? null,
    Number.isFinite(kg) && kg > 0 ? t('console.record.kg', { kg: String(kg) }) : null,
    Number.isInteger(jars) && jars > 0 ? t('console.record.jars', { count: jars }) : null,
  ].filter(Boolean)

  const lab = v.verification.lab?.payload
  const labName = typeof lab?.laboratory_name === 'string' ? lab.laboratory_name : null
  const cert = typeof lab?.certificate_number === 'string' ? lab.certificate_number : null

  return (
    <section className={styles.page} aria-labelledby="record-title">
      <div className={`${styles.bar} ${styles.screenOnly}`}>
        <div className={styles.barStart}>
          {back}
          <h1 className={styles.h1} id="record-title">
            {t('console.record.title')}
          </h1>
        </div>
        <Button icon={<Printer aria-hidden="true" size={18} />} onClick={() => window.print()}>
          {t('console.record.print')}
        </Button>
      </div>
      <div className={styles.desk}>
        <article className={styles.a4}>
          <div className={styles.top}>
            <span>{t('console.record.brand')}</span>
            <span className={styles.muted}>{b.batch_code}</span>
          </div>
          <div>
            <h2>{heading}</h2>
            {facts.length > 0 ? <p className={styles.muted}>{facts.join(' · ')}</p> : null}
          </div>
          <div className={styles.state}>
            <div>
              <span className={styles.muted}>
                {t('console.record.asOf', { when: eatTime(at) })}
              </span>
              <b>{t(`ui.seal.${state}.headline`)}</b>
              <span>{t(`ui.seal.${state}.detail`, { done: stepsDone(v) })}</span>
              <span>{t('console.record.atPrint')}</span>
            </div>
            {qr ? (
              <svg
                className={styles.stateQr}
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                role="img"
                aria-label={t('console.record.liveCode')}
              >
                <rect width={qr.size} height={qr.size} fill="#fff" />
                <path d={qr.d} fill="#000" shapeRendering="crispEdges" />
              </svg>
            ) : (
              <span className={styles.stateQr} />
            )}
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('console.record.step')}</th>
                <th scope="col">{t('console.record.day')}</th>
                <th scope="col">{t('console.record.by')}</th>
              </tr>
            </thead>
            <tbody>
              {timeline(b.stages).map(({ key, stage }) => {
                if (!stage) {
                  return (
                    <tr key={key}>
                      <td>{t(`console.steps.${key}`)}</td>
                      <td className={styles.muted}>{t('console.record.notYet')}</td>
                      <td />
                    </tr>
                  )
                }
                const declared = declaredDay(DECLARED[key]?.(v))
                const by =
                  stage.actor_role === 'admin'
                    ? t('console.record.byAdmin', { name: stage.actor_display_name })
                    : t('console.record.byRole', {
                        name: stage.actor_display_name,
                        role: t(`console.roles.${stage.actor_role}`),
                      })
                return (
                  <tr key={key}>
                    <td>{t(`console.steps.${key}`)}</td>
                    <td>{declared ?? longDay(stage.recorded_at)}</td>
                    <td>
                      {declared
                        ? t('console.record.on', { by, day: shortDay(stage.recorded_at) })
                        : by}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p>
            {t(interpretAuthenticity(v.conformance).i18n)}
            {labName
              ? ` ${cert ? t('console.record.labPlace', { lab: labName, cert }) : t('console.record.labOnly', { lab: labName })}`
              : ''}
          </p>
          <p className={styles.foot}>{t('console.record.foot', { name: me.display_name })}</p>
        </article>
      </div>
    </section>
  )
}
