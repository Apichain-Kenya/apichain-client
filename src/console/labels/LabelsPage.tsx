import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { AlertTriangle, ArrowLeft, Printer } from 'lucide-react'

import { Button } from '../../ui/Button'
import listStyles from '../BatchesPage.module.css'
import type { BatchDetail } from '../work'
import styles from './Labels.module.css'
import { mayPrintLabels } from '../printOrigins'
import { jarLink, longDay, useBatchSheet, useQr } from './sheet'

const PER_SHEET = 12
const SYMBOL = 'jar-qr'

// Jar labels (13 §10 items 1-2, board): one code per batch, its /v/ link
// (12 D10), on `unit_count` labels, twelve to an A4 sheet. Off the print
// allowlist (D12) every label carries "SAMPLE: not for jars" and the button
// says so in its own words. The browser prints; there is no PDF library.
export function LabelsPage({ id }: { id: number }) {
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
  return (
    <Labels
      batch={batch.data}
      units={unitCount(verify.data.verification.packaging?.payload)}
      back={back}
    />
  )
}

function unitCount(payload: Record<string, unknown> | null | undefined): number | null {
  const n = Number(payload?.unit_count)
  return Number.isInteger(n) && n > 0 ? n : null
}

function Labels({
  batch: b,
  units,
  back,
}: {
  batch: BatchDetail
  units: number | null
  back: ReactNode
}) {
  const { t } = useTranslation()
  const packed = b.state === 'PACKAGED' || b.state === 'DISTRIBUTED'
  const real = mayPrintLabels(window.location.origin)
  const link = jarLink(b.public_id)
  const { qr, failed } = useQr(packed && units ? link : null)
  const honey = b.metadata?.honey_type
  const packedAt = b.stages.find((s) => s.action === 'batch.packaged')?.recorded_at

  const title = (
    <h1 className={styles.h1} id="labels-title">
      {t('console.labels.title')}
    </h1>
  )
  if (!packed || !units) {
    return (
      <section className={styles.page} aria-labelledby="labels-title">
        {back}
        {title}
        <p>{t(packed ? 'console.labels.noCount' : 'console.labels.notPacked')}</p>
      </section>
    )
  }

  const sheets = Math.ceil(units / PER_SHEET)
  const label = (i: number) => (
    <div key={i} className={styles.label}>
      {qr ? (
        <svg className={styles.qr} viewBox={`0 0 ${qr.size} ${qr.size}`} aria-hidden="true">
          <use href={`#${SYMBOL}`} />
        </svg>
      ) : (
        <span className={styles.qr} />
      )}
      <div className={styles.words}>
        <b>
          {t('console.labels.honey', {
            honey: honey ? t(`scan.honey.${honey}`, { defaultValue: honey }) : '',
          }).trim()}
        </b>
        <span>{t('console.labels.scan')}</span>
        {packedAt ? <span>{t('console.labels.packed', { day: longDay(packedAt) })}</span> : null}
      </div>
      <span className={styles.code}>{b.batch_code}</span>
      {real ? null : (
        <div className={styles.watermark}>
          <span>{t('console.labels.watermark')}</span>
        </div>
      )}
    </div>
  )

  return (
    <section className={styles.page} aria-labelledby="labels-title">
      <div className={`${styles.bar} ${styles.screenOnly}`}>
        <div className={styles.barStart}>
          {back}
          {title}
          <p className={styles.small}>
            {t('console.labels.count', {
              labels: t('console.labels.labels', { count: units }),
              sheets: t('console.labels.sheets', { count: sheets }),
            })}
          </p>
        </div>
        <div className={styles.actions}>
          {real ? null : <span className={styles.tag}>{t('console.labels.sampleTag')}</span>}
          <Button
            icon={<Printer aria-hidden="true" size={18} />}
            disabled={!qr}
            onClick={() => window.print()}
          >
            {t(real ? 'console.labels.print' : 'console.labels.printSample')}
          </Button>
        </div>
      </div>
      {real ? null : (
        <p className={`${styles.notice} ${styles.screenOnly}`}>
          <AlertTriangle aria-hidden="true" size={18} strokeWidth={2} />
          <span>{t('console.labels.notice')}</span>
        </p>
      )}
      {qr ? null : (
        <p className={`${styles.small} ${styles.screenOnly}`} role="status">
          {t(failed ? 'console.labels.qrFailed' : 'console.labels.making')}
        </p>
      )}
      {/* The code is drawn once and used by every label. */}
      {qr ? (
        <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
          <symbol id={SYMBOL} viewBox={`0 0 ${qr.size} ${qr.size}`} data-qr-text={link}>
            <rect width={qr.size} height={qr.size} fill="#fff" />
            <path d={qr.d} fill="#000" shapeRendering="crispEdges" />
          </symbol>
        </svg>
      ) : null}
      <div className={styles.desk}>
        {Array.from({ length: sheets }, (_, s) => (
          <div
            key={s}
            className={styles.sheet}
            role="group"
            aria-label={t('console.labels.sheet', { n: s + 1, total: sheets })}
          >
            {Array.from({ length: Math.min(PER_SHEET, units - s * PER_SHEET) }, (_, i) =>
              label(s * PER_SHEET + i),
            )}
          </div>
        ))}
      </div>
      <p className={`${styles.small} ${styles.screenOnly}`}>{t('console.labels.spec')}</p>
    </section>
  )
}
