import { createContext, useContext } from 'react'

import type { Session } from '../auth/session'
import type { Outbox } from '../offline/outbox'
import type { SyncRunner } from '../offline/runner'
import type { Snapshots } from '../offline/snapshots'

/** A device position, with its accuracy radius in metres. */
export type Fix = { lat: number; lon: number; accuracy: number }

// Everything the farmer app touches outside React, injected so the whole
// capture flow is testable offline (12 §11).
export type FarmServices = {
  session: Session
  outbox: Outbox
  sync: SyncRunner
  snapshots: Snapshots
  today: () => string // YYYY-MM-DD in the farmer's local day
  now: () => number
  locate: () => Promise<Fix>
  online: () => boolean
}

export const FarmServicesContext = createContext<FarmServices | null>(null)

export function useFarm(): FarmServices {
  const s = useContext(FarmServicesContext)
  if (!s) throw new Error('useFarm outside FarmServicesContext')
  return s
}
