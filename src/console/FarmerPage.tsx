import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'wouter'
import {
  AlertCircle,
  ArrowLeft,
  BookOpenText,
  Check,
  Clock,
  FileText,
  Hexagon,
  Lock,
  Mail,
  MessageSquareText,
  Plus,
  ShieldCheck,
} from 'lucide-react'

import { useOutbox } from '../app/useOutbox'
import { localPhone } from '../auth/phone'
import { OfflineError } from '../auth/session'
import { useSessionApi, type Me } from '../auth/SessionContext'
import { CONSENT_TEXT_VERSION } from '../i18n/consent'
import { consentDraft, type ActionRecord } from '../offline/outbox'
import { useSync } from '../app/useSync'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Switch } from '../ui/Switch'
import { SyncBadge } from '../ui/Sync'
import listStyles from './BatchesPage.module.css'
import {
  checkFile,
  choiceOf,
  DOC_TYPES,
  fileSize,
  settledKey,
  TOGGLES,
  useFarmerWork,
  type Apiary,
  type Choice,
  type ConsentStates,
  type DocumentList,
  type DocumentOut,
  type FarmerDetail,
  type Toggle,
} from './farmers'
import styles from './FarmersPage.module.css'
import { ResetPassword } from './PeoplePage'
import peopleStyles from './PeoplePage.module.css'
import { useRead } from './useRead'
import { shortDay } from './work'

const ICONS = {
  document_upload: FileText,
  sms_notifications: MessageSquareText,
  email_notifications: Mail,
}

// A farmer's page (13 §9, board "the farmer's page"): who they are, their
// contact and whether it is confirmed, their choices, documents, apiaries,
// and for an admin a password reset (board call 5). Phone and email are shown
// to field officers and admins only, the only roles that reach this (D7).
export function FarmerPage({
  me,
  id,
  back,
  notice,
  changed,
}: {
  me: Me
  id: number
  back: boolean
  notice: string | null
  changed: () => void
}) {
  const { t } = useTranslation()
  const [, navigate] = useLocation()
  const [reload, setReload] = useState(0)
  const farmer = useRead<FarmerDetail>(`/v2/farmers/${id}`, reload)
  const consents = useRead<ConsentStates>(`/v2/farmers/${id}/consents`, reload)
  const work = useFarmerWork(me.user_id, id)

  // Read the server again whenever one of this person's saved choices or
  // apiaries settles, so the page shows what the server now holds.
  const settled = settledKey(work)
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (settled === null) return
    if (seen.current !== null && seen.current !== settled) setReload((n) => n + 1)
    seen.current = settled
  }, [settled])

  const server = consents.status === 'ok' ? consents.data.consents : []
  const choices = Object.fromEntries(
    TOGGLES.map((p) => [
      p,
      choiceOf(
        server.find((c) => c.purpose === p),
        (work ?? []).filter((r) => r.kind === 'consent.record' && r.body.purpose === p),
      ),
    ]),
  ) as Record<Toggle, Choice>

  return (
    <section className={peopleStyles.pane} aria-labelledby="farmer-title">
      {back ? (
        <button type="button" className={listStyles.back} onClick={() => navigate('/farmers')}>
          <ArrowLeft aria-hidden="true" size={18} strokeWidth={1.75} />
          {t('console.farmers.title')}
        </button>
      ) : null}
      {farmer.status === 'loading' ? (
        <p role="status">{t('app.loading')}</p>
      ) : farmer.status === 'offline' ? (
        <p role="status">{t('console.offline')}</p>
      ) : farmer.status === 'error' ? (
        <p role="alert">
          {t(farmer.code === 404 ? 'console.farmers.notFound' : 'console.loadFailed')}
        </p>
      ) : (
        <>
          <header className={peopleStyles.personHead}>
            <h2 id="farmer-title" className={peopleStyles.h2}>
              {farmer.data.display_name}
            </h2>
            <p className={styles.facts}>
              <span>
                {[
                  farmer.data.number_of_hives === null
                    ? t('console.farmers.hivesUnknown')
                    : t('console.farmers.hives', { count: farmer.data.number_of_hives }),
                  t('console.farmers.apiaries', { count: farmer.data.apiaries_count }),
                ].join(' · ')}
              </span>
              <span>
                {farmer.data.enrolled_by_display_name
                  ? t('console.farmers.enrolledBy', {
                      day: shortDay(farmer.data.enrolled_at),
                      name: farmer.data.enrolled_by_display_name,
                    })
                  : t('console.farmers.enrolledOn', { day: shortDay(farmer.data.enrolled_at) })}
              </span>
            </p>
          </header>
          {notice ? (
            <p className={peopleStyles.notice} role="status">
              {notice}
            </p>
          ) : null}
          <Contact farmer={farmer.data} />
          {/* Both wait for the outbox read: until it lands, a choice saved on
              this device (a withdrawal, say) would not count yet. */}
          {consents.status === 'ok' && work !== null ? (
            <Choices
              me={me}
              farmerId={id}
              hasEmail={farmer.data.has_email}
              choices={choices}
              dataProcessing={server.find((c) => c.purpose === 'data_processing')?.recorded_at}
              refused={(work ?? []).filter(
                (r) => r.kind === 'consent.record' && r.status === 'needs_attention',
              )}
            />
          ) : null}
          <Documents
            me={me}
            farmerId={id}
            choice={consents.status === 'ok' && work !== null ? choices.document_upload : null}
            reload={reload}
          />
          <Apiaries
            farmerId={id}
            work={(work ?? []).filter((r) => r.kind === 'apiary.create')}
            reload={reload}
          />
          {me.role === 'admin' && farmer.data.user_id !== null ? (
            <ResetPassword
              id={farmer.data.user_id}
              min={8}
              note="console.farmers.farmer.resetNote"
              changed={changed}
            />
          ) : null}
        </>
      )}
    </section>
  )
}

function Contact({ farmer }: { farmer: FarmerDetail }) {
  const { t } = useTranslation()
  const tag = (ok: boolean) => (
    <span className={`${styles.tag} ${ok ? styles.yes : styles.no}`}>
      {ok ? <Check aria-hidden="true" size={14} strokeWidth={2.5} /> : null}
      {t(ok ? 'console.farmers.farmer.confirmed' : 'console.farmers.farmer.notConfirmed')}
    </span>
  )
  return (
    <div className={styles.contact}>
      <div className={styles.card}>
        <span className={styles.label}>{t('console.farmers.farmer.phone')}</span>
        <span className={styles.value}>{localPhone(farmer.phone)}</span>
        {tag(farmer.phone_verified)}
        {!farmer.phone_verified ? (
          <Link href={`/farmers/${farmer.id}/verify/sms`} className={styles.linkButton}>
            {t('console.farmers.farmer.confirmPhone')}
          </Link>
        ) : null}
      </div>
      <div className={styles.card}>
        <span className={styles.label}>{t('console.farmers.farmer.email')}</span>
        <span className={styles.value}>{farmer.email ?? t('console.farmers.farmer.noEmail')}</span>
        {farmer.has_email ? tag(farmer.email_verified) : null}
        {farmer.has_email && !farmer.email_verified ? (
          <Link href={`/farmers/${farmer.id}/verify/email`} className={styles.linkButton}>
            {t('console.farmers.farmer.confirmEmail')}
          </Link>
        ) : null}
      </div>
    </div>
  )
}

// Their choices (13 §4.5, §9 item 3, D11). A switch saves the choice on this
// device through the outbox, in the wording version the farmer just heard.
// A choice the farmer took back themselves is theirs alone to turn on again.
function Choices({
  me,
  farmerId,
  hasEmail,
  choices,
  dataProcessing,
  refused,
}: {
  me: Me
  farmerId: number
  hasEmail: boolean
  choices: Record<Toggle, Choice>
  dataProcessing: string | null | undefined
  refused: ActionRecord[]
}) {
  const { t } = useTranslation()
  const { outbox, sync } = useOutbox()
  const { running } = useSync()

  const toggle = async (purpose: Toggle, on: boolean) => {
    await outbox.enqueue(
      me.user_id,
      [consentDraft(farmerId, purpose, on, CONSENT_TEXT_VERSION)],
      Date.now(),
    )
    void sync.kick({ force: true })
  }

  return (
    <div className={styles.section}>
      <h3 className={peopleStyles.h3}>{t('console.farmers.farmer.choices')}</h3>
      <p className={styles.readaloud}>
        <BookOpenText aria-hidden="true" size={18} strokeWidth={1.75} />
        <span>{t('console.farmers.farmer.readEach')}</span>
      </p>
      <div className={styles.consent}>
        {TOGGLES.map((purpose) => {
          const c = choices[purpose]
          const Icon = ICONS[purpose]
          const noEmail = purpose === 'email_notifications' && !hasEmail
          const label = `consent-${purpose}`
          const problems = refused.filter((r) => r.body.purpose === purpose)
          return (
            <div key={purpose} className={styles.crow}>
              <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
              <div className={styles.cwords}>
                <p id={label}>{t(`consent.purposes.${purpose}`)}</p>
                {c.locked ? (
                  <small className={styles.lock}>
                    <Lock aria-hidden="true" size={14} strokeWidth={2} />
                    {t('console.farmers.farmer.lock')}
                  </small>
                ) : null}
                <small>
                  {noEmail
                    ? t('console.farmers.farmer.noEmailRow')
                    : c.by === 'you'
                      ? t(`console.farmers.farmer.by.you_${c.on ? 'on' : 'off'}`, {
                          name: me.display_name,
                        })
                      : c.by && c.at
                        ? t(`console.farmers.farmer.by.${c.by}_${c.on ? 'on' : 'off'}`, {
                            day: shortDay(c.at),
                          })
                        : t('console.farmers.farmer.notAsked')}
                </small>
                {c.pending ? (
                  <SyncBadge
                    status={running ? 'sending' : 'local'}
                    label={t(
                      running ? 'console.farmers.farmer.sending' : 'console.farmers.farmer.local',
                    )}
                  />
                ) : null}
              </div>
              <Switch
                on={c.on}
                labelledBy={label}
                // Held while a refusal for it is showing: remove that first.
                disabled={noEmail || (c.locked && !c.on) || problems.length > 0}
                onChange={(on) => void toggle(purpose, on)}
              />
              {problems.map((row) => (
                <Refused key={row.id} row={row} className={styles.rowProblem} />
              ))}
            </div>
          )
        })}
        <div className={styles.crow}>
          <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.75} />
          <div className={styles.cwords}>
            <p>{t('consent.purposes.data_processing')}</p>
            {dataProcessing ? (
              <small>
                {t('console.farmers.farmer.agreedAt', { day: shortDay(dataProcessing) })}
              </small>
            ) : null}
          </div>
          <span className={styles.fixed}>
            <Check aria-hidden="true" size={16} strokeWidth={2.5} />
            {t('console.farmers.farmer.agreed')}
          </span>
        </div>
      </div>
    </div>
  )
}

/** A saved action the server refused: what happened, in words, and the way
 *  to clear it, so nothing waits on this device forever (P4b-D lesson). */
function Refused({ row, className }: { row: ActionRecord; className?: string }) {
  const { t } = useTranslation()
  const { outbox } = useOutbox()
  const farmerOnly = row.last_error?.code === 'withdrawn_by_farmer'
  return (
    <div className={`${peopleStyles.refusal} ${className ?? ''}`} role="alert">
      <p className={peopleStyles.refusalTitle}>
        <AlertCircle aria-hidden="true" size={18} strokeWidth={2} />
        {t('console.farmers.farmer.refused')}
      </p>
      <p>{t(farmerOnly ? 'console.farmers.farmer.lock' : 'console.farmers.farmer.refusedBody')}</p>
      <Button variant="secondary" onClick={() => void outbox.remove(row.id)}>
        {t('console.farmers.farmer.remove')}
      </Button>
    </div>
  )
}

const UPLOAD_REFUSALS: Record<string, string> = {
  file_too_large: 'console.farmers.farmer.tooBig',
  quota_exceeded: 'console.farmers.farmer.quota',
  unsupported_media_type: 'console.farmers.farmer.wrongType',
  consent_required: 'console.farmers.farmer.needConsent',
  document_rejected: 'console.farmers.farmer.rejected',
  scanner_unavailable: 'console.farmers.farmer.scanner',
  storage_unavailable: 'console.farmers.farmer.storage',
}

type Said = { tone: 'status' | 'alert'; text: string } | null

// Documents (13 §9 item 6, D9): online only, no Idempotency-Key (the server
// dedupes by content). Upload opens only once the *server* has the farmer's
// agreement: a choice still on this device would race the upload and lose.
// Each "View" asks for a fresh signed link and opens it; no link is kept.
function Documents({
  me,
  farmerId,
  choice,
  reload,
}: {
  me: Me
  farmerId: number
  choice: Choice | null
  reload: number
}) {
  const { t } = useTranslation()
  const session = useSessionApi()
  const [mine, setMine] = useState(0)
  const list = useRead<DocumentList>(`/v2/farmers/${farmerId}/documents`, reload + mine)
  const [type, setType] = useState<(typeof DOC_TYPES)[number]>('national_id')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Said>(null)
  const ready = choice !== null && choice.on && !choice.pending

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    input.value = '' // the same file may be chosen again
    if (!file) return
    const bad = await checkFile(file)
    if (bad) return setSaid({ tone: 'alert', text: t(`console.farmers.farmer.${bad}`) })
    setBusy(true)
    setSaid({ tone: 'status', text: t('console.farmers.farmer.checking') })
    const form = new FormData()
    form.append('doc_type', type)
    form.append('file', file, file.name)
    try {
      const res = await session.authFetch(
        `/v2/farmers/${farmerId}/documents`,
        { method: 'POST', body: form },
        { asUser: me.user_id },
      )
      if (res.ok) {
        setSaid({
          tone: 'status',
          text: t(
            res.status === 200 ? 'console.farmers.farmer.already' : 'console.farmers.farmer.filed',
          ),
        })
        setMine((n) => n + 1)
      } else {
        const err = (await res.json().catch(() => ({}))) as { code?: string }
        setSaid({
          tone: 'alert',
          text: t(UPLOAD_REFUSALS[err.code ?? ''] ?? 'console.farmers.farmer.failed'),
        })
      }
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err
      setSaid({ tone: 'alert', text: t('console.farmers.farmer.uploadOffline') })
    } finally {
      setBusy(false)
    }
  }

  const view = async (doc: DocumentOut) => {
    // Opened inside the click, so the browser does not block it as a popup;
    // the link arrives after, and the new tab never gets a handle back here.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    try {
      const res = await session.authFetch(
        `/v2/documents/${doc.id}/download-url`,
        {},
        { asUser: me.user_id },
      )
      if (!res.ok) throw new Error(String(res.status))
      const { url } = (await res.json()) as { url: string }
      if (tab) tab.location.href = url
      else window.open(url, '_blank', 'noopener')
    } catch {
      tab?.close()
      setSaid({ tone: 'alert', text: t('console.farmers.farmer.viewFailed') })
    }
  }

  const docs = list.status === 'ok' ? list.data.documents : []
  return (
    <div className={styles.section}>
      <h3 className={peopleStyles.h3}>{t('console.farmers.farmer.documents')}</h3>
      <div className={styles.drop}>
        <div className={peopleStyles.g2}>
          <Field label={t('console.farmers.farmer.type')}>
            {(p) => (
              <select
                {...p}
                value={type}
                onChange={(e) => setType(e.target.value as (typeof DOC_TYPES)[number])}
              >
                {DOC_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t(`console.farmers.farmer.types.${d}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('console.farmers.farmer.choose')}>
            {(p) => (
              <input
                {...p}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                disabled={!ready || busy}
                onChange={(e) => void pick(e)}
              />
            )}
          </Field>
        </div>
        {choice && !ready ? (
          <p className={styles.waiting}>
            <Clock aria-hidden="true" size={16} strokeWidth={2} />
            {t(
              choice.on && choice.pending
                ? 'console.farmers.farmer.waitingConsent'
                : 'console.farmers.farmer.needConsent',
            )}
          </p>
        ) : null}
        {said ? (
          <p
            className={said.tone === 'alert' ? peopleStyles.error : peopleStyles.small}
            role={said.tone}
          >
            {said.text}
          </p>
        ) : null}
        <p className={peopleStyles.small}>
          {t('console.farmers.farmer.limits')}
          {list.status === 'ok' && docs.length === 0
            ? ` ${t('console.farmers.farmer.noDocuments')}`
            : ''}
        </p>
      </div>
      {docs.length > 0 ? (
        <ul className={styles.docs}>
          {docs.map((d) => {
            const typeName = t(`console.farmers.farmer.types.${d.doc_type}`, {
              defaultValue: d.doc_type,
            })
            return (
              <li key={d.id} className={styles.doc}>
                <FileText aria-hidden="true" size={20} strokeWidth={1.75} />
                <div>
                  <p>{typeName}</p>
                  <p className={`${styles.docSub} ${styles.docName}`}>{d.original_filename}</p>
                  <p className={styles.docSub}>
                    {t('console.farmers.farmer.docRow', {
                      size: fileSize(d.size_bytes),
                      day: shortDay(d.uploaded_at),
                    })}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  aria-label={t('console.farmers.farmer.viewLabel', {
                    type: typeName,
                    name: d.original_filename,
                  })}
                  onClick={() => void view(d)}
                >
                  {t('console.farmers.farmer.view')}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

// Apiaries (13 §9 item 7): the server's, then any this person saved here that
// have not reached it, each with where it is or, if refused, a way to clear it.
function Apiaries({
  farmerId,
  work,
  reload,
}: {
  farmerId: number
  work: ActionRecord[]
  reload: number
}) {
  const { t } = useTranslation()
  const { running } = useSync()
  const list = useRead<Apiary[]>(`/v2/apiaries?farmer_id=${farmerId}`, reload)
  const rows = list.status === 'ok' ? list.data : []
  const local = work.filter((r) => r.status !== 'sent')
  return (
    <div className={styles.section}>
      <h3 className={peopleStyles.h3}>{t('console.farmers.farmer.apiaries')}</h3>
      {rows.length === 0 && local.length === 0 && list.status === 'ok' ? (
        <p className={peopleStyles.small}>{t('console.farmers.farmer.noApiaries')}</p>
      ) : (
        <ul className={styles.docs}>
          {rows.map((a) => (
            <li key={a.id} className={styles.doc}>
              <Hexagon aria-hidden="true" size={20} strokeWidth={1.75} />
              <div>
                <p>{a.name}</p>
                {a.hive_count !== null ? (
                  <p className={styles.docSub}>
                    {t('console.farmers.farmer.apiaryHives', { count: a.hive_count })}
                  </p>
                ) : null}
              </div>
              <span />
            </li>
          ))}
          {local.map((r) => (
            <li key={r.id} className={styles.doc}>
              <Hexagon aria-hidden="true" size={20} strokeWidth={1.75} />
              <div>
                <p>{String(r.body.name)}</p>
                {r.status === 'queued' ? (
                  <SyncBadge
                    status={running ? 'sending' : 'local'}
                    label={t(
                      running ? 'console.farmers.farmer.sending' : 'console.farmers.farmer.local',
                    )}
                  />
                ) : null}
              </div>
              <span />
              {r.status === 'needs_attention' ? (
                <Refused row={r} className={styles.docProblem} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <Link href={`/farmers/${farmerId}/apiary`} className={styles.linkButton}>
        <Plus aria-hidden="true" size={18} strokeWidth={2} />
        {t('console.farmers.farmer.addApiary')}
      </Link>
    </div>
  )
}
