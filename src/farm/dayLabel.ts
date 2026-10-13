import type { TFunction } from 'i18next'

const short = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "today", "yesterday" or "12 Oct": a farmer's day, said plainly. */
export function dayLabel(day: string, today: string, t: TFunction): string {
  if (day === today) return t('farm.dates.today')
  const y = new Date(`${today}T12:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  if (day === y.toISOString().slice(0, 10)) return t('farm.dates.yesterday')
  return short.format(new Date(`${day}T12:00:00Z`))
}
