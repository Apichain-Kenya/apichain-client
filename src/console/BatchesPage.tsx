import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'
import { ArrowLeft, Search } from 'lucide-react'

import type { Me } from '../auth/SessionContext'
import { useWide } from '../ui/useWide'
import styles from './BatchesPage.module.css'
import { NextStep } from './NextStep'
import { Timeline } from './Timeline'
import { useRead } from './useRead'
import {
  STATES,
  WAITING_FOR,
  shortDay,
  todoStates,
  type BatchDetail,
  type BatchPage,
  type BatchSummary,
  type StateKey,
} from './work'

type Filter = 'todo' | 'all' | StateKey
const PAGE = 25

// Batches (13 §4.2): a list that opens on the person's "To do", and the
// batch as a page on a phone or a side pane on a laptop, with the next action
// at the foot of its record (P4b-D). A step that settles reloads both, so the
// batch leaves the person's "To do" as soon as it is done.
export function BatchesPage({ me, id }: { me: Me; id: number | null }) {
  const wide = useWide()
  const [reload, setReload] = useState(0)
  const onRecorded = useCallback(() => setReload((n) => n + 1), [])
  const view = (back: boolean) =>
    id !== null ? (
      <BatchView me={me} id={id} back={back} reload={reload} onRecorded={onRecorded} />
    ) : null
  if (!wide && id !== null) return view(true)
  return (
    <div className={wide ? styles.split : undefined}>
      <BatchList me={me} selected={id} reload={reload} />
      {wide ? (
        id !== null ? (
          view(false)
        ) : (
          <p className={styles.pick}>
            <PickHint />
          </p>
        )
      ) : null}
    </div>
  )
}

function PickHint() {
  const { t } = useTranslation()
  return <>{t('console.batches.pick')}</>
}

function listPath(filter: Filter, todo: StateKey[] | null, q: string, cursor: string | null) {
  const params = new URLSearchParams({ limit: String(PAGE) })
  const states = filter === 'todo' ? (todo ?? []) : filter === 'all' ? [] : [filter]
  for (const s of states) params.append('state', s)
  if (q) params.set('q', q)
  if (cursor) params.set('cursor', cursor)
  return `/v2/batches?${params}`
}

function BatchList({ me, selected, reload }: { me: Me; selected: number | null; reload: number }) {
  const { t } = useTranslation()
  const todo = todoStates(me.role)
  const [filter, setFilter] = useState<Filter>(todo ? 'todo' : 'all')
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<BatchSummary[]>([])

  // Search as the code is typed from a tub label, without a request per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = typed.trim().slice(0, 40)
      if (next === q) return
      setQ(next)
      setCursor(null)
      setEarlier([])
    }, 250)
    return () => clearTimeout(timer)
  }, [typed, q])

  const page = useRead<BatchPage>(listPath(filter, todo, q, cursor), reload)
  const items = page.status === 'ok' ? [...earlier, ...page.data.items] : earlier
  const chips: Filter[] = [...(todo ? (['todo'] as const) : []), 'all', ...STATES]

  return (
    <section className={styles.list} aria-labelledby="batches-title">
      <h1 id="batches-title" className={styles.h1}>
        {t('console.batches.title')}
      </h1>
      <label className={styles.search}>
        <Search aria-hidden="true" size={18} strokeWidth={1.75} />
        <span className="visually-hidden">{t('console.batches.search')}</span>
        <input
          type="search"
          placeholder={t('console.batches.search')}
          value={typed}
          maxLength={40}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <div className={styles.chips} role="group" aria-label={t('console.batches.filter')}>
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.chip}
            aria-pressed={filter === c}
            onClick={() => {
              setFilter(c)
              setCursor(null)
              setEarlier([])
            }}
          >
            {c === 'todo'
              ? t('console.batches.todo')
              : c === 'all'
                ? t('console.batches.all')
                : t(`console.states.${c}`)}
          </button>
        ))}
      </div>

      {page.status === 'offline' ? (
        <p className={styles.status} role="status">
          {t('console.offline')}
        </p>
      ) : page.status === 'error' ? (
        <p className={styles.status} role="alert">
          {t('console.loadFailed')}
        </p>
      ) : page.status === 'ok' && items.length === 0 ? (
        <p className={styles.status}>
          {filter === 'todo' ? t('console.batches.nothingToDo') : t('console.batches.none')}
        </p>
      ) : null}

      <ul className={styles.rows}>
        {items.map((b) => (
          <Row key={b.id} batch={b} todo={filter === 'todo'} selected={b.id === selected} />
        ))}
      </ul>
      {page.status === 'loading' ? (
        <p className={styles.status} role="status">
          {t('app.loading')}
        </p>
      ) : null}
      {page.status === 'ok' && page.data.next_cursor ? (
        <button
          type="button"
          className={styles.more}
          onClick={() => {
            setEarlier(items)
            setCursor(page.data.next_cursor ?? null)
          }}
        >
          {t('console.batches.more')}
        </button>
      ) : null}
    </section>
  )
}

function Row({
  batch: b,
  todo,
  selected,
}: {
  batch: BatchSummary
  todo: boolean
  selected: boolean
}) {
  const { t } = useTranslation()
  const state = b.state as StateKey
  const verb = todo ? WAITING_FOR[state] : undefined
  const sub = [
    b.honey_type ? t(`scan.honey.${b.honey_type}`, { defaultValue: b.honey_type }) : null,
    b.farmer_display_name,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li>
      <Link
        href={`/batches/${b.id}`}
        className={selected ? `${styles.row} ${styles.selected}` : styles.row}
        aria-current={selected ? 'page' : undefined}
      >
        <span className={styles.code}>{b.batch_code}</span>
        {verb ? <span className={styles.verb}>{t(`console.waitingFor.${verb}`)}</span> : null}
        <span className={styles.sub}>{sub}</span>
        <span className={styles.since}>
          {t(todo ? 'console.batches.waitingSince' : 'console.batches.since', {
            state: t(`console.states.${state}`),
            date: shortDay(b.state_updated_at),
          })}
        </span>
      </Link>
    </li>
  )
}

function BatchView({
  me,
  id,
  back,
  reload,
  onRecorded,
}: {
  me: Me
  id: number
  back: boolean
  reload: number
  onRecorded: () => void
}) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const read = useRead<BatchDetail>(`/v2/batches/${id}`, reload)

  return (
    <article className={styles.detail} aria-labelledby="batch-title">
      {back ? (
        <button type="button" className={styles.back} onClick={() => navigate('/batches')}>
          <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
          {t('console.batches.title')}
        </button>
      ) : null}
      {read.status === 'loading' ? (
        <p role="status">{t('app.loading')}</p>
      ) : read.status === 'offline' ? (
        <p role="status">{t('console.offline')}</p>
      ) : read.status === 'error' ? (
        <p role="alert">
          {read.code === 404 ? t('console.batch.notFound') : t('console.loadFailed')}
        </p>
      ) : (
        <BatchBody batch={read.data} me={me} onRecorded={onRecorded} />
      )}
    </article>
  )
}

function BatchBody({
  batch: b,
  me,
  onRecorded,
}: {
  batch: BatchDetail
  me: Me
  onRecorded: () => void
}) {
  const { t } = useTranslation()
  const honey = b.metadata?.honey_type
  return (
    <>
      <header className={styles.head}>
        <h2 id="batch-title" className={styles.h2}>
          {b.batch_code}
        </h2>
        <span className={styles.state}>{t(`console.states.${b.state}`)}</span>
        <dl className={styles.facts}>
          {honey ? (
            <div>
              <dt>{t('console.batch.honey')}</dt>
              <dd>{t(`scan.honey.${honey}`, { defaultValue: honey })}</dd>
            </div>
          ) : null}
          {b.farmer_display_name ? (
            <div>
              <dt>{t('console.batch.farmer')}</dt>
              <dd>{b.farmer_display_name}</dd>
            </div>
          ) : null}
          {b.apiary?.name ? (
            <div>
              <dt>{t('console.batch.apiary')}</dt>
              <dd>{b.apiary.name}</dd>
            </div>
          ) : null}
        </dl>
      </header>
      <Timeline stages={b.stages} />
      <NextStep key={b.id} batch={b} me={me} onRecorded={onRecorded} />
    </>
  )
}
