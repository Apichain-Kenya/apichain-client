import { createContext, useContext } from 'react'

import type { SyncState } from '../offline/runner'

export type SyncView = SyncState & { waiting: number }

export const SyncContext = createContext<SyncView>({
  running: false,
  paused: null,
  lastSent: 0,
  waiting: 0,
})

/** What the sync chip and the offline copy need: how much is waiting, why. */
export const useSync = () => useContext(SyncContext)
