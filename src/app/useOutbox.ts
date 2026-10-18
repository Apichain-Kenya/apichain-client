import { createContext, useContext } from 'react'

import type { Outbox } from '../offline/outbox'
import type { SyncRunner } from '../offline/runner'

export type OutboxView = { outbox: Outbox; sync: SyncRunner }

export const OutboxContext = createContext<OutboxView | null>(null)

/** The outbox and its runner, for a screen that saves work offline. */
export function useOutbox(): OutboxView {
  const v = useContext(OutboxContext)
  if (!v) throw new Error('useOutbox outside Providers')
  return v
}
