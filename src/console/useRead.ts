import { useEffect, useRef, useState } from 'react'

import { OfflineError } from '../auth/session'
import { useSessionApi } from '../auth/SessionContext'

export type Read<T> =
  | { status: 'loading' }
  | { status: 'ok'; data: T }
  | { status: 'offline' }
  | { status: 'error'; code: number }

// A console read: online only, and never kept on the device (13 D15: a
// console is often a shared laptop). `path` null means "nothing to read yet".
// `asUser` keeps a renewal into someone else's session from showing them
// this person's screen. A `reload` of the same thing keeps what is on screen
// until the fresh copy arrives, so a step just sent never blinks out (13 §8.4).
export function useRead<T>(path: string | null, reload = 0): Read<T> {
  const session = useSessionApi()
  const [state, setState] = useState<Read<T>>({ status: 'loading' })
  const userId = session.userId
  const shown = useRef<string | null>(null)

  useEffect(() => {
    if (path === null || userId === null) return
    let live = true
    const what = `${userId} ${path}`
    const again = shown.current === what
    if (!again) setState({ status: 'loading' })
    shown.current = what
    // A failed reload leaves the last good copy on screen.
    const fail = (next: Read<T>) =>
      setState((prev) => (again && prev.status === 'ok' ? prev : next))
    session
      .authFetch(path, {}, { asUser: userId })
      .then(async (res) => {
        if (!live) return
        if (!res.ok) return fail({ status: 'error', code: res.status })
        const data = (await res.json()) as T
        if (live) setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (!live) return
        if (e instanceof OfflineError) fail({ status: 'offline' })
        else fail({ status: 'error', code: 0 })
      })
    return () => {
      live = false
    }
  }, [path, userId, session, reload])

  return state
}
