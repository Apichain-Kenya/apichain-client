import { useTranslation } from 'react-i18next'
import { Check, ExternalLink, FlaskConical, TriangleAlert } from 'lucide-react'

import { interpretAuthenticity } from '../api/authenticity'
import { Disclosure } from '../ui/Disclosure'
import { Journey } from '../ui/Journey'
import { TrustSeal } from '../ui/TrustSeal'
import { journeySteps, stepsDone, trustState, type VerifyResponse } from './trustState'
import styles from './VerifyView.module.css'

const shortDate = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})
const monthYear = new Intl.DateTimeFormat('en-KE', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

type Blocks = VerifyResponse['verification']
const STAGE_ORDER: (keyof Blocks)[] = [
  'apiary',
  'metadata',
  'harvest',
  'process',
  'lab',
  'packaging',
  'distribution',
]

// The jar label (12 §4.2, §10; approved board). Kept from v1: the place-led
// serif hero and the six-step journey. Changed: one plain quality line
// instead of v1's paragraph of model output, the four-state seal instead of
// "Blockchain Verified", and every hash and measurement behind "How this was
// checked". Phone: one column. Laptop: label left, evidence right.
export function VerifyView({
  verify,
  cachedAt,
}: {
  verify: VerifyResponse
  cachedAt: string | null
}) {
  const { t } = useTranslation()
  const state = trustState(verify)
  const quality = interpretAuthenticity(verify.conformance)
  const honey = verify.metadata?.honey_type
  const when = verify.metadata?.harvest_window_start
  const reached = STAGE_ORDER.filter((name) => verify.verification[name])

  return (
    <article className={styles.label}>
      <div className={styles.left}>
        <header className={styles.place}>
          {verify.place ? <p className={styles.near}>{t('scan.harvestedNear')}</p> : null}
          <h1 className="serif">{verify.place ?? t('scan.harvestedIn')}</h1>
          {honey && when ? (
            <p className={styles.lot}>
              {t('scan.lot', {
                honey: t(`scan.honey.${honey}`, { defaultValue: honey }),
                when: monthYear.format(new Date(when)),
              })}
            </p>
          ) : null}
        </header>
        {cachedAt ? (
          <p className={styles.cached} role="status">
            {t('scan.cachedOn', { date: shortDate.format(new Date(cachedAt)) })}
          </p>
        ) : null}
        <TrustSeal state={state} stepsDone={stepsDone(verify)} />
        <p className={`${styles.quality} ${styles[quality.tone]}`}>
          <FlaskConical aria-hidden="true" size={20} strokeWidth={1.75} />
          <span>{t(quality.i18n)}</span>
        </p>
        {state === 'mismatch' ? <p className={styles.advice}>{t('scan.mismatchAdvice')}</p> : null}
      </div>

      <div className={styles.right}>
        <Journey steps={journeySteps(verify)} />
        <Disclosure summary={t('scan.how')}>
          <ul className={styles.checks}>
            {reached.map((name) => {
              const ok = verify.verification[name]?.match === true
              return (
                <li key={name}>
                  <span>{t(`scan.stages.${name}`)}</span>
                  <span className={ok ? styles.ok : styles.bad}>
                    {ok ? (
                      <Check aria-hidden="true" size={16} strokeWidth={2.4} />
                    ) : (
                      <TriangleAlert aria-hidden="true" size={16} strokeWidth={2} />
                    )}
                    {ok ? t('scan.unchanged') : t('scan.changed')}
                  </span>
                </li>
              )
            })}
          </ul>
          {verify.conformance?.parameters.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.params}>
                <caption className="visually-hidden">{t('scan.lab.title')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('scan.lab.measure')}</th>
                    <th scope="col">{t('scan.lab.result')}</th>
                    <th scope="col">{t('scan.lab.standard')}</th>
                    <th scope="col">
                      <span className="visually-hidden">{t('scan.lab.title')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {verify.conformance.parameters.map((p) => (
                    <tr key={p.parameter}>
                      <th scope="row">
                        {t(`scan.lab.names.${p.parameter}`, { defaultValue: p.parameter })}
                      </th>
                      <td>{p.measured ? `${p.measured} ${p.unit}` : '—'}</td>
                      <td>
                        {t(p.comparator === '<=' ? 'scan.lab.atMost' : 'scan.lab.atLeast', {
                          limit: p.limit,
                          unit: p.unit,
                        })}
                      </td>
                      <td className={p.status === 'pass' ? styles.ok : undefined}>
                        {t(`scan.lab.${p.status}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className={styles.explain}>{t(`scan.explain.${state}`)}</p>
          <a
            className={styles.record}
            href={`/v2/public/batches/${verify.public_id}/anchor-proof`}
            target="_blank"
            rel="noreferrer"
          >
            {t('scan.publicRecord')}
            <ExternalLink aria-hidden="true" size={16} strokeWidth={1.75} />
          </a>
        </Disclosure>
      </div>
    </article>
  )
}
