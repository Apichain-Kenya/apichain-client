import { createContext, useContext } from 'react'

import type { SyncState } from '../offline/runner'

// `persistent`: whether the browser agreed not to evict saved harvests under
// storage pressure (null until asked). Shown on the farmer's Me page.
export type SyncView = SyncState & { waiting: number; persistent: boolean | null }

export const SyncContext = createContext<SyncView>({
  running: false,
  paused: null,
  lastSent: 0,
  waiting: 0,
  persistent: null,
})

/** What the sync chip and the offline copy need: how much is waiting, why. */
export const useSync = () => useContext(SyncContext)
