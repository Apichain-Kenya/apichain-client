import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import styles from './DateChips.module.css'

type Props = {
  legend: string
  value: string // YYYY-MM-DD
  today: string // YYYY-MM-DD, injected so tests and time zones are explicit
  onChange: (value: string) => void
}

function minusOneDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// Most harvests are recorded the day they happen: two taps cover them, and a
// native date picker covers the rest without typing a date.
export function DateChips({ legend, value, today, onChange }: Props) {
  const { t } = useTranslation()
  const name = useId()
  const pickId = useId()
  const yesterday = minusOneDay(today)
  const chip = (label: string, date: string) => (
    <label className={styles.chip}>
      <input
        className={styles.input}
        type="radio"
        name={name}
        checked={value === date}
        onChange={() => onChange(date)}
      />
      {label}
    </label>
  )
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.row}>
        {chip(t('ui.dates.today'), today)}
        {chip(t('ui.dates.yesterday'), yesterday)}
        <label htmlFor={pickId} className={styles.pickLabel}>
          {t('ui.dates.pick')}
        </label>
        <input
          id={pickId}
          className={styles.pick}
          type="date"
          max={today}
          value={value !== today && value !== yesterday ? value : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      </div>
    </fieldset>
  )
}
