import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'

import { useSync } from '../app/useSync'
import { Brand } from '../ui/Brand'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import styles from './ChangePasswordPage.module.css'
import { useSessionApi, type Me } from './SessionContext'

// Choosing your own password (13 D5, D16; board "Choosing your own password").
//
// `forced`: the server refuses everything until this is done, so the guard
// shows this screen in place of every route, with no tabs. Otherwise it is
// the voluntary change from the Me page. The rule is spelled out for the
// role and checked here only to save a round trip: the server decides.
// Neither password outlives this screen: never in storage, and the sign-in
// password is never carried over to fill the first box.
const MIN = { farmer: 8, staff: 15 }
const MAX_BYTES = 72 // bcrypt's limit, as the server applies it

type Errors = { current?: string; next?: string; again?: string }

export function ChangePasswordPage({ me, forced }: { me: Me; forced: boolean }) {
  const { t } = useTranslation()
  const session = useSessionApi()
  const { waiting } = useSync()
  const [, navigate] = useLocation()
  const farmer = me.role === 'farmer'
  const who = farmer ? 'farmer' : 'staff'
  const min = MIN[who]
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [show, setShow] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const local: Errors = {}
    if (!current) local.current = t('password.errors.currentMissing')
    if (next.length < min) local.next = t('password.errors.tooShort', { count: min })
    else if (new TextEncoder().encode(next).length > MAX_BYTES) {
      local.next = t('password.errors.tooLong')
    } else if (next !== again) local.again = t('password.errors.mismatch')
    setErrors(local)
    if (Object.keys(local).length) return

    setBusy(true)
    const result = await session.changePassword(current, next)
    setBusy(false)
    // Narrowed with `in`: `.ok` alone did not narrow this union here.
    if (!('reason' in result)) {
      setCurrent('')
      setNext('')
      setAgain('')
      // Forced: the guard sees the flag clear and shows the app by itself.
      if (!forced) navigate(farmer ? '~/farm/me' : '~/console/me', { replace: true })
      return
    }
    if (result.reason === 'signed_out') return navigate('~/sign-in', { replace: true })
    if (result.reason === 'wrong_password') {
      setErrors({ current: t(`password.errors.wrong.${forced ? 'given' : 'current'}`) })
    } else if (result.reason === 'unchanged') {
      setErrors({ next: t('password.errors.unchanged') })
    } else if (result.reason === 'too_short') {
      setErrors({ next: t('password.errors.tooShort', { count: result.minLength ?? min }) })
    } else if (result.reason === 'too_long') {
      setErrors({ next: t('password.errors.tooLong') })
    } else {
      setErrors({ again: t('password.errors.offline') })
    }
  }

  return (
    <main className={farmer ? styles.page : `${styles.page} ${styles.desk}`}>
      {forced ? <Brand /> : null}
      <h1 className="serif">{t(forced ? 'password.forced.title' : 'password.change.title')}</h1>
      <p className={styles.lead}>
        {forced ? t(`password.forced.lead.${who}`) : t('password.change.lead')}
      </p>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field
          label={forced ? t(`password.forced.current.${who}`) : t('password.change.current')}
          error={errors.current}
        >
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('password.new')} hint={t(`password.rule.${who}`)} error={errors.next}>
          {(p) => (
            <div className={styles.reveal}>
              <input
                {...p}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <button
                type="button"
                className={styles.toggle}
                aria-pressed={show}
                onClick={() => setShow((v) => !v)}
              >
                {t('password.show')}
              </button>
            </div>
          )}
        </Field>
        <Field label={t('password.again')} error={errors.again}>
          {(p) => (
            <input
              {...p}
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={again}
              onChange={(e) => setAgain(e.target.value)}
            />
          )}
        </Field>
        {forced && farmer && waiting > 0 ? (
          <p className={styles.note} role="status">
            {t('password.forced.waiting', { count: waiting })}
          </p>
        ) : null}
        <Button type="submit" full loading={busy}>
          {t('password.save')}
        </Button>
      </form>
    </main>
  )
}
