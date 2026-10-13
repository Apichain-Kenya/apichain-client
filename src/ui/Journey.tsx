import { useTranslation } from 'react-i18next'

import styles from './Journey.module.css'

export type StepKey =
  'CREATED' | 'HARVESTED' | 'PROCESSED' | 'LAB_VERIFIED' | 'PACKAGED' | 'DISTRIBUTED'

export type JourneyStep = { key: StepKey; date: string | null }

const HEX = 'M32 3 L60 19 L60 53 L32 69 L4 53 L4 19 Z'
const fmt = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' })

// The six-step journey (v1 keeper, rewritten): done and not-yet steps differ
// in shape and in words, never only in colour. Vertical in a narrow column,
// horizontal once its container has room (container query, not viewport).
export function Journey({ steps, title }: { steps: JourneyStep[]; title?: string }) {
  const { t } = useTranslation()
  return (
    <section className={styles.wrap}>
      <h2 className={styles.title}>{title ?? t('ui.journey.title')}</h2>
      <ol className={styles.list}>
        {steps.map((s) => {
          const done = s.date !== null
          return (
            <li key={s.key} className={`${styles.step} ${done ? styles.done : styles.todo}`}>
              <svg className={styles.marker} viewBox="0 0 64 72" aria-hidden="true">
                <path d={HEX} />
              </svg>
              <span className={styles.label}>{t(`ui.journey.steps.${s.key}`)}</span>
              <span className={styles.when}>
                {done ? fmt.format(new Date(s.date as string)) : t('ui.journey.notYet')}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
