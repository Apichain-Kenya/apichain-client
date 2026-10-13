import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useSearch } from 'wouter'

import { Brand } from '../ui/Brand'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { useFarm } from './FarmServices'
import styles from './SignInPage.module.css'

// The first sign-in needs a network; capture never does (12 D16). The copy
// says so before the farmer tries, not after it fails.
export function SignInPage() {
  const { t } = useTranslation()
  const { session } = useFarm()
  const [, navigate] = useLocation()
  const next = new URLSearchParams(useSearch()).get('next')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    const result = await session.signIn(identifier.trim(), password)
    setBusy(false)
    if (result === 'ok') {
      // Only ever back into this app, never to another origin.
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/farm'
      navigate(target, { replace: true })
    } else {
      setError(result === 'invalid' ? t('farm.signIn.invalid') : t('farm.signIn.offline'))
    }
  }

  return (
    <main className={styles.page}>
      <Brand />
      <h1 className="serif">{t('farm.signIn.title')}</h1>
      <p className={styles.lead}>{t('farm.signIn.lead')}</p>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('farm.signIn.identifier')}>
          {(p) => (
            <input
              {...p}
              type="text"
              inputMode="tel"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('farm.signIn.password')} error={error}>
          {(p) => (
            <input
              {...p}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" full loading={busy}>
          {t('farm.signIn.submit')}
        </Button>
      </form>
    </main>
  )
}
