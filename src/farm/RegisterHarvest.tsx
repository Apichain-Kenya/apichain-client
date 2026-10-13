import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { ChevronLeft, Flower2, LocateFixed, Plus, Sprout, TreeDeciduous, Wheat } from 'lucide-react'

import type { Me } from '../auth/SessionContext'
import { harvestDrafts } from '../offline/outbox'
import { Button } from '../ui/Button'
import { ChoiceTiles } from '../ui/ChoiceTiles'
import { DateChips } from '../ui/DateChips'
import { Field } from '../ui/Field'
import { Stepper } from '../ui/Stepper'
import { useWide } from '../ui/useWide'
import { useFarm, type Fix } from './FarmServices'
import styles from './RegisterHarvest.module.css'
import { useFarmData } from './useFarmData'
import { dayLabel } from './dayLabel'

const MapPicker = lazy(() => import('./MapPicker'))

type Honey = 'acacia' | 'wildflower' | 'eucalyptus' | 'sunflower' | 'mixed'
type Method = 'organic' | 'conventional' | 'regenerative'
type Step = 1 | 2 | 3 | 4
const STEP_NAMES = ['where', 'what', 'when', 'check'] as const
const GOOD_ENOUGH_M = 50 // ask to wait for a better fix beyond this (12 §11)

const HONEY_ICONS: Record<Honey, React.ReactNode> = {
  acacia: <TreeDeciduous aria-hidden="true" />,
  wildflower: <Flower2 aria-hidden="true" />,
  eucalyptus: <TreeDeciduous aria-hidden="true" />,
  sunflower: <Sprout aria-hidden="true" />,
  mixed: <Wheat aria-hidden="true" />,
}

// "Register a harvest" (12 §11, approved board). One decision per screen on a
// phone, GPS first with the map only to confirm, and no latitude/longitude
// field anywhere (03 §8.1). Saving commits to the outbox at once, with or
// without a network; the outbox sends it later.
export function RegisterHarvest({ me }: { me: Me }) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const farm = useFarm()
  const { apiaries } = useFarmData(me.user_id, me.farmer_id ?? null)

  // Laptop: all four sections on one page, one Save (12 §4.5). Phone: one
  // decision per screen.
  const wide = useWide()
  const [step, setStep] = useState<Step>(1)
  const shows = (n: Step) => wide || step === n
  const Title = wide ? 'h2' : 'h1'
  const [choice, setChoice] = useState<string | null>(null) // apiary id, or 'new'
  const [fix, setFix] = useState<Fix | null>(null)
  const [pendingFix, setPendingFix] = useState<Fix | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [hives, setHives] = useState(1)
  const [honey, setHoney] = useState<Honey>('acacia')
  const [kg, setKg] = useState(0)
  const [expected, setExpected] = useState(0)
  const [method, setMethod] = useState<Method>('organic')
  const [day, setDay] = useState(farm.today())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const known = apiaries ?? []
  const where = choice ?? (known.length === 0 && apiaries !== null ? 'new' : null)
  const isNew = where === 'new'

  const locate = async () => {
    setLocating(true)
    setLocError(null)
    try {
      const f = await farm.locate()
      if (f.accuracy > GOOD_ENOUGH_M) setPendingFix(f)
      else {
        setFix(f)
        setPendingFix(null)
      }
    } catch (e) {
      const code = (e as { code?: number }).code
      setLocError(code === 1 ? t('farm.where.denied') : t('farm.where.noGps'))
    } finally {
      setLocating(false)
    }
  }

  const validate = (s: Step): Record<string, string> => {
    const e: Record<string, string> = {}
    if (s === 1) {
      if (isNew && !fix) e.location = t('farm.where.needLocation')
      if (isNew && !name.trim()) e.name = t('farm.where.nameRequired')
      if (!where) e.location = t('farm.where.needLocation')
    }
    if (s === 2 && !(kg > 0)) e.kg = t('farm.what.quantityRequired')
    return e
  }

  const goNext = () => {
    const e = validate(step)
    setErrors(e)
    if (Object.keys(e).length === 0 && step < 4) setStep((step + 1) as Step)
  }

  const save = async () => {
    const all = { ...validate(1), ...validate(2) }
    setErrors(all)
    if (Object.keys(all).length > 0 || me.farmer_id == null) return
    setSaving(true)
    const drafts = harvestDrafts({
      farmerId: me.farmer_id,
      ...(isNew
        ? {
            apiary: {
              name: name.trim(),
              latitude: fix!.lat.toFixed(6),
              longitude: fix!.lon.toFixed(6),
              hive_count: hives,
            },
          }
        : { apiaryId: Number(where) }),
      metadata: {
        honey_type: honey,
        expected_yield_kg: (expected || kg).toFixed(2),
        harvest_window_start: day,
        harvest_window_end: day,
        apiary_management_method: method,
      },
      harvest: { harvest_date: day, quantity_kg: kg.toFixed(2), hive_ids: [] },
    })
    const rows = await farm.outbox.enqueue(me.user_id, drafts, farm.now())
    void farm.sync.kick({ force: true })
    navigate(`/saved?id=${rows[rows.length - 1].id}`)
  }

  const apiaryLabel = isNew
    ? t('farm.check.newApiary', { name: name.trim(), count: hives })
    : (known.find((a) => String(a.id) === where)?.name ?? '')

  return (
    <section className={styles.flow}>
      {wide ? <h1 className="serif">{t('farm.register')}</h1> : null}
      <div className={styles.bar} hidden={wide}>
        {step > 1 ? (
          <button
            type="button"
            className={styles.back}
            aria-label={t('farm.steps.back')}
            onClick={() => setStep((step - 1) as Step)}
          >
            <ChevronLeft aria-hidden="true" size={22} />
          </button>
        ) : null}
        <div className={styles.progress}>
          <span>
            {t('farm.steps.progress', { n: step, name: t(`farm.steps.${STEP_NAMES[step - 1]}`) })}
          </span>
          <span className={styles.track} aria-hidden="true">
            <span style={{ width: `${step * 25}%` }} />
          </span>
        </div>
      </div>

      {shows(1) ? (
        <div className={styles.step}>
          <Title className="serif">{t('farm.where.title')}</Title>
          <ChoiceTiles
            legend={known.length ? t('farm.where.pick') : t('farm.where.noneSaved')}
            name="apiary"
            value={where}
            onChange={(v) => {
              setChoice(v)
              setErrors({})
            }}
            options={[
              ...known.map((a) => ({
                value: String(a.id),
                label: a.hive_count
                  ? `${a.name}, ${t('farm.apiaries.hives', { count: a.hive_count })}`
                  : a.name,
              })),
              { value: 'new', label: t('farm.where.new'), icon: <Plus aria-hidden="true" /> },
            ]}
          />
          {isNew ? (
            <>
              <Button
                variant="secondary"
                full
                loading={locating}
                icon={<LocateFixed aria-hidden="true" size={20} />}
                onClick={() => void locate()}
              >
                {locating ? t('farm.where.locating') : t('farm.where.useLocation')}
              </Button>
              {pendingFix ? (
                <div className={styles.note} role="status">
                  <p>{t('farm.where.waitBetter', { m: Math.round(pendingFix.accuracy) })}</p>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setFix(pendingFix)
                      setPendingFix(null)
                    }}
                  >
                    {t('farm.where.useAnyway')}
                  </Button>
                </div>
              ) : null}
              {locError ? (
                <p className={styles.error} role="alert">
                  {locError}
                </p>
              ) : null}
              {fix ? (
                <>
                  {farm.online() ? (
                    <Suspense fallback={<div className={styles.offlineMap} />}>
                      <MapPicker fix={fix} onMove={setFix} label={t('farm.where.drag')} />
                    </Suspense>
                  ) : (
                    <div className={styles.offlineMap}>
                      <p>{t('farm.where.mapOffline')}</p>
                    </div>
                  )}
                  <p className={styles.gps}>
                    {t('farm.where.accuracy', { m: Math.round(fix.accuracy) })}
                    {farm.online() ? ` ${t('farm.where.drag')}` : ''}
                  </p>
                </>
              ) : null}
              {errors.location ? (
                <p className={styles.error} role="alert">
                  {errors.location}
                </p>
              ) : null}
              <Field
                label={t('farm.where.name')}
                hint={t('farm.where.nameHint')}
                error={errors.name}
              >
                {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} />}
              </Field>
              <Stepper
                label={t('farm.where.hives')}
                value={hives}
                min={1}
                max={2000}
                onChange={setHives}
              />
            </>
          ) : errors.location ? (
            <p className={styles.error} role="alert">
              {errors.location}
            </p>
          ) : null}
        </div>
      ) : null}

      {shows(2) ? (
        <div className={styles.step}>
          <Title className="serif">{t('farm.what.title')}</Title>
          <ChoiceTiles<Honey>
            legend={t('farm.what.honey')}
            name="honey"
            value={honey}
            onChange={setHoney}
            options={(Object.keys(HONEY_ICONS) as Honey[]).map((h) => ({
              value: h,
              label: t(`scan.honey.${h}`),
              icon: HONEY_ICONS[h],
            }))}
          />
          <KgInput label={t('farm.what.harvested')} value={kg} onChange={setKg} error={errors.kg} />
          <KgInput label={t('farm.what.expected')} value={expected} onChange={setExpected} />
          <ChoiceTiles<Method>
            legend={t('farm.what.method')}
            name="method"
            value={method}
            onChange={setMethod}
            options={(['organic', 'conventional', 'regenerative'] as Method[]).map((m) => ({
              value: m,
              label: t(`farm.what.methods.${m}`),
            }))}
          />
        </div>
      ) : null}

      {shows(3) ? (
        <div className={styles.step}>
          <Title className="serif">{t('farm.when.title')}</Title>
          <DateChips
            legend={t('farm.when.legend')}
            value={day}
            today={farm.today()}
            onChange={setDay}
          />
        </div>
      ) : null}

      {shows(4) ? (
        <div className={styles.step}>
          <Title className="serif">{t('farm.check.title')}</Title>
          <dl className={styles.summary}>
            <div>
              <dt>{t('farm.check.apiary')}</dt>
              <dd>{apiaryLabel}</dd>
            </div>
            <div>
              <dt>{t('farm.check.honey')}</dt>
              <dd>{t(`scan.honey.${honey}`)}</dd>
            </div>
            <div>
              <dt>{t('farm.check.harvested')}</dt>
              <dd>{t('farm.check.kgOn', { kg, day: dayLabel(day, farm.today(), t) })}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className={styles.actions}>
        {step < 4 && !wide ? (
          <Button full onClick={goNext}>
            {t('farm.steps.next')}
          </Button>
        ) : (
          <Button full loading={saving} onClick={() => void save()}>
            {t('farm.check.save')}
          </Button>
        )}
      </div>
    </section>
  )
}

// Kilograms take decimals, so this is a labelled decimal field rather than a
// stepper (a stepper of 0.01 kg would be useless to a thumb). It keeps the
// typed text, so "12." survives on the way to "12.5".
function KgInput({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  error?: string
}) {
  const [text, setText] = useState(value === 0 ? '' : String(value))
  return (
    <Field label={label} error={error}>
      {(p) => (
        <input
          {...p}
          role="spinbutton"
          aria-valuenow={value}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.')
            if (!/^\d*\.?\d{0,2}$/.test(raw)) return
            setText(raw)
            const n = Number(raw)
            onChange(Number.isFinite(n) ? n : 0)
          }}
        />
      )}
    </Field>
  )
}
