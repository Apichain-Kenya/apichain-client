import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '../ui/Button'
import { ChoiceTiles } from '../ui/ChoiceTiles'
import { DateChips } from '../ui/DateChips'
import { Field } from '../ui/Field'
import { Stepper } from '../ui/Stepper'
import styles from './NextStep.module.css'

type Json = Record<string, unknown>
export type FormProps = { onSave: (body: Json) => Promise<void>; note?: ReactNode }

// The four staff forms (13 §8 item 2). Each asks only for what the backend
// takes, and leaves out a field nobody filled in. Every check here mirrors one
// the server makes, so a mistake is caught while the person is still at the
// form, not later as a refused action in the outbox.

/** A measurement as typed ("18,4" is fine), or why it is not one. */
function measure(raw: string, pct: boolean): { value?: string; error?: string } {
  const text = raw.trim().replace(',', '.')
  if (!text) return {}
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: 'invalid' }
  if ((text.split('.')[1] ?? '').length > 2) return { error: 'decimals' }
  if (Number(text) > (pct ? 100 : 99_999_999.99)) return { error: 'range' }
  return { value: text }
}

/** Optional free text: trimmed, and absent when empty. */
function words(body: Json, key: string, raw: string) {
  const text = raw.trim()
  if (text) body[key] = text
}

function Form({
  onSave,
  check,
  save,
  note,
  children,
}: {
  onSave: () => Promise<void>
  check: () => boolean
  save: string
  note?: ReactNode
  children: ReactNode
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !check()) return
    setBusy(true)
    try {
      await onSave()
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
      {note}
      {children}
      <Button type="submit" loading={busy} className={styles.save}>
        {save}
      </Button>
      <p className={styles.small}>{t('console.next.savesHere')}</p>
    </form>
  )
}

const METHODS = ['centrifugal', 'crush_and_strain', 'cold_extraction', 'other'] as const
type Method = (typeof METHODS)[number]

export function ProcessForm({ onSave, note }: FormProps) {
  const { t } = useTranslation()
  const [method, setMethod] = useState<Method>('centrifugal')
  const [other, setOther] = useState('')
  const [moisture, setMoisture] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const m = measure(moisture, true)

  const check = () => {
    const next: Record<string, string> = {}
    if (method === 'other' && !other.trim()) next.other = t('console.forms.process.otherMissing')
    if (m.error) next.moisture = t(`console.forms.number.${m.error}`)
    setErrors(next)
    return Object.keys(next).length === 0
  }
  const save = () => {
    const body: Json = { extraction_method: method === 'other' ? other.trim() : method }
    if (m.value) body.moisture_content = m.value
    words(body, 'handling_notes', notes)
    return onSave(body)
  }
  return (
    <Form onSave={save} check={check} save={t('console.forms.process.save')} note={note}>
      <ChoiceTiles<Method>
        legend={t('console.forms.process.method')}
        name="extraction_method"
        value={method}
        options={METHODS.map((v) => ({ value: v, label: t(`console.forms.process.${v}`) }))}
        onChange={setMethod}
      />
      {method === 'other' ? (
        <Field label={t('console.forms.process.otherText')} error={errors.other}>
          {(p) => <input {...p} value={other} onChange={(e) => setOther(e.target.value)} />}
        </Field>
      ) : null}
      <Field label={t('console.forms.process.moisture')} error={errors.moisture} optional>
        {(p) => (
          <input
            {...p}
            inputMode="decimal"
            autoComplete="off"
            value={moisture}
            onChange={(e) => setMoisture(e.target.value)}
          />
        )}
      </Field>
      <Field label={t('console.forms.process.notes')} optional>
        {(p) => (
          <textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
    </Form>
  )
}

// The seven measurements the backend names, each with its unit (02 R9). A
// percentage or g/100 g cannot pass 100.
const MEASURES = [
  ['moisture_pct', true],
  ['hmf_mg_kg', false],
  ['fructose_glucose_g_100g', true],
  ['sucrose_g_100g', true],
  ['diastase_schade', false],
  ['free_acidity_meq_kg', false],
  ['pollen_density', false],
] as const
type Measure = (typeof MEASURES)[number][0]
const ABOUT = ['laboratory_name', 'analyst_name', 'certificate_number'] as const

export function LabForm({ onSave, note, today }: FormProps & { today: string }) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Record<string, string>>({})
  const [tested, setTested] = useState(today)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [swapped, setSwapped] = useState(false)
  const set = (key: string) => (v: string) => setValues((s) => ({ ...s, [key]: v }))

  const check = () => {
    const next: Record<string, string> = {}
    for (const [key, pct] of MEASURES) {
      const r = measure(values[key] ?? '', pct)
      if (r.error) next[key] = t(`console.forms.number.${r.error}`)
    }
    // The server's one cross-field rule (`_sugars_are_not_transposed`): no
    // honey has more sucrose than fructose + glucose, so the boxes are swapped.
    const s = measure(values.sucrose_g_100g ?? '', true).value
    const fg = measure(values.fructose_glucose_g_100g ?? '', true).value
    const swap = s !== undefined && fg !== undefined && Number(s) > Number(fg)
    if (swap && !next.sucrose_g_100g) next.sucrose_g_100g = t('console.forms.lab.swapped')
    setSwapped(swap)
    setErrors(next)
    return Object.keys(next).length === 0
  }
  const save = () => {
    const body: Json = {}
    for (const [key, pct] of MEASURES) {
      const v = measure(values[key] ?? '', pct).value
      if (v !== undefined) body[key] = v
    }
    for (const key of ABOUT) words(body, key, values[key] ?? '')
    body.tested_at = tested // the declared day, as YYYY-MM-DD (13 §0 #10)
    words(body, 'notes', values.notes ?? '')
    return onSave(body)
  }
  const measureField = (name: Measure) => (
    <Field
      key={name}
      label={t(`console.forms.lab.${name}`)}
      error={errors[name]}
      invalid={swapped && name === 'fructose_glucose_g_100g'}
    >
      {(p) => (
        <input
          {...p}
          inputMode="decimal"
          autoComplete="off"
          value={values[name] ?? ''}
          onChange={(e) => set(name)(e.target.value)}
        />
      )}
    </Field>
  )
  return (
    <Form onSave={save} check={check} save={t('console.forms.lab.save')} note={note}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('console.forms.lab.measurements')}</legend>
        <p className={styles.small}>{t('console.forms.lab.blank')}</p>
        <div className={styles.g2}>{MEASURES.map(([key]) => measureField(key))}</div>
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('console.forms.lab.test')}</legend>
        {ABOUT.map((key) => (
          <Field key={key} label={t(`console.forms.lab.${key}`)} optional>
            {(p) => (
              <input {...p} value={values[key] ?? ''} onChange={(e) => set(key)(e.target.value)} />
            )}
          </Field>
        ))}
        <DateChips
          legend={t('console.forms.lab.tested')}
          value={tested}
          today={today}
          onChange={setTested}
        />
        <Field label={t('console.forms.lab.notes')} optional>
          {(p) => (
            <textarea
              {...p}
              rows={2}
              value={values.notes ?? ''}
              onChange={(e) => set('notes')(e.target.value)}
            />
          )}
        </Field>
      </fieldset>
    </Form>
  )
}

export function PackageForm({ onSave, note }: FormProps) {
  const { t } = useTranslation()
  const [jars, setJars] = useState(0)
  const [ids, setIds] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | undefined>()

  const check = () => {
    const bad = jars < 1 ? t('console.forms.package.none') : undefined
    setError(bad)
    return !bad
  }
  const save = () => {
    const body: Json = { unit_count: jars, jar_ids: ids.split(/[\s,]+/).filter(Boolean) }
    words(body, 'notes', notes)
    return onSave(body)
  }
  return (
    <Form onSave={save} check={check} save={t('console.forms.package.save')} note={note}>
      <Stepper
        label={t('console.forms.package.jars')}
        value={jars}
        onChange={setJars}
        max={100_000}
      />
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <Field
        label={t('console.forms.package.jarIds')}
        hint={t('console.forms.package.jarIdsHint')}
        optional
      >
        {(p) => <input {...p} value={ids} onChange={(e) => setIds(e.target.value)} />}
      </Field>
      <Field label={t('console.forms.package.notes')} optional>
        {(p) => (
          <textarea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        )}
      </Field>
    </Form>
  )
}

export function DistributeForm({ onSave, note }: FormProps) {
  const { t } = useTranslation()
  const [retailer, setRetailer] = useState('')
  const [transport, setTransport] = useState('')
  const [handover, setHandover] = useState('')
  const [error, setError] = useState<string | undefined>()

  const check = () => {
    const bad = retailer.trim() ? undefined : t('console.forms.distribute.retailerMissing')
    setError(bad)
    return !bad
  }
  const save = () => {
    const body: Json = { retailer_name: retailer.trim() }
    words(body, 'transport_reference', transport)
    words(body, 'handover_notes', handover)
    return onSave(body)
  }
  return (
    <Form onSave={save} check={check} save={t('console.forms.distribute.save')} note={note}>
      <Field label={t('console.forms.distribute.retailer')} error={error}>
        {(p) => <input {...p} value={retailer} onChange={(e) => setRetailer(e.target.value)} />}
      </Field>
      <div className={styles.g2}>
        <Field label={t('console.forms.distribute.transport')} optional>
          {(p) => <input {...p} value={transport} onChange={(e) => setTransport(e.target.value)} />}
        </Field>
        <Field label={t('console.forms.distribute.handover')} optional>
          {(p) => <input {...p} value={handover} onChange={(e) => setHandover(e.target.value)} />}
        </Field>
      </div>
    </Form>
  )
}
