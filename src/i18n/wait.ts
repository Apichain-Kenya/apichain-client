import type { TFunction } from 'i18next'

/**
 * How long a 429 asks to wait, in words ("40 seconds", "15 minutes"). The
 * seconds come from the server's `Retry-After` (P5-B); a missing value reads
 * as one minute rather than nothing.
 */
export function waitWords(t: TFunction, seconds: number | undefined): string {
  const s = Math.max(1, Math.ceil(seconds && seconds > 0 ? seconds : 60))
  return s < 60
    ? t('app.wait.seconds', { count: s })
    : t('app.wait.minutes', { count: Math.ceil(s / 60) })
}

/** The seconds a 429 asks to wait: `Retry-After`, else the error body's detail. */
export async function retryAfterSeconds(res: Response): Promise<number | undefined> {
  const header = Number(res.headers.get('Retry-After'))
  if (header > 0) return header
  const body = (await res.json().catch(() => ({}))) as {
    details?: { retry_after_seconds?: unknown }
  }
  const detail = Number(body.details?.retry_after_seconds)
  return detail > 0 ? detail : undefined
}
