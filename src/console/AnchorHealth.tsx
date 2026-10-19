import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Check, Clock } from 'lucide-react'

import type { components } from '../api/client/schema'
import styles from './AnchorHealth.module.css'
import { useRead } from './useRead'
import { serverDate } from './work'

type AuditHealth = components['schemas']['AuditHealthResponse']
type AnchorState = components['schemas']['AnchorHealthResponse']

const REFRESH_MS = 5 * 60_000

/** "4 min ago", from the device's clock. */
function ago(t: (k: string, o?: Record<string, unknown>) => string, iso: string): string {
  const minutes = Math.floor((Date.now() - serverDate(iso).getTime()) / 60_000)
  if (minutes < 1) return t('console.health.justNow')
  if (minutes < 60) return t('console.health.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('console.health.hours', { count: hours })
  return t('console.health.days', { count: Math.floor(hours / 24) })
}

// Record health (13 §10 item 4, board): an admin's card. The chain check and
// the sealing queue, each said in words with its own shape: a tick, a clock,
// or an alert sign, never only a colour. Read again every five minutes.
export function AnchorHealth() {
  const { t } = useTranslation()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  const audit = useRead<AuditHealth>('/v2/audit/health', tick)
  const anchor = useRead<AnchorState>('/v2/audit/anchor-health', tick)

  const lines: { tone: 'ok' | 'wait' | 'bad'; text: string }[] = []
  if (audit.status === 'ok') {
    const a = audit.data
    if (!a.chain_ok) lines.push({ tone: 'bad', text: t('console.health.broken') })
    else if (a.checked_at)
      lines.push({ tone: 'ok', text: t('console.health.checked', { ago: ago(t, a.checked_at) }) })
    else lines.push({ tone: 'wait', text: t('console.health.notChecked') })
  }
  if (anchor.status === 'ok') {
    const h = anchor.data
    if (!h.anchor_ok) lines.push({ tone: 'bad', text: t('console.health.stuck') })
    lines.push({
      tone: h.pending_rows > 0 ? 'wait' : 'ok',
      text: t('console.health.waiting', { count: h.pending_rows }),
    })
  }
  const failed = audit.status === 'error' || anchor.status === 'error'
  const Icon = { ok: Check, wait: Clock, bad: AlertCircle }

  return (
    <section className={styles.card} aria-labelledby="health-title">
      <h2 id="health-title" className={styles.title}>
        {t('console.health.title')}
      </h2>
      {lines.map((l) => {
        const I = Icon[l.tone]
        return (
          <p key={l.text} className={`${styles.line} ${styles[l.tone]}`}>
            <I aria-hidden="true" size={16} strokeWidth={2} />
            <span>{l.text}</span>
          </p>
        )
      })}
      {failed && lines.length === 0 ? (
        <p className={styles.line}>{t('console.health.unavailable')}</p>
      ) : null}
    </section>
  )
}
