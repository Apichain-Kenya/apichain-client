import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'

import { Disclosure } from '../ui/Disclosure'
import styles from './Timeline.module.css'
import { shortDay, timeline, type BatchStage } from './work'

const HEX = 'M32 3 L60 19 L60 53 L32 69 L4 53 L4 19 Z'

// The journey with who acted (13 §4.3, D10). Every recorded step names a
// person and their role; a step recorded under the admin role says "as admin"
// with a shield, so the exceptional, recorded event (03 §13.1c) shows at a
// glance. Done and not-yet steps differ in shape and words, never colour
// alone. Anchor status per step stays inside "Integrity", out of the main line.
export function Timeline({ stages }: { stages: BatchStage[] }) {
  const { t } = useTranslation()
  const steps = timeline(stages)
  const firstOpen = steps.findIndex((s) => s.stage === null)
  const records = steps.flatMap((s) => s.records)
  const sealed = records.filter((r) => r.anchor_status === 'confirmed').length

  return (
    <section className={styles.wrap} aria-labelledby="timeline-title">
      <h2 id="timeline-title" className={styles.title}>
        {t('console.timeline.title')}
      </h2>
      <ol className={styles.list}>
        {steps.map(({ key, stage }, i) => (
          <li key={key} className={`${styles.step} ${stage ? styles.done : styles.todo}`}>
            <svg className={styles.marker} viewBox="0 0 64 72" aria-hidden="true">
              <path d={HEX} />
            </svg>
            <span className={styles.label}>{t(`console.steps.${key}`)}</span>
            <span className={styles.when}>
              {stage
                ? shortDay(stage.recorded_at)
                : i === firstOpen
                  ? t('console.timeline.next')
                  : t('console.timeline.notYet')}
            </span>
            {stage ? (
              <span className={styles.by}>
                {stage.actor_role === 'admin' ? (
                  <>
                    <ShieldCheck aria-hidden="true" size={16} strokeWidth={2} />
                    {t('console.timeline.byAdmin', { name: stage.actor_display_name })}
                  </>
                ) : (
                  t('console.timeline.by', {
                    name: stage.actor_display_name,
                    role: t(`console.roles.${stage.actor_role}`),
                  })
                )}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {records.length > 0 ? (
        <Disclosure
          summary={t('console.integrity.summary', {
            sealed,
            sealing: records.length - sealed,
          })}
        >
          <ul className={styles.integrity}>
            {steps
              .filter((s) => s.stage)
              .map(({ key, records: rs }) => {
                const done = rs.every((r) => r.anchor_status === 'confirmed')
                return (
                  <li key={key}>
                    <span>{t(`console.steps.${key}`)}</span>
                    <span>
                      {t(done ? 'console.integrity.sealed' : 'console.integrity.sealing')}
                    </span>
                  </li>
                )
              })}
          </ul>
          <p className={styles.note}>{t('console.integrity.note')}</p>
        </Disclosure>
      ) : null}
    </section>
  )
}
