import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { ArrowLeft, BookOpenText, ChevronLeft, CloudOff } from 'lucide-react'

import { localPhone, toE164Ke } from '../auth/phone'
import { CONSENT_TEXT_VERSION } from '../i18n/consent'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Stepper } from '../ui/Stepper'
import { useOnline } from '../ui/useOnline'
import { useWide } from '../ui/useWide'
import listStyles from './BatchesPage.module.css'
import type { FarmerNotice } from './FarmersPage'
import styles from './FarmersPage.module.css'
import peopleStyles from './PeoplePage.module.css'
import { usePress } from './usePress'

type Step = 1 | 2 | 3 | 4
const STEP_NAMES = ['details', 'agreement', 'password', 'check'] as const
// The backend's rules (`password_policy`, the 72-byte bcrypt limit).
const FARMER_MIN = 8
const BCRYPT_MAX_BYTES = 72
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Enrol a farmer (13 §9 item 2, D8). Online only: the body holds the farmer's
// starting password, so it never goes to the outbox or anywhere else on the
// device. The password lives in this component's state alone and goes when
// it unmounts. The Idempotency-Key is minted on the press and reused only
// after a dropped connection; any edit drops it (D4).
export function EnrolFarmer({
  back,
  setNotice,
  changed,
}: {
  back: boolean
  setNotice: (n: FarmerNotice) => void
  changed: () => void
}) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const wide = useWide()
  const online = useOnline()
  const { post, fresh } = usePress()
  const [step, setStep] = useState<Step>(1)
  const shows = (n: Step) => wide || step === n

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [hives, setHives] = useState(0)
  const [agreed, setAgreed] = useState(false)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A new enrolment starts clean: the last "is enrolled" notice is done.
  useEffect(() => setNotice(null), [setNotice])

  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      fresh()
      setFailure(null)
      set(v)
    }

  const first = firstName.trim()
  const e164 = toE164Ke(phone)

  const check = (s: Step): Record<string, string> => {
    const e: Record<string, string> = {}
    if (s === 1) {
      if (!first) e.firstName = t('console.farmers.new.errors.firstName')
      if (!lastName.trim()) e.lastName = t('console.farmers.new.errors.lastName')
      if (!e164) e.phone = t('console.farmers.new.errors.phone')
      if (email.trim() && !EMAIL.test(email.trim())) e.email = t('console.farmers.new.errors.email')
    }
    if (s === 2 && !agreed) e.agreed = t('console.farmers.new.errors.agree')
    if (s === 3) {
      if (password.length < FARMER_MIN) e.password = t('console.farmers.new.errors.tooShort')
      else if (new TextEncoder().encode(password).length > BCRYPT_MAX_BYTES)
        e.password = t('console.farmers.new.errors.tooLong')
    }
    return e
  }

  const next = () => {
    const e = check(step)
    setErrors(e)
    if (Object.keys(e).length === 0 && step < 4) setStep((step + 1) as Step)
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!wide && step < 4) return next()
    const all = { ...check(1), ...check(2), ...check(3) }
    setErrors(all)
    setFailure(null)
    if (Object.keys(all).length > 0 || !e164) {
      if (!wide)
        setStep(all.firstName || all.lastName || all.phone || all.email ? 1 : all.agreed ? 2 : 3)
      return
    }
    setBusy(true)
    const name = `${first} ${lastName.trim()}`
    const result = await post('/v2/farmers', {
      first_name: first,
      last_name: lastName.trim(),
      phone: e164,
      email: email.trim() || null,
      address: address.trim() || null,
      number_of_hives: hives > 0 ? hives : null,
      password,
      consent_granted: true,
      consent_text_version: CONSENT_TEXT_VERSION,
    })
    setBusy(false)
    if (result.kind === 'ok') {
      setPassword('')
      const id = Number(result.data.id)
      changed()
      setNotice({ id, text: t('console.farmers.enrolled', { name }) })
      navigate(`/farmers/${id}`)
    } else if (result.kind === 'offline') {
      setFailure(t('console.farmers.new.errors.offline'))
    } else if (result.code === 'phone_taken') {
      setFailure(t('console.farmers.new.errors.taken'))
    } else if (result.code === 'password_too_short') {
      setFailure(t('console.farmers.new.errors.tooShort'))
    } else if (result.code === 'consent_required') {
      setFailure(t('console.farmers.new.errors.agree'))
    } else {
      setFailure(t('console.farmers.new.errors.failed'))
    }
  }

  const Section = ({ n, title, children }: { n: Step; title: string; children: ReactNode }) =>
    shows(n) ? (
      <div className={peopleStyles.form}>
        <h2 className={peopleStyles.h3}>{title}</h2>
        {children}
      </div>
    ) : null

  const agreesLabel = first
    ? t('console.farmers.new.agrees', { name: first })
    : t('console.farmers.new.farmerAgrees')

  return (
    <section className={peopleStyles.pane} aria-labelledby="enrol-title">
      {back && step === 1 ? (
        <button type="button" className={listStyles.back} onClick={() => navigate('/farmers')}>
          <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
          {t('console.farmers.title')}
        </button>
      ) : null}
      <h1 id="enrol-title" className={peopleStyles.h2}>
        {t('console.farmers.new.title')}
      </h1>
      {!wide ? (
        <div className={styles.steps}>
          {step > 1 ? (
            <button
              type="button"
              className={styles.stepBack}
              aria-label={t('console.farmers.new.back')}
              onClick={() => {
                setErrors({})
                setStep((step - 1) as Step)
              }}
            >
              <ChevronLeft aria-hidden="true" size={22} />
            </button>
          ) : (
            <span />
          )}
          <div className={styles.progress}>
            <span>
              {t('console.farmers.new.progress', {
                n: step,
                name: t(`console.farmers.new.steps.${STEP_NAMES[step - 1]}`),
              })}
            </span>
            <span className={styles.track} aria-hidden="true">
              <span style={{ width: `${step * 25}%` }} />
            </span>
          </div>
        </div>
      ) : null}

      <form className={peopleStyles.form} onSubmit={(e) => void submit(e)} noValidate>
        {Section({
          n: 1,
          title: t('console.farmers.new.details'),
          children: (
            <>
              <div className={peopleStyles.g2}>
                <Field label={t('console.farmers.new.firstName')} error={errors.firstName}>
                  {(p) => (
                    <input
                      {...p}
                      autoComplete="off"
                      maxLength={80}
                      value={firstName}
                      onChange={(e) => edit(setFirstName)(e.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('console.farmers.new.lastName')} error={errors.lastName}>
                  {(p) => (
                    <input
                      {...p}
                      autoComplete="off"
                      maxLength={80}
                      value={lastName}
                      onChange={(e) => edit(setLastName)(e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <Field
                label={t('console.farmers.new.phone')}
                hint={t('console.farmers.new.phoneHint')}
                error={errors.phone}
              >
                {(p) => (
                  <input
                    {...p}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    maxLength={20}
                    value={phone}
                    onChange={(e) => edit(setPhone)(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('console.farmers.new.email')} error={errors.email} optional>
                {(p) => (
                  <input
                    {...p}
                    type="email"
                    autoComplete="off"
                    maxLength={254}
                    value={email}
                    onChange={(e) => edit(setEmail)(e.target.value)}
                  />
                )}
              </Field>
              <Field
                label={t('console.farmers.new.address')}
                hint={t('console.farmers.new.addressHint')}
                optional
              >
                {(p) => (
                  <input
                    {...p}
                    autoComplete="off"
                    maxLength={200}
                    value={address}
                    onChange={(e) => edit(setAddress)(e.target.value)}
                  />
                )}
              </Field>
              <Stepper
                label={t('console.farmers.new.hives')}
                value={hives}
                min={0}
                max={2000}
                onChange={edit(setHives)}
              />
              <p className={peopleStyles.small}>{t('console.farmers.new.hivesHint')}</p>
            </>
          ),
        })}

        {Section({
          n: 2,
          title: first
            ? t('console.farmers.new.readTo', { name: first })
            : t('console.farmers.new.readToFarmer'),
          children: (
            <>
              <p className={styles.readaloud}>
                <BookOpenText aria-hidden="true" size={18} strokeWidth={1.75} />
                <span>{t('console.farmers.new.readNote')}</span>
              </p>
              <blockquote className={styles.quote}>{t('consent.agreement')}</blockquote>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={agreed}
                  aria-invalid={errors.agreed ? true : undefined}
                  aria-describedby={errors.agreed ? 'agree-error' : undefined}
                  onChange={(e) => edit(setAgreed)(e.target.checked)}
                />
                <span>{agreesLabel}</span>
              </label>
              {errors.agreed ? (
                <p id="agree-error" className={peopleStyles.error} role="alert">
                  {errors.agreed}
                </p>
              ) : null}
              <p className={peopleStyles.small}>{t('console.farmers.new.agreeNote')}</p>
            </>
          ),
        })}

        {Section({
          n: 3,
          title: t('console.farmers.new.passwordTitle'),
          children: (
            <>
              <p className={peopleStyles.small}>{t('console.farmers.new.passwordNote')}</p>
              <Field label={t('console.farmers.new.password')} error={errors.password}>
                {(p) => (
                  <input
                    {...p}
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => edit(setPassword)(e.target.value)}
                  />
                )}
              </Field>
            </>
          ),
        })}

        {Section({
          n: 4,
          title: t('console.farmers.new.check'),
          children: (
            <>
              <ul className={styles.summary} aria-label={t('console.farmers.new.check')}>
                <Row k="name" v={`${first} ${lastName.trim()}`.trim()} />
                <Row k="phone" v={e164 ? localPhone(e164) : phone.trim()} />
                <Row k="email" v={email.trim() || t('console.farmers.new.noneGiven')} />
                <Row
                  k="hives"
                  v={hives > 0 ? String(hives) : t('console.farmers.new.notCounted')}
                />
                <Row
                  k="agreement"
                  v={t(agreed ? 'console.farmers.new.agreed' : 'console.farmers.new.notAgreed')}
                />
                <Row
                  k="password"
                  v={t(password ? 'console.farmers.new.chosen' : 'console.farmers.new.notChosen')}
                />
              </ul>
              <p className={peopleStyles.small}>{t('console.farmers.new.notKept')}</p>
            </>
          ),
        })}

        {failure ? (
          <p className={peopleStyles.error} role="alert">
            {failure}
          </p>
        ) : null}
        {!wide && step < 4 ? (
          <Button type="submit" className={peopleStyles.save}>
            {t('console.farmers.new.next')}
          </Button>
        ) : online ? (
          <Button type="submit" loading={busy} className={peopleStyles.save}>
            {t('console.farmers.new.save')}
          </Button>
        ) : (
          <Button
            type="button"
            disabled
            icon={<CloudOff aria-hidden="true" size={18} />}
            className={peopleStyles.save}
          >
            {t('console.farmers.new.needsInternet')}
          </Button>
        )}
      </form>
    </section>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  const { t } = useTranslation()
  return (
    <li>
      <span>{t(`console.farmers.new.summary.${k}`)}</span>
      <b>{v}</b>
    </li>
  )
}
