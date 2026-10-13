import { useTranslation } from 'react-i18next'

import styles from './TrustSeal.module.css'

export type TrustState = 'sealed' | 'sealing' | 'in_progress' | 'mismatch'

const HEX = 'M32 3 L60 19 L60 53 L32 69 L4 53 L4 19 Z'

// The one bold element in the system (12 §4.2): a honeycomb cell, capped when
// the record is publicly sealed, half-capped while the seal is on its way,
// open while the journey is still going, broken if a record has changed. The
// words beside it stay literal, so the state never depends on the drawing or
// on colour (WCAG 1.4.1).
function Cell({ state, done }: { state: TrustState; done: number }) {
  switch (state) {
    case 'sealed':
      return (
        <>
          <path d={HEX} className={styles.fill} />
          <path d="M20 37l8 8 16-17" className={styles.check} />
        </>
      )
    case 'sealing':
      return (
        <>
          <path d="M32 3 L60 19 L60 36 L4 36 L4 19 Z" className={styles.wax} />
          <path d={HEX} className={styles.outline} />
        </>
      )
    case 'in_progress':
      return (
        <>
          <path d={HEX} className={`${styles.outline} ${styles.dashed}`} />
          <text x="32" y="42" textAnchor="middle" className={styles.count}>
            {done}/6
          </text>
        </>
      )
    case 'mismatch':
      return (
        <>
          <path d={HEX} className={`${styles.outline} ${styles.broken}`} />
          <path d="M32 22v20" className={styles.bang} />
          <circle cx="32" cy="51" r="3.2" className={styles.dot} />
        </>
      )
  }
}

export function TrustSeal({ state, stepsDone }: { state: TrustState; stepsDone: number }) {
  const { t } = useTranslation()
  const vars = { done: stepsDone }
  return (
    <section className={`${styles.seal} ${styles[state]}`}>
      <svg
        className={styles.cell}
        viewBox="0 0 64 72"
        role="img"
        aria-label={t(`ui.seal.${state}.label`, vars)}
      >
        <Cell state={state} done={stepsDone} />
      </svg>
      <div className={styles.copy}>
        <h2 className={styles.headline}>{t(`ui.seal.${state}.headline`)}</h2>
        <p className={styles.detail}>{t(`ui.seal.${state}.detail`, vars)}</p>
      </div>
    </section>
  )
}
