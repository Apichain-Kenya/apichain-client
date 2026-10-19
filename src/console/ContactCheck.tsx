import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { ArrowLeft, Clock } from 'lucide-react'

import { localPhone } from '../auth/phone'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import listStyles from './BatchesPage.module.css'
import { clock, timeOfDay, type FarmerDetail } from './farmers'
import styles from './FarmersPage.module.css'
import peopleStyles from './PeoplePage.module.css'
import { usePress } from './usePress'
import { useRead } from './useRead'

type Said = { tone: 'status' | 'alert'; text: string } | null

// "Confirm this number is theirs" (13 §9 item 5, board): online only. The
// resend countdown runs to the server's `resend_available_at`, and a 429
// holds the button for its `Retry-After`. The code is six digits on the
// phone's number pad, which can fill it from the text itself.
export function ContactCheck({
  id,
  channel,
  changed,
}: {
  id: number
  channel: 'sms' | 'email'
  changed: () => void
}) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const farmer = useRead<FarmerDetail>(`/v2/farmers/${id}`)
  const { post, fresh } = usePress()
  const [expires, setExpires] = useState<string | null>(null)
  const [everSent, setEverSent] = useState(false)
  const [waitUntil, setWaitUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [code, setCode] = useState('')
  const [said, setSaid] = useState<Said>(null)
  const [codeError, setCodeError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  // Tick only while there is something to count down.
  const left = (waitUntil - now) / 1000
  useEffect(() => {
    if (waitUntil <= Date.now()) return
    const timer = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= waitUntil) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [waitUntil])

  const to =
    farmer.status === 'ok'
      ? channel === 'sms'
        ? localPhone(farmer.data.phone)
        : (farmer.data.email ?? '')
      : ''

  const send = async () => {
    setBusy(true)
    setSaid(null)
    fresh()
    const result = await post(`/v2/farmers/${id}/verifications`, { channel })
    setBusy(false)
    setNow(Date.now())
    if (result.kind === 'ok') {
      setEverSent(true)
      setExpires(String(result.data.expires_at))
      setWaitUntil(Date.parse(String(result.data.resend_available_at)))
      setSaid({ tone: 'status', text: t('console.farmers.verify.sent') })
    } else if (result.kind === 'offline') {
      setSaid({ tone: 'alert', text: t('console.farmers.verify.offline') })
    } else if (result.status === 429) {
      const seconds = result.retryAfter ?? Number(result.details?.retry_after_seconds ?? 60)
      setWaitUntil(Date.now() + seconds * 1000)
      setSaid({ tone: 'alert', text: t('console.farmers.verify.rateLimited') })
    } else if (result.code === 'invalid_recipient') {
      setSaid({
        tone: 'alert',
        text: t(
          channel === 'sms'
            ? 'console.farmers.verify.noRecipientSms'
            : 'console.farmers.verify.noRecipientEmail',
        ),
      })
    } else if (result.status === 503) {
      setSaid({ tone: 'alert', text: t('console.farmers.verify.sendFailed') })
    } else {
      setSaid({ tone: 'alert', text: t('console.farmers.verify.failed') })
    }
  }

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!/^[0-9]{6}$/.test(code)) return setCodeError(t('console.farmers.verify.format'))
    setCodeError(undefined)
    setBusy(true)
    fresh()
    const result = await post(`/v2/farmers/${id}/verifications/confirm`, { channel, code })
    setBusy(false)
    if (result.kind === 'ok') {
      changed() // the list beside it says "Phone confirmed" too
      return navigate(`/farmers/${id}`)
    }
    if (result.kind === 'offline') return setCodeError(t('console.farmers.verify.offline'))
    if (result.code === 'invalid_code') {
      return setCodeError(
        t('console.farmers.verify.invalid', {
          count: Number(result.details?.attempts_remaining ?? 0),
        }),
      )
    }
    setCodeError(
      t(
        result.code === 'code_locked'
          ? 'console.farmers.verify.locked'
          : result.code === 'no_active_code'
            ? 'console.farmers.verify.noCode'
            : 'console.farmers.verify.failed',
      ),
    )
  }

  const waiting = left > 0
  return (
    <section className={peopleStyles.pane} aria-labelledby="verify-title">
      <button type="button" className={listStyles.back} onClick={() => navigate(`/farmers/${id}`)}>
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
        {farmer.status === 'ok' ? farmer.data.display_name : t('console.farmers.title')}
      </button>
      <h1 id="verify-title" className={peopleStyles.h2}>
        {t(
          channel === 'sms'
            ? 'console.farmers.verify.titleSms'
            : 'console.farmers.verify.titleEmail',
        )}
      </h1>
      {to ? (
        <p className={peopleStyles.small}>{t('console.farmers.verify.intro', { to })}</p>
      ) : null}
      <Button
        variant={everSent ? 'secondary' : 'primary'}
        className={peopleStyles.save}
        loading={busy}
        disabled={waiting}
        onClick={() => void send()}
      >
        {waiting
          ? t('console.farmers.verify.resendIn', { time: clock(left) })
          : t(everSent ? 'console.farmers.verify.resend' : 'console.farmers.verify.send')}
      </Button>
      {said ? (
        <p
          className={said.tone === 'alert' ? peopleStyles.error : peopleStyles.small}
          role={said.tone}
        >
          {said.text}
        </p>
      ) : null}
      {expires ? (
        <p className={styles.until}>
          <Clock aria-hidden="true" size={16} strokeWidth={2} />
          {t('console.farmers.verify.until', { time: timeOfDay(expires) })}
        </p>
      ) : null}
      <form className={peopleStyles.form} onSubmit={(e) => void confirm(e)} noValidate>
        <Field label={t('console.farmers.verify.code')} error={codeError}>
          {(p) => (
            <input
              {...p}
              className={styles.code}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => {
                setCodeError(undefined)
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }}
            />
          )}
        </Field>
        <Button type="submit" className={peopleStyles.save} loading={busy}>
          {t('console.farmers.verify.confirm')}
        </Button>
      </form>
      <p className={peopleStyles.small}>{t('console.farmers.verify.notSignIn')}</p>
    </section>
  )
}
