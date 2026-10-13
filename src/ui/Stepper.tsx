import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import styles from './Stepper.module.css'

type Props = {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}

// Counting with two big buttons instead of typing on a small keyboard (03 §10).
// The number stays a real spinbutton, so a keyboard user can type or arrow it.
export function Stepper({ label, value, onChange, min = 0, max = 9999, step = 1 }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <div className={styles.wrap}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.stepper}>
        <button
          type="button"
          className={styles.step}
          aria-label={`${t('ui.stepper.fewer')}: ${label}`}
          disabled={value <= min}
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <input
          id={id}
          className={styles.value}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isNaN(n)) onChange(clamp(n))
          }}
        />
        <button
          type="button"
          className={styles.step}
          aria-label={`${t('ui.stepper.more')}: ${label}`}
          disabled={value >= max}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  )
}
