import { useEffect, useState, type ReactNode } from 'react'

import { SessionContext, type SessionState } from '../auth/SessionContext'
import type { Session } from '../auth/session'
import type { Outbox } from '../offline/outbox'
import type { SyncRunner, SyncState } from '../offline/runner'
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

  useEffect(() => {
    const offSession = session.subscribe(setState)
    const offSync = sync.subscribe(setSyncState)
    const count = () => {
      const id = session.userId
      if (id === null) return setWaiting(0)
      void outbox.waiting(id).then(setWaiting)
    }
    const offOutbox = outbox.subscribe(count)
    const offCount = session.subscribe(count)
    void session.restore()
    sync.start()
    return () => {
      offSession()
      offSync()
      offOutbox()
      offCount()
      sync.stop()
    }
  }, [session, outbox, sync])

  return (
    <SessionContext.Provider value={state}>
      <SyncContext.Provider value={{ ...syncState, waiting }}>{children}</SyncContext.Provider>
    </SessionContext.Provider>
  )
}
