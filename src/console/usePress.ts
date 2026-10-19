import { useCallback, useRef } from 'react'

import { OfflineError } from '../auth/session'
import { useSessionApi } from '../auth/SessionContext'

export type PressResult =
  | { kind: 'ok'; data: Record<string, unknown> }
  | { kind: 'offline' }
  | {
      kind: 'refused'
      status: number
      code?: string
      details?: Record<string, unknown>
      /** Seconds, from a 429's `Retry-After`. */
      retryAfter?: number
    }

// An online-only write (13 §3): never the outbox, so nothing of it, a
// password least of all, is kept on the device. The Idempotency-Key is minted
// when the person presses the button and reused only to retry that press
// after the connection dropped. Any edit to the form calls `fresh()`, since a
// password is not in the server's fingerprint (D4) and an edited retry under
// the old key would replay the first answer. A refusal frees the key: the
// server rolls it back with the rest of the request.
export function usePress() {
  const session = useSessionApi()
  const key = useRef<string | null>(null)

  const fresh = useCallback(() => {
    key.current = null
  }, [])

  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<PressResult> => {
      const userId = session.userId
      if (userId === null) return { kind: 'refused', status: 401 }
      key.current ??= globalThis.crypto.randomUUID()
      let res: Response
      try {
        res = await session.authFetch(
          path,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key.current },
            body: JSON.stringify(body),
          },
          { asUser: userId },
        )
      } catch (e) {
        if (e instanceof OfflineError) return { kind: 'offline' }
        throw e
      }
      key.current = null
      if (res.ok) return { kind: 'ok', data: (await res.json()) as Record<string, unknown> }
      const err = (await res.json().catch(() => ({}))) as {
        code?: string
        details?: Record<string, unknown>
      }
      const wait = Number(res.headers.get('Retry-After'))
      return {
        kind: 'refused',
        status: res.status,
        code: err.code,
        details: err.details ?? undefined,
        retryAfter: wait > 0 ? wait : undefined,
      }
    },
    [session],
  )

  return { post, fresh }
}
