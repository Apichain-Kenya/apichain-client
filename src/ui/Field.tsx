import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import styles from './Field.module.css'

export type FieldControlProps = {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

type Props = {
  label: string
  hint?: string
  error?: string
  /** Marked wrong without a message of its own: its partner field says why. */
  invalid?: boolean
  /** Says "(optional)" after the label. */
  optional?: boolean
  children: (props: FieldControlProps) => ReactNode
}

// A visible label for every control, hint and error tied to it by id, and the
// error shown under the field it belongs to (WCAG 1.3.1, 3.3.1).
export function Field({ label, hint, error, invalid = false, optional = false, children }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}> {t('ui.optional')}</span> : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error || invalid ? { 'aria-invalid': true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
