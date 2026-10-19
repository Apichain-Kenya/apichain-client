import { useTranslation } from 'react-i18next'
import { AlertCircle, Mail, MessageSquare } from 'lucide-react'

import { useSync } from '../app/useSync'
import { CONSENT_TEXT_VERSION } from '../i18n/consent'
import { choiceOf, type Choice } from '../offline/choice'
import { consentDraft, type ActionRecord } from '../offline/outbox'
import { Button } from '../ui/Button'
import { Switch } from '../ui/Switch'
import { SyncBadge } from '../ui/Sync'
import { localDay, shortDay } from './dayLabel'
import { useFarm } from './FarmServices'
import styles from './MyChoices.module.css'
import type { Contact, ConsentStates } from './useMyChoices'

const PURPOSES = ['sms_notifications', 'email_notifications'] as const
type Purpose = (typeof PURPOSES)[number]
const ICONS = { sms_notifications: MessageSquare, email_notifications: Mail }

/** Who set it last, and when, in the farmer's words. */
function said(t: (k: string, o?: Record<string, unknown>) => string, c: Choice): string {
  const state = c.on ? 'on' : 'off'
  if (!c.at || !c.by) return t('farm.choices.notYet')
  const day = shortDay(localDay(c.at))
  return t(`farm.choices.${c.by === 'onboarder' ? 'onboarder' : 'you'}_${state}`, { day })
}

// The farmer's own message choices (13 §11 item 1, board): texts and emails,
// nothing else of consent. Each sentence is the consent wording itself, so
// the recorded text_version names the words the farmer read (D17). A choice
// saves on this phone and sends by itself; one the farmer turned off is
// theirs alone to turn back on, so it never locks here.
export function MyChoices({
  userId,
  farmerId,
  rows,
  contact,
  states,
}: {
  userId: number
  farmerId: number
  rows: ActionRecord[] | null
  contact: Contact | null
  states: ConsentStates | null
}) {
  const { t } = useTranslation()
  const farm = useFarm()
  const { running } = useSync()

  const toggle = async (purpose: Purpose, on: boolean) => {
    await farm.outbox.enqueue(
      userId,
      [consentDraft(farmerId, purpose, on, CONSENT_TEXT_VERSION)],
      farm.now(),
    )
    void farm.sync.kick({ force: true })
  }

  return (
    <section className={styles.wrap} aria-labelledby="choices-title">
      <h2 id="choices-title" className={styles.title}>
        {t('farm.choices.title')}
      </h2>
      <div className={styles.list}>
        {PURPOSES.map((purpose) => {
          const mine = (rows ?? []).filter((r) => r.body.purpose === purpose)
          const problems = mine.filter((r) => r.status === 'needs_attention')
          const c = choiceOf(
            states?.consents.find((s) => s.purpose === purpose),
            mine,
          )
          const noEmail = purpose === 'email_notifications' && contact?.has_email !== true
          const label = `my-${purpose}`
          const Icon = ICONS[purpose]
          return (
            <div key={purpose} className={styles.row}>
              <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
              <div className={styles.words}>
                <p id={label}>{t(`consent.purposes.${purpose}`)}</p>
                {c.pending ? (
                  <SyncBadge status={running ? 'sending' : 'local'} />
                ) : (
                  <small>{noEmail ? t('farm.choices.noEmail') : said(t, c)}</small>
                )}
              </div>
              <Switch
                on={c.on}
                labelledBy={label}
                // Waits while the outbox is read, while there is no email to
                // send to, and while a refusal for it is showing.
                disabled={rows === null || noEmail || problems.length > 0}
                onChange={(on) => void toggle(purpose, on)}
              />
              {problems.map((row) => (
                <div key={row.id} className={styles.problem} role="alert">
                  <p>
                    <AlertCircle aria-hidden="true" size={16} strokeWidth={2} />
                    {t('farm.choices.refused', {
                      reason:
                        row.last_error?.message ??
                        row.last_error?.code ??
                        t('farm.harvests.attention.unknownReason'),
                    })}
                  </p>
                  <Button variant="secondary" onClick={() => void farm.outbox.remove(row.id)}>
                    {t('farm.choices.remove')}
                  </Button>
                </div>
              ))}
            </div>
          )
        })}
      </div>
      <p className={styles.note}>{t('farm.choices.note')}</p>
    </section>
  )
}
