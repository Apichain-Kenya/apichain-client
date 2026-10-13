import type { ReactNode } from 'react'

import styles from './Toast.module.css'

// A polite announcement that never steals focus (WCAG 4.1.3). It stays until
// acted on or dismissed: a farmer reading slowly is not on a 4-second clock.
export function Toast({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      <span>{children}</span>
      {action}
    </div>
  )
}
