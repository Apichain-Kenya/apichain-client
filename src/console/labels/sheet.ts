import { useEffect, useState } from 'react'

import { OfflineError } from '../../auth/session'
import { useSessionApi } from '../../auth/SessionContext'
import type { VerifyResponse } from '../../consumer/trustState'
import { useRead, type Read } from '../useRead'
import { serverDate, type BatchDetail } from '../work'

/** The code for `text`, drawn by the lazy encoder chunk; null until loaded. */
export function useQr(text: string | null): { d: string; size: number } | null {
  const [qr, setQr] = useState<{ text: string; d: string; size: number } | null>(null)
  useEffect(() => {
    if (text === null) return
    let live = true
    void import('./qr').then(({ qrSvg }) => {
      if (live) setQr({ text, ...qrSvg(text) })
    })
    return () => {
      live = false
    }
  }, [text])
  return qr && qr.text === text ? { d: qr.d, size: qr.size } : null
}

/** The /v/ link printed on every jar (12 D10): this origin, never the batch code. */
export const jarLink = (publicId: string) => `${window.location.origin}/v/${publicId}`

const longFormat = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "14 Oct 2026", a server timestamp in the device's own calendar day. */
export function longDay(ts: string): string {
  return longFormat.format(serverDate(ts))
}

const utcFormat = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A declared day (13 §0 #10): the first ten characters of the field the
 *  person entered, read as a calendar day in no time zone at all. */
export function declaredDay(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null
  const [y, m, d] = value.slice(0, 10).split('-').map(Number)
  return utcFormat.format(new Date(Date.UTC(y, m - 1, d)))
}

const eatFormat = new Intl.DateTimeFormat('en-KE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Africa/Nairobi',
})

/** "19 Oct 2026, 14:05", always East Africa Time, so a sheet reads the same
 *  wherever it was printed. */
export function eatTime(at: Date): string {
  return eatFormat.format(at)
}

/** The jar check, and whether it is this device's saved copy: the service
 *  worker answers /verify from its cache when the network fails, and marks
 *  the answer with when it was stored (12 D15). A record sheet must know. */
function useVerify(publicId: string | null): {
  read: Read<VerifyResponse>
  cachedAt: string | null
} {
  const session = useSessionApi()
  const userId = session.userId
  const [state, setState] = useState<{ read: Read<VerifyResponse>; cachedAt: string | null }>({
    read: { status: 'loading' },
    cachedAt: null,
  })
  useEffect(() => {
    if (publicId === null || userId === null) return
    let live = true
    setState({ read: { status: 'loading' }, cachedAt: null })
    session
      .authFetch(`/v2/public/batches/${publicId}/verify`, {}, { asUser: userId })
      .then(async (res) => {
        if (!live) return
        if (!res.ok)
          return setState({ read: { status: 'error', code: res.status }, cachedAt: null })
        const data = (await res.json()) as VerifyResponse
        if (live)
          setState({
            read: { status: 'ok', data },
            cachedAt: res.headers.get('X-ApiChain-Cached-At'),
          })
      })
      .catch((e: unknown) => {
        if (live)
          setState({
            read: e instanceof OfflineError ? { status: 'offline' } : { status: 'error', code: 0 },
            cachedAt: null,
          })
      })
    return () => {
      live = false
    }
  }, [publicId, userId, session])
  return state
}

/** A batch as the console holds it, and as a shopper's scan would see it. */
export function useBatchSheet(id: number): {
  batch: Read<BatchDetail>
  verify: Read<VerifyResponse> | null
  cachedAt: string | null
} {
  const batch = useRead<BatchDetail>(`/v2/batches/${id}`)
  const publicId = batch.status === 'ok' ? batch.data.public_id : null
  const { read, cachedAt } = useVerify(publicId)
  return { batch, verify: publicId ? read : null, cachedAt }
}
