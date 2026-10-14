import { createContext, useContext } from 'react'

import type { components } from '../api/client/schema'
import type { Session } from './session'

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

// The session object itself, for the screens that act on it (sign in, change
// password, sign out) in both the capture app and the console.
export const SessionApiContext = createContext<Session | null>(null)

export function useSessionApi(): Session {
  const s = useContext(SessionApiContext)
  if (!s) throw new Error('useSessionApi outside Providers')
  return s
}
