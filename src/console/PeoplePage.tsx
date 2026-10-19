import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'
import { AlertCircle, ArrowLeft, Plus } from 'lucide-react'

import type { components } from '../api/client/schema'
import type { Me } from '../auth/SessionContext'
import { Button } from '../ui/Button'
import { ChoiceTiles } from '../ui/ChoiceTiles'
import { Field } from '../ui/Field'
import { useWide } from '../ui/useWide'
import listStyles from './BatchesPage.module.css'
import styles from './PeoplePage.module.css'
import { usePress } from './usePress'
import { useRead } from './useRead'

type UserOut = components['schemas']['UserOut']
type UserPage = components['schemas']['UserPage']
type StaffRole = UserOut['role']

// The backend's own rules (`users.py`, `password_policy`), checked before the
// request so a typo is caught at the form.
const USERNAME = /^[a-z][a-z0-9._-]{2,39}$/
const STAFF_MIN = 15
const BCRYPT_MAX_BYTES = 72
const ALL = '/v2/users?limit=100'

// People (13 §8 item 5, D2): one account per person and one role per
// account, admin only and online only. An admin adds a person with a starting
// password, which that person must replace at first sign-in (D5). There is no
// role change: someone who changes jobs gets a new account.
export function PeoplePage({
  me,
  id,
  notice,
  setNotice,
}: {
  me: Me
  id: number | 'new' | null
  notice: string | null
  setNotice: (n: string | null) => void
}) {
  const { t } = useTranslation()
  const wide = useWide()
  const [reload, setReload] = useState(0)
  const changed = () => setReload((n) => n + 1)
  const pane =
    id === 'new' ? (
      <AddPerson me={me} back={!wide} setNotice={setNotice} changed={changed} />
    ) : id !== null ? (
      <Person key={id} id={id} back={!wide} reload={reload} changed={changed} />
    ) : null
  if (!wide && pane) return pane
  return (
    <div className={wide ? listStyles.split : undefined}>
      <PeopleList selected={id} reload={reload} notice={notice} />
      {wide ? (pane ?? <p className={listStyles.pick}>{t('console.people.pick')}</p>) : null}
    </div>
  )
}

function status(u: UserOut): 'inactive' | 'mustChange' | 'active' {
  return !u.is_active ? 'inactive' : u.must_change_password ? 'mustChange' : 'active'
}

function PeopleList({
  selected,
  reload,
  notice,
}: {
  selected: number | 'new' | null
  reload: number
  notice: string | null
}) {
  const { t } = useTranslation()
  const [activeOnly, setActiveOnly] = useState(true)
  const page = useRead<UserPage>(activeOnly ? `${ALL}&active=true` : ALL, reload)
  return (
    <section className={listStyles.list} aria-labelledby="people-title">
      <div className={styles.head}>
        <h1 id="people-title" className={listStyles.h1}>
          {t('console.people.title')}
        </h1>
        <Link href="/people/new" className={styles.add}>
          <Plus aria-hidden="true" size={18} strokeWidth={2} />
          {t('console.people.add')}
        </Link>
      </div>
      {notice ? (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      ) : null}
      <div className={listStyles.chips} role="group" aria-label={t('console.people.filter')}>
        {([true, false] as const).map((on) => (
          <button
            key={String(on)}
            type="button"
            className={listStyles.chip}
            aria-pressed={activeOnly === on}
            onClick={() => setActiveOnly(on)}
          >
            {t(on ? 'console.people.active' : 'console.people.all')}
          </button>
        ))}
      </div>
      {page.status === 'loading' ? (
        <p className={listStyles.status} role="status">
          {t('app.loading')}
        </p>
      ) : page.status === 'offline' ? (
        <p className={listStyles.status} role="status">
          {t('console.offline')}
        </p>
      ) : page.status === 'error' ? (
        <p className={listStyles.status} role="alert">
          {t('console.loadFailed')}
        </p>
      ) : page.data.items.length === 0 ? (
        <p className={listStyles.status}>{t('console.people.none')}</p>
      ) : (
        <ul className={listStyles.rows}>
          {page.data.items.map((u) => (
            <li key={u.id}>
              <Link
                href={`/people/${u.id}`}
                className={
                  u.id === selected ? `${listStyles.row} ${listStyles.selected}` : listStyles.row
                }
                aria-current={u.id === selected ? 'page' : undefined}
              >
                <span className={styles.name}>{u.full_name ?? u.username}</span>
                <span className={`${styles.tag} ${styles[status(u)]}`}>
                  {t(`console.people.status.${status(u)}`)}
                </span>
                <span className={listStyles.sub}>
                  {t('console.people.row', {
                    username: u.username,
                    role: t(`console.roles.${u.role}`),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Back() {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  return (
    <button type="button" className={listStyles.back} onClick={() => navigate('/people')}>
      <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
      {t('console.people.title')}
    </button>
  )
}

function passwordError(
  t: (k: string, o?: Record<string, unknown>) => string,
  pw: string,
  min = STAFF_MIN,
): string | undefined {
  if (pw.length < min) return t('console.people.errors.tooShort', { min })
  if (new TextEncoder().encode(pw).length > BCRYPT_MAX_BYTES)
    return t('console.people.errors.tooLong')
  return undefined
}

function AddPerson({
  me,
  back,
  setNotice,
  changed,
}: {
  me: Me
  back: boolean
  setNotice: (n: string | null) => void
  changed: () => void
}) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const { post, fresh } = usePress()
  // A new add starts clean: the last "Added …" notice is for the list.
  useEffect(() => setNotice(null), [setNotice])
  // Only the first admin may add another admin. /me does not say who that
  // is, so read it from the admins list; until it says so, "Admin" is hidden.
  const admins = useRead<UserPage>('/v2/users?role=admin&limit=100')
  const isRoot =
    admins.status === 'ok' && admins.data.items.some((u) => u.id === me.user_id && u.is_root)
  const roles: StaffRole[] = [
    'field_officer',
    'operator',
    'lab_officer',
    ...(isRoot ? (['admin'] as const) : []),
  ]

  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [role, setRole] = useState<StaffRole | null>(null)
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      fresh()
      set(v)
    }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (!fullName.trim()) next.fullName = t('console.people.errors.name')
    if (!USERNAME.test(username)) next.username = t('console.people.errors.username')
    if (!role) next.role = t('console.people.errors.role')
    const pw = passwordError(t, password)
    if (pw) next.password = pw
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0 || !role) return
    setBusy(true)
    const name = fullName.trim()
    const result = await post('/v2/users', { username, full_name: name, role, password })
    setBusy(false)
    if (result.kind === 'ok') {
      setPassword('')
      setNotice(t('console.people.added', { name }))
      changed()
      navigate('/people')
    } else if (result.kind === 'offline') {
      setFailure(t('console.people.errors.offline'))
    } else if (result.code === 'username_taken') {
      setErrors({ username: t('console.people.errors.taken') })
    } else if (result.code === 'password_too_short') {
      setErrors({ password: t('console.people.errors.tooShort', { min: STAFF_MIN }) })
    } else if (result.code === 'password_too_long') {
      setErrors({ password: t('console.people.errors.tooLong') })
    } else {
      setFailure(
        t(
          result.code === 'root_required'
            ? 'console.people.errors.rootRequired'
            : 'console.people.errors.failed',
        ),
      )
    }
  }

  return (
    <section className={styles.pane} aria-labelledby="add-title">
      {back ? <Back /> : null}
      <h2 id="add-title" className={styles.h2}>
        {t('console.people.add')}
      </h2>
      <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <div className={styles.g2}>
          <Field
            label={t('console.people.form.fullName')}
            hint={t('console.people.form.fullNameHint')}
            error={errors.fullName}
          >
            {(p) => (
              <input
                {...p}
                autoComplete="off"
                maxLength={120}
                value={fullName}
                onChange={(e) => edit(setFullName)(e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('console.people.form.username')}
            hint={t('console.people.form.usernameHint')}
            error={errors.username}
          >
            {(p) => (
              <input
                {...p}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={40}
                value={username}
                onChange={(e) => edit(setUsername)(e.target.value)}
              />
            )}
          </Field>
        </div>
        <ChoiceTiles<StaffRole>
          legend={t('console.people.form.role')}
          name="role"
          value={role}
          options={roles.map((r) => ({ value: r, label: t(`console.people.roles.${r}`) }))}
          onChange={edit(setRole)}
        />
        {errors.role ? (
          <p className={styles.error} role="alert">
            {errors.role}
          </p>
        ) : null}
        {!isRoot ? <p className={styles.small}>{t('console.people.form.rootOnly')}</p> : null}
        <Field
          label={t('console.people.form.password')}
          hint={t('console.people.form.passwordHint')}
          error={errors.password}
        >
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
        {failure ? (
          <p className={styles.error} role="alert">
            {failure}
          </p>
        ) : null}
        <Button type="submit" loading={busy} className={styles.save}>
          {t('console.people.form.save')}
        </Button>
        <p className={styles.small}>{t('console.people.form.online')}</p>
      </form>
    </section>
  )
}

const DEACTIVATE_REFUSALS: Record<string, string> = {
  root_protected: 'console.people.person.deactivate.root',
  cannot_deactivate_self: 'console.people.person.deactivate.self',
  last_admin: 'console.people.person.deactivate.last',
}
const RESET_REFUSALS: Record<string, string> = {
  reset_own_password: 'console.people.person.reset.own',
  root_protected: 'console.people.person.reset.root',
  root_required: 'console.people.person.reset.rootRequired',
  password_too_short: 'console.people.errors.tooShort',
  password_too_long: 'console.people.errors.tooLong',
}

function Person({
  id,
  back,
  reload,
  changed,
}: {
  id: number
  back: boolean
  reload: number
  changed: () => void
}) {
  const { t } = useTranslation()
  const read = useRead<UserPage>(ALL, reload)
  const person = read.status === 'ok' ? read.data.items.find((u) => u.id === id) : undefined

  return (
    <section className={styles.pane} aria-labelledby="person-title">
      {back ? <Back /> : null}
      {read.status === 'loading' ? (
        <p role="status">{t('app.loading')}</p>
      ) : read.status === 'offline' ? (
        <p role="status">{t('console.offline')}</p>
      ) : read.status === 'error' ? (
        <p role="alert">{t('console.loadFailed')}</p>
      ) : !person ? (
        <p role="alert">{t('console.people.person.notFound')}</p>
      ) : (
        <>
          <header className={styles.personHead}>
            <h2 id="person-title" className={styles.h2}>
              {person.full_name ?? person.username}
            </h2>
            <span className={`${styles.tag} ${styles[status(person)]}`}>
              {t(`console.people.status.${status(person)}`)}
            </span>
            <p className={styles.small}>
              {[
                t('console.people.row', {
                  username: person.username,
                  role: t(`console.roles.${person.role}`),
                }),
                person.is_root ? t('console.people.person.first') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </header>
          <ResetPassword id={id} changed={changed} />
          {person.is_active ? <Deactivate id={id} changed={changed} /> : null}
        </>
      )}
    </section>
  )
}

/** A new starting password for someone else (D5). A farmer's minimum is 8,
 *  so the farmer page passes its own (board call 5). */
export function ResetPassword({
  id,
  changed,
  min = STAFF_MIN,
  note = 'console.people.person.reset.note',
}: {
  id: number
  changed: () => void
  min?: number
  note?: string
}) {
  const { t } = useTranslation()
  const { post, fresh } = usePress()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setDone(false)
    // The rule is the target's: 15 for staff, 8 for a farmer (D16).
    const bad = passwordError(t, password, min)
    setError(bad)
    if (bad) return
    setBusy(true)
    const result = await post(`/v2/users/${id}/reset-password`, { password })
    setBusy(false)
    if (result.kind === 'ok') {
      setPassword('')
      setDone(true)
      changed()
    } else if (result.kind === 'offline') {
      setError(t('console.people.person.reset.offline'))
    } else {
      setError(t(RESET_REFUSALS[result.code ?? ''] ?? 'console.people.errors.failed', { min }))
    }
  }

  return (
    <form className={styles.block} onSubmit={(e) => void submit(e)} noValidate>
      <h3 className={styles.h3}>{t('console.people.person.reset.title')}</h3>
      <p className={styles.small}>{t(note)}</p>
      <Field label={t('console.people.person.reset.password')} error={error}>
        {(p) => (
          <input
            {...p}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => {
              fresh()
              setPassword(e.target.value)
            }}
          />
        )}
      </Field>
      <Button type="submit" variant="secondary" loading={busy} className={styles.save}>
        {t('console.people.person.reset.save')}
      </Button>
      {done ? (
        <p className={styles.notice} role="status">
          {t('console.people.person.reset.done')}
        </p>
      ) : null}
    </form>
  )
}

function Deactivate({ id, changed }: { id: number; changed: () => void }) {
  const { t } = useTranslation()
  const { post } = usePress()
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    setRefusal(null)
    const result = await post(`/v2/users/${id}/deactivate`, {})
    setBusy(false)
    setConfirming(false)
    if (result.kind === 'ok') changed()
    else if (result.kind === 'offline') setRefusal(t('console.people.person.deactivate.offline'))
    else setRefusal(t(DEACTIVATE_REFUSALS[result.code ?? ''] ?? 'console.people.errors.failed'))
  }

  return (
    <div className={styles.block}>
      <h3 className={styles.h3}>{t('console.people.person.deactivate.title')}</h3>
      <p className={styles.small}>{t('console.people.person.deactivate.note')}</p>
      {confirming ? (
        <div className={styles.row}>
          <Button variant="primary" loading={busy} onClick={() => void go()}>
            {t('console.people.person.deactivate.confirm')}
          </Button>
          <Button variant="quiet" onClick={() => setConfirming(false)}>
            {t('console.people.person.deactivate.cancel')}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className={styles.save} onClick={() => setConfirming(true)}>
          {t('console.people.person.deactivate.start')}
        </Button>
      )}
      {refusal ? (
        <div className={styles.refusal} role="alert">
          <p className={styles.refusalTitle}>
            <AlertCircle aria-hidden="true" size={18} strokeWidth={2} />
            {t('console.people.person.deactivate.refused')}
          </p>
          <p>{refusal}</p>
        </div>
      ) : null}
    </div>
  )
}
