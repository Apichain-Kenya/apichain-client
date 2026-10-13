import { useId, type ReactNode } from 'react'

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
  children: (props: FieldControlProps) => ReactNode
}

// A visible label for every control, hint and error tied to it by id, and the
// error shown under the field it belongs to (WCAG 1.3.1, 3.3.1).
export function Field({ label, hint, error, children }: Props) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-describedby': describedBy,
        ...(error ? { 'aria-invalid': true as const } : {}),
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
