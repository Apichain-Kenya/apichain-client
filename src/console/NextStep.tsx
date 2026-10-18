import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ShieldCheck } from 'lucide-react'

import { useOutbox } from '../app/useOutbox'
import { useSync } from '../app/useSync'
import type { Me } from '../auth/SessionContext'
import { stageDraft, type ActionRecord, type StageKind } from '../offline/outbox'
import { Button } from '../ui/Button'
import { SyncBadge } from '../ui/Sync'
import styles from './NextStep.module.css'
import { DistributeForm, LabForm, PackageForm, ProcessForm, type FormProps } from './StageForms'
import { STATES, type BatchDetail, type StateKey } from './work'

// The state each staff kind moves a batch to, and back. Which form a step
// takes; never who may take it, which is the server's `next_action` (D10).
const KIND_FOR: Partial<Record<StateKey, StageKind>> = {
  PROCESSED: 'batch.process',
  LAB_VERIFIED: 'batch.lab_verify',
  PACKAGED: 'batch.package',
  DISTRIBUTED: 'batch.distribute',
}
const TARGET_OF = Object.fromEntries(Object.entries(KIND_FOR).map(([s, k]) => [k, s])) as Record<
  string,
  StateKey | undefined
>

const reached = (state: string, target: StateKey) =>
  STATES.indexOf(state as StateKey) >= STATES.indexOf(target)

/** This person's saved steps for one batch, oldest first, live from the outbox. */
function useSteps(userId: number, batchId: number) {
  const { outbox } = useOutbox()
  const [rows, setRows] = useState<ActionRecord[] | null>(null)
  useEffect(() => {
    let live = true
    const load = () =>
      void outbox.list(userId).then((all) => {
        if (!live) return
        setRows(
          all
            .filter((r) => TARGET_OF[r.kind] && r.body.batch_id === batchId)
            .sort((a, b) => a.seq - b.seq),
        )
      })
    load()
    const off = outbox.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [outbox, userId, batchId])
  return rows
}

// The next action (13 §4.4, §8): at the foot of the record, one card with
// only what `next_action` allows this person. Saving queues it in the outbox;
// the card then says where it is until the refreshed record contains it. A
// 409 `invalid_transition` cannot be fixed, so it offers only removal.
export function NextStep({
  batch,
  me,
  onRecorded,
  today = () => new Date().toLocaleDateString('en-CA'),
}: {
  batch: BatchDetail
  me: Me
  onRecorded: () => void
  today?: () => string
}) {
  const { t } = useTranslation()
  const { outbox, sync } = useOutbox()
  const { running } = useSync()
  const rows = useSteps(me.user_id, batch.id)

  // Reload the record whenever one of these steps settles (sent, refused or
  // removed), and only then: a reload while offline would have nothing new.
  const settled = rows
    ? rows.map((r) => (r.status === 'queued' ? '' : r.id + r.status)).join()
    : null
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (settled === null) return
    if (seen.current !== null && seen.current !== settled) onRecorded()
    seen.current = settled
  }, [settled, onRecorded])

  const latest = rows?.at(-1)
  const target = latest ? TARGET_OF[latest.kind] : undefined
  const problem = latest?.status === 'needs_attention' ? latest : null
  const pending =
    latest &&
    target &&
    (latest.status === 'queued' || (latest.status === 'sent' && !reached(batch.state, target)))
      ? latest
      : null
  const next = batch.next_action

  const save = (kind: StageKind) => async (body: Record<string, unknown>) => {
    await outbox.enqueue(me.user_id, [stageDraft(kind, batch.id, body)], Date.now())
    void sync.kick({ force: true })
  }
  const remove = async (row: ActionRecord) => {
    await outbox.remove(row.id)
  }

  return (
    <>
      {problem ? <Problem row={problem} onRemove={() => void remove(problem)} /> : null}
      {rows === null || (!pending && !next) ? null : (
        <section className={styles.card} aria-label={t('console.next.title')}>
          <p className={styles.eyebrow}>{t('console.next.title')}</p>
          {pending && target ? (
            <>
              <h3 className={styles.h3}>{t(`console.next.do.${target}`)}</h3>
              <SyncBadge
                status={pending.status === 'sent' || running ? 'sending' : 'local'}
                label={t(
                  pending.status === 'sent' || running
                    ? 'console.next.sending'
                    : 'console.next.local',
                )}
              />
            </>
          ) : next ? (
            <Step next={next} me={me} today={today} save={save} />
          ) : null}
        </section>
      )}
    </>
  )
}

function Step({
  next,
  me,
  today,
  save,
}: {
  next: NonNullable<BatchDetail['next_action']>
  me: Me
  today: () => string
  save: (kind: StageKind) => (body: Record<string, unknown>) => Promise<void>
}) {
  const { t } = useTranslation()
  const target = next.target_state as StateKey
  const kind = KIND_FOR[target]
  if (!next.allowed || !kind) {
    // Not this person's step, or the harvest, which the farmer's app records.
    return (
      <>
        <h3 className={styles.h3}>{t(`console.next.wait.${target}`)}</h3>
        <p className={styles.small}>
          {t(target === 'HARVESTED' ? 'console.next.harvestNote' : 'console.next.waitNote')}
        </p>
      </>
    )
  }
  // Board call 2: an admin is told, before saving, what the record will say.
  const note =
    me.role === 'admin' ? (
      <p className={styles.asAdmin}>
        <ShieldCheck aria-hidden="true" size={18} strokeWidth={2} />
        <span>{t('console.next.asAdmin', { name: me.display_name })}</span>
      </p>
    ) : undefined
  const props: FormProps = { onSave: save(kind), note }
  return (
    <>
      <h3 className={styles.h3}>{t(`console.next.do.${target}`)}</h3>
      {target === 'PROCESSED' ? (
        <ProcessForm {...props} />
      ) : target === 'LAB_VERIFIED' ? (
        <LabForm {...props} today={today()} />
      ) : target === 'PACKAGED' ? (
        <PackageForm {...props} />
      ) : (
        <DistributeForm {...props} />
      )}
    </>
  )
}

function Problem({ row, onRemove }: { row: ActionRecord; onRemove: () => void }) {
  const { t } = useTranslation()
  const taken = row.last_error?.code === 'invalid_transition'
  return (
    <div className={`${styles.card} ${styles.problem}`} role="alert">
      <h3 className={styles.h3}>
        <AlertCircle aria-hidden="true" size={20} strokeWidth={2} />
        {t(taken ? 'console.next.conflict.title' : 'console.next.refused.title')}
      </h3>
      <p>
        {taken
          ? t('console.next.conflict.body')
          : t(
              row.last_error?.status === 403
                ? 'console.next.refused.forbidden'
                : 'console.next.refused.invalid',
            )}
      </p>
      <Button variant="secondary" onClick={onRemove}>
        {t(taken ? 'console.next.conflict.remove' : 'console.next.refused.remove')}
      </Button>
    </div>
  )
}
