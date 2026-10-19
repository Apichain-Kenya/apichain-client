import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'wouter'
import { ArrowLeft, LocateFixed } from 'lucide-react'

import { useOutbox } from '../app/useOutbox'
import type { Me } from '../auth/SessionContext'
import type { Fix } from '../farm/FarmServices'
import { locate } from '../farm/locate'
import { apiaryDraft } from '../offline/outbox'
import { Button } from '../ui/Button'
import { ChunkBoundary } from '../ui/ChunkBoundary'
import { Field } from '../ui/Field'
import { Stepper } from '../ui/Stepper'
import { useOnline } from '../ui/useOnline'
import listStyles from './BatchesPage.module.css'
import type { FarmerDetail } from './farmers'
import styles from './FarmersPage.module.css'
import peopleStyles from './PeoplePage.module.css'
import { useRead } from './useRead'

// The 4a map, still its own lazy chunk: never in the console's first load.
const MapPicker = lazy(() => import('../farm/MapPicker'))
const GOOD_ENOUGH_M = 50 // as the farmer app (12 §11)

// "Add an apiary" for a farmer (13 §9 item 7): the farmer app's GPS-first
// capture, standing at the hives with the farmer. It saves through the outbox
// as `apiary.create` with the farmer's id, so it works with no signal.
export function AddApiary({ me, id }: { me: Me; id: number }) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const online = useOnline()
  const { outbox, sync } = useOutbox()
  const farmer = useRead<FarmerDetail>(`/v2/farmers/${id}`)
  const [fix, setFix] = useState<Fix | null>(null)
  const [pendingFix, setPendingFix] = useState<Fix | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [hives, setHives] = useState(1)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const find = async () => {
    setLocating(true)
    setLocError(null)
    try {
      const f = await locate()
      if (f.accuracy > GOOD_ENOUGH_M) setPendingFix(f)
      else {
        setFix(f)
        setPendingFix(null)
      }
    } catch (e) {
      const code = (e as { code?: number }).code
      setLocError(
        t(
          code === 1 ? 'farm.where.denied' : code === 3 ? 'farm.where.timeout' : 'farm.where.noGps',
        ),
      )
    } finally {
      setLocating(false)
    }
  }

  const save = async () => {
    const e: Record<string, string> = {}
    if (!fix) e.location = t('farm.where.needLocation')
    if (!name.trim()) e.name = t('farm.where.nameRequired')
    setErrors(e)
    if (!fix || Object.keys(e).length > 0) return
    setSaving(true)
    await outbox.enqueue(
      me.user_id,
      [
        apiaryDraft(id, {
          name: name.trim(),
          latitude: fix.lat.toFixed(6),
          longitude: fix.lon.toFixed(6),
          hive_count: hives,
        }),
      ],
      Date.now(),
    )
    void sync.kick({ force: true })
    navigate(`/farmers/${id}`)
  }

  return (
    <section className={peopleStyles.pane} aria-labelledby="apiary-title">
      <button type="button" className={listStyles.back} onClick={() => navigate(`/farmers/${id}`)}>
        <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
        {farmer.status === 'ok' ? farmer.data.display_name : t('console.farmers.title')}
      </button>
      <h1 id="apiary-title" className={peopleStyles.h2}>
        {t('console.farmers.apiary.title')}
      </h1>
      {farmer.status === 'ok' ? (
        <p className={peopleStyles.small}>
          {t('console.farmers.apiary.for', { name: farmer.data.display_name })}
        </p>
      ) : null}
      <div className={peopleStyles.form}>
        <Button
          variant="secondary"
          className={peopleStyles.save}
          loading={locating}
          icon={<LocateFixed aria-hidden="true" size={20} />}
          onClick={() => void find()}
        >
          {locating ? t('farm.where.locating') : t('farm.where.useLocation')}
        </Button>
        {pendingFix ? (
          <div role="status">
            <p className={peopleStyles.small}>
              {t('farm.where.waitBetter', { m: Math.round(pendingFix.accuracy) })}
            </p>
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
          <p className={peopleStyles.error} role="alert">
            {locError}
          </p>
        ) : null}
        {fix ? (
          <>
            {online ? (
              <ChunkBoundary
                fallback={
                  <div className={styles.mapOff}>
                    <p>{t('farm.where.mapFailed')}</p>
                  </div>
                }
              >
                <Suspense fallback={<div className={styles.mapOff} />}>
                  <MapPicker fix={fix} onMove={setFix} label={t('farm.where.drag')} />
                </Suspense>
              </ChunkBoundary>
            ) : (
              <div className={styles.mapOff}>
                <p>{t('farm.where.mapOffline')}</p>
              </div>
            )}
            <p className={styles.gps}>
              {t('farm.where.accuracy', { m: Math.round(fix.accuracy) })}
              {online ? ` ${t('farm.where.drag')}` : ''}
            </p>
          </>
        ) : null}
        {errors.location ? (
          <p className={peopleStyles.error} role="alert">
            {errors.location}
          </p>
        ) : null}
        <Field
          label={t('console.farmers.apiary.name')}
          hint={t('console.farmers.apiary.nameHint')}
          error={errors.name}
        >
          {(p) => (
            <input {...p} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Stepper
          label={t('farm.where.hives')}
          value={hives}
          min={1}
          max={2000}
          onChange={setHives}
        />
        <Button className={peopleStyles.save} loading={saving} onClick={() => void save()}>
          {t('console.farmers.apiary.save')}
        </Button>
      </div>
    </section>
  )
}
