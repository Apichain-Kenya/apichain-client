import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'wouter'
import { Check, Plus, Search } from 'lucide-react'

import { localPhone, toE164Ke } from '../auth/phone'
import type { Me } from '../auth/SessionContext'
import { useWide } from '../ui/useWide'
import { AddApiary } from './AddApiary'
import listStyles from './BatchesPage.module.css'
import { ContactCheck } from './ContactCheck'
import { EnrolFarmer } from './EnrolFarmer'
import { FarmerPage } from './FarmerPage'
import type { FarmerPage as Page, FarmerSummary } from './farmers'
import styles from './FarmersPage.module.css'
import peopleStyles from './PeoplePage.module.css'
import { useRead } from './useRead'
import { shortDay } from './work'

export type FarmersView =
  | { kind: 'list' }
  | { kind: 'new' }
  | { kind: 'farmer'; id: number }
  | { kind: 'verify'; id: number; channel: 'sms' | 'email' }
  | { kind: 'apiary'; id: number }

export type FarmerNotice = { id: number; text: string } | null

const PAGE = 50

// Farmers (13 §9, D7): every farmer, for field officers and admins, so an
// officer covering a colleague's area can find that colleague's farmers.
// Enrolment, contact checks and uploads need a connection (D8, D9); consent
// choices and new apiaries save on the device and send later.
export function FarmersPage({
  me,
  view,
  notice,
  setNotice,
}: {
  me: Me
  view: FarmersView
  notice: FarmerNotice
  setNotice: (n: FarmerNotice) => void
}) {
  const { t } = useTranslation()
  const wide = useWide()
  const [reload, setReload] = useState(0)
  const changed = () => setReload((n) => n + 1)
  const selected = view.kind === 'list' || view.kind === 'new' ? null : view.id
  const pane =
    view.kind === 'new' ? (
      <EnrolFarmer back={!wide} setNotice={setNotice} changed={changed} />
    ) : view.kind === 'farmer' ? (
      <FarmerPage
        key={view.id}
        me={me}
        id={view.id}
        back={!wide}
        notice={notice?.id === view.id ? notice.text : null}
        changed={changed}
      />
    ) : view.kind === 'verify' ? (
      <ContactCheck key={`${view.id}-${view.channel}`} id={view.id} channel={view.channel} />
    ) : view.kind === 'apiary' ? (
      <AddApiary key={view.id} me={me} id={view.id} />
    ) : null
  if (!wide && pane) return pane
  return (
    <div className={wide ? listStyles.split : undefined}>
      <FarmerList selected={selected} reload={reload} />
      {wide ? (pane ?? <p className={listStyles.pick}>{t('console.farmers.pick')}</p>) : null}
    </div>
  )
}

// What the server searches: a name's start, or a phone number's end. Phones
// are stored +254…, so a number typed the local way is sent as its last nine.
function searchTerm(typed: string): string {
  const q = typed.trim().slice(0, 40)
  const phone = toE164Ke(q)
  return phone ? phone.slice(-9) : q
}

function FarmerList({ selected, reload }: { selected: number | null; reload: number }) {
  const { t } = useTranslation()
  const [typed, setTyped] = useState('')
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<FarmerSummary[]>([])

  // Search as it is typed, without a request per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchTerm(typed)
      if (next === q) return
      setQ(next)
      setCursor(null)
      setEarlier([])
    }, 250)
    return () => clearTimeout(timer)
  }, [typed, q])

  const params = new URLSearchParams({ limit: String(PAGE) })
  if (q) params.set('q', q)
  if (cursor) params.set('cursor', cursor)
  const page = useRead<Page>(`/v2/farmers?${params}`, reload)
  const items = page.status === 'ok' ? [...earlier, ...page.data.items] : earlier

  return (
    <section className={listStyles.list} aria-labelledby="farmers-title">
      <div className={peopleStyles.head}>
        <h1 id="farmers-title" className={listStyles.h1}>
          {t('console.farmers.title')}
        </h1>
        <Link href="/farmers/new" className={peopleStyles.add}>
          <Plus aria-hidden="true" size={18} strokeWidth={2} />
          {t('console.farmers.enrol')}
        </Link>
      </div>
      <label className={listStyles.search}>
        <Search aria-hidden="true" size={18} strokeWidth={1.75} />
        <span className="visually-hidden">{t('console.farmers.search')}</span>
        <input
          type="search"
          placeholder={t('console.farmers.search')}
          value={typed}
          maxLength={40}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      {page.status === 'loading' && items.length === 0 ? (
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
      ) : items.length === 0 ? (
        <p className={listStyles.status}>
          {t(q ? 'console.farmers.noMatch' : 'console.farmers.none')}
        </p>
      ) : (
        <ul className={listStyles.rows}>
          {items.map((f) => (
            <li key={f.id}>
              <Link
                href={`/farmers/${f.id}`}
                className={
                  f.id === selected ? `${listStyles.row} ${listStyles.selected}` : listStyles.row
                }
                aria-current={f.id === selected ? 'page' : undefined}
              >
                <span className={peopleStyles.name}>{f.display_name}</span>
                <span
                  className={`${peopleStyles.tag} ${f.phone_verified ? peopleStyles.active : peopleStyles.inactive}`}
                >
                  {f.phone_verified ? (
                    <Check aria-hidden="true" size={14} strokeWidth={2.5} />
                  ) : null}{' '}
                  {t(
                    f.phone_verified
                      ? 'console.farmers.phoneConfirmed'
                      : 'console.farmers.phoneNotConfirmed',
                  )}
                </span>
                <span className={listStyles.sub}>
                  {t('console.farmers.row', {
                    phone: localPhone(f.phone),
                    hives:
                      f.number_of_hives === null
                        ? t('console.farmers.hivesUnknown')
                        : t('console.farmers.hives', { count: f.number_of_hives }),
                  })}
                </span>
                <span className={listStyles.sub}>
                  {f.enrolled_by_display_name
                    ? t('console.farmers.enrolledBy', {
                        day: shortDay(f.enrolled_at),
                        name: f.enrolled_by_display_name,
                      })
                    : t('console.farmers.enrolledOn', { day: shortDay(f.enrolled_at) })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {page.status === 'ok' && page.data.next_cursor ? (
        <button
          type="button"
          className={listStyles.more}
          onClick={() => {
            setEarlier(items)
            setCursor(page.data.next_cursor)
          }}
        >
          {t('console.farmers.more')}
        </button>
      ) : null}
      <p className={styles.cover}>{t('console.farmers.cover')}</p>
    </section>
  )
}
