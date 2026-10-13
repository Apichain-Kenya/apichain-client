import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

import styles from './Disclosure.module.css'

// Native <details>: keyboard and screen-reader behaviour for free, and the
// technical detail stays out of the low-literacy default path (03 §6).
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  return (
    <details className={styles.details} open={defaultOpen || undefined}>
      <summary className={styles.summary}>
        <span>{summary}</span>
        <ChevronDown className={styles.chevron} aria-hidden="true" size={20} strokeWidth={1.75} />
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  )
}
