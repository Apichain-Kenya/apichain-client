import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { Plus } from 'lucide-react'

import type { Me } from '../auth/SessionContext'
import type { ActionRecord } from '../offline/outbox'
import { Button } from '../ui/Button'
import { SyncBadge } from '../ui/Sync'
import { dayLabel, localDay } from './dayLabel'
import { useFarm } from './FarmServices'
import styles from './HarvestsPage.module.css'
import { useFarmData, type Apiary } from './useFarmData'

const HEX = 'M32 3 L60 19 L60 53 L32 69 L4 53 L4 19 Z'

function greetingKey(hour: number) {
  if (hour < 12) return 'farm.greeting.morning'
  if (hour < 17) return 'farm.greeting.afternoon'
  return 'farm.greeting.evening'
}

type Unsent = { harvest: ActionRecord; batch?: ActionRecord; apiary?: ActionRecord }

/** One saved-but-unsent harvest = its batch.harvest action plus the actions it depends on. */
function unsentHarvests(actions: ActionRecord[]): Unsent[] {
  const byRef = new Map(actions.map((a) => [a.local_ref, a]))
  return actions
    .filter((a) => a.kind === 'batch.harvest' && a.status !== 'sent')
    .sort((a, b) => b.seq - a.seq)
    .map((harvest) => {
      const batch = byRef.get(harvest.depends_on[0])
      const apiary = batch?.depends_on[0] ? byRef.get(batch.depends_on[0]) : undefined
      return { harvest, batch, apiary }
    })
}

// My harvests (approved board): what is on this phone, what was sent, and one
// big way to register the next. Offline after a reload it still shows the
// unsent harvests and the last list the server sent.
export function HarvestsPage({ me }: { me: Me }) {
  const { t } = useTranslation()
  const farm = useFarm()
  const { apiaries, batches, actions, fresh } = useFarmData(me.user_id, me.farmer_id ?? null)
  const unsent = unsentHarvests(actions)
  const name = me.display_name.split(' ')[0]
  const today = farm.today()

  return (
    <section className={styles.page}>
      <h1 className="serif">{t(greetingKey(new Date(farm.now()).getHours()), { name })}</h1>
      <Link href="/register" className={styles.register}>
        <Plus aria-hidden="true" size={20} />
        {t('farm.register')}
      </Link>

      <h2 className={styles.title}>{t('farm.harvests.title')}</h2>
      {unsent.length === 0 && (batches?.length ?? 0) === 0 && apiaries !== null ? (
        <p className={styles.empty}>{t('farm.harvests.empty')}</p>
      ) : null}
      <ul className={styles.list}>
        {unsent.map((u) => (
          <UnsentRow key={u.harvest.id} unsent={u} apiaries={apiaries ?? []} today={today} />
        ))}
        {(batches ?? []).map((b) => (
          <li key={b.id} className={styles.card}>
            <svg className={styles.cell} viewBox="0 0 64 72" aria-hidden="true">
              <path d={HEX} className={styles.cellSent} />
            </svg>
            <div className={styles.text}>
              <span className={styles.what}>
                {b.honey_type
                  ? t(`scan.honey.${b.honey_type}`, { defaultValue: b.honey_type })
                  : b.batch_code}
              </span>
              <span className={styles.sub}>
                {b.apiary_name}, {dayLabel(localDay(b.created_at), today, t)}
              </span>
              <SyncBadge
                status="sent"
                label={t('farm.harvests.sentNow', { state: t(`farm.harvests.states.${b.state}`) })}
              />
            </div>
          </li>
        ))}
      </ul>
      {!fresh && unsent.length > 0 && !farm.online() ? (
        <p className={styles.empty}>{t('farm.harvests.offlineList')}</p>
      ) : null}
    </section>
  )
}

function UnsentRow({
  unsent,
  apiaries,
  today,
}: {
  unsent: Unsent
  apiaries: Apiary[]
  today: string
}) {
  const { t } = useTranslation()
  const farm = useFarm()
  const [confirming, setConfirming] = useState(false)
  const { harvest, batch, apiary } = unsent
  const meta = batch?.body.metadata as { honey_type?: string } | undefined
  const known = apiaries.find((a) => a.id === batch?.body.apiary_id)
  const where = apiary
    ? t('farm.harvests.newApiary', { name: String(apiary.body.name) })
    : (known?.name ?? '')
  const attention = [harvest, batch, apiary].find((a) => a?.status === 'needs_attention')
  return (
    <li className={styles.card}>
      <svg className={styles.cell} viewBox="0 0 64 72" aria-hidden="true">
        <path d={HEX} className={attention ? styles.cellAttention : styles.cellLocal} />
      </svg>
      <div className={styles.text}>
        <span className={styles.what}>
          {t('farm.harvests.row', {
            honey: t(`scan.honey.${meta?.honey_type ?? 'mixed'}`),
            kg: Number(harvest.body.quantity_kg),
          })}
        </span>
        <span className={styles.sub}>
          {t('farm.harvests.at', {
            apiary: where,
            date: dayLabel(String(harvest.body.harvest_date), today, t),
          })}
        </span>
        <SyncBadge status={attention ? 'attention' : 'local'} />
        {attention ? (
          <div className={styles.attention}>
            <p>
              {t('farm.harvests.attention.why', {
                reason:
                  attention.last_error?.message ??
                  attention.last_error?.code ??
                  t('farm.harvests.attention.unknownReason'),
              })}
            </p>
            {confirming ? (
              <>
                <p role="alert">{t('farm.harvests.attention.confirmRemove')}</p>
                <div className={styles.row}>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void Promise.all(
                        [harvest, batch, apiary]
                          .filter((a): a is ActionRecord => !!a && a.status !== 'sent')
                          .map((a) => farm.outbox.remove(a.id)),
                      )
                    }
                  >
                    {t('farm.harvests.attention.yesRemove')}
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirming(false)}>
                    {t('farm.harvests.attention.keep')}
                  </Button>
                </div>
              </>
            ) : (
              <Button variant="quiet" onClick={() => setConfirming(true)}>
                {t('farm.harvests.attention.remove')}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </li>
  )
}
