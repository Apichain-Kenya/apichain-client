import { createContext, useContext } from 'react'

import type { components } from '../api/client/schema'

export type Me = components['schemas']['MeResponse']

// `restoring` is the page-load window while a silent refresh from the cookie
// runs (12 §8): guards wait instead of bouncing a signed-in farmer to sign-in.
export type SessionState =
  | { status: 'restoring'; me: null }
  | { status: 'anonymous'; me: null }
  | { status: 'signed_in'; me: Me }

export const SessionContext = createContext<SessionState>({ status: 'restoring', me: null })

export function useSession(): SessionState {
  return useContext(SessionContext)
}
