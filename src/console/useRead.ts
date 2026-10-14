import { useEffect, useState } from 'react'

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
// this person's screen.
export function useRead<T>(path: string | null, reload = 0): Read<T> {
  const session = useSessionApi()
  const [state, setState] = useState<Read<T>>({ status: 'loading' })
  const userId = session.userId

  useEffect(() => {
    if (path === null || userId === null) return
    let live = true
    setState({ status: 'loading' })
    session
      .authFetch(path, {}, { asUser: userId })
      .then(async (res) => {
        if (!live) return
        if (!res.ok) return setState({ status: 'error', code: res.status })
        const data = (await res.json()) as T
        if (live) setState({ status: 'ok', data })
      })
      .catch((e: unknown) => {
        if (!live) return
        if (e instanceof OfflineError) setState({ status: 'offline' })
        else setState({ status: 'error', code: 0 })
      })
    return () => {
      live = false
    }
  }, [path, userId, session, reload])

  return state
}
