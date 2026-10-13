import type { ButtonHTMLAttributes, ReactNode } from 'react'

import styles from './Button.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'quiet'
  loading?: boolean
  icon?: ReactNode
  full?: boolean
}

// One primary action per screen (03 §10). Primary is ink, never honey, so the
// amber "still on its journey" state never reads as something to press.
export function Button({
  variant = 'primary',
  loading = false,
  icon,
  full = false,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={[styles.button, styles[variant], full ? styles.full : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span>{children}</span>
    </button>
  )
}
