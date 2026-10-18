import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { SessionApiContext, SessionContext, type SessionState } from '../auth/SessionContext'
import type { Session } from '../auth/session'
import type { Outbox } from '../offline/outbox'
import type { SyncRunner, SyncState } from '../offline/runner'
import { OutboxContext } from './useOutbox'
import { SyncContext } from './useSync'

/** Binds the session and the outbox to React; starts both once. */
export function Providers({
  session,
  outbox,
  sync,
  children,
}: {
  session: Session
  outbox: Outbox
  sync: SyncRunner
  children: ReactNode
}) {
  const [state, setState] = useState<SessionState>(session.state)
  const [syncState, setSyncState] = useState<SyncState>(sync.state)
  const [waiting, setWaiting] = useState(0)
  const [persistent, setPersistent] = useState<boolean | null>(null)
  const services = useMemo(() => ({ outbox, sync }), [outbox, sync])

  useEffect(() => {
    const offSession = session.subscribe(setState)
    const offSync = sync.subscribe(setSyncState)
    const count = () => {
      const id = session.userId
      if (id === null) return setWaiting(0)
      void outbox.waitingWork(id).then(setWaiting)
    }
    const offOutbox = outbox.subscribe(count)
    const offCount = session.subscribe(count)
    // Also now: after sign-in this mounts with the session already signed in,
    // so no event would come and the count read 0 until something changed.
    count()
    // After the first sign-in, ask the browser not to evict the outbox under
    // storage pressure (12 risk 1). Asking needs no prompt on Chrome Android.
    let asked = false
    const offPersist = session.subscribe((s) => {
      if (asked || s.status !== 'signed_in' || !navigator.storage?.persist) return
      asked = true
      void navigator.storage
        .persist()
        .then(setPersistent)
        .catch(() => setPersistent(false))
    })
    // Only on a fresh page load: moving between /sign-in and /farm remounts
    // this, and a second restore right after login wasted a refresh (review).
    if (session.state.status === 'restoring') void session.restore()
    sync.start()
    return () => {
      offSession()
      offSync()
      offOutbox()
      offCount()
      offPersist()
      sync.stop()
    }
  }, [session, outbox, sync])

  return (
    <SessionApiContext.Provider value={session}>
      <SessionContext.Provider value={state}>
        <SyncContext.Provider value={{ ...syncState, waiting, persistent }}>
          <OutboxContext.Provider value={services}>{children}</OutboxContext.Provider>
        </SyncContext.Provider>
      </SessionContext.Provider>
    </SessionApiContext.Provider>
  )
}
