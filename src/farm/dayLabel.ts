import type { TFunction } from 'i18next'

const short = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** "today", "yesterday" or "12 Oct": a farmer's day, said plainly. */
export function dayLabel(day: string, today: string, t: TFunction): string {
  if (day === today) return t('farm.dates.today')
  const y = new Date(`${today}T12:00:00Z`)
  y.setUTCDate(y.getUTCDate() - 1)
  if (day === y.toISOString().slice(0, 10)) return t('farm.dates.yesterday')
  return shortDay(day)
}

/** "12 Oct", for a calendar day (YYYY-MM-DD). */
export function shortDay(day: string): string {
  return short.format(new Date(`${day}T12:00:00Z`))
}

/**
 * The local calendar day (YYYY-MM-DD) of a server timestamp. The server sends
 * naive UTC; slicing it gave the UTC day, so a harvest at 01:30 in Nairobi
 * read as "yesterday" (review). `timeZone` is for tests; the app uses the
 * phone's own.
 */
export function localDay(serverTime: string, timeZone?: string): string {
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(serverTime) ? serverTime : `${serverTime}Z`
  return new Date(iso).toLocaleDateString('en-CA', timeZone ? { timeZone } : undefined)
}
