// One consent choice as a screen shows it (13 §9 item 3, §11 item 1): the
// server's, unless this device holds a newer one of this person's. Shared by
// the console's farmer page and the farmer's own Me page, so neither chunk
// pulls in the other's code.
import type { components } from '../api/client/schema'
import type { ActionRecord } from './outbox'

export type ConsentState = components['schemas']['ConsentStateOut']

/** One choice as the page shows it: the server's, unless this device holds a
 *  newer one of this person's. */
export type Choice = {
  on: boolean
  /** Still on this device (or on its way): the server does not have it yet. */
  pending: boolean
  /** Who set it last: this person here, or the server's `granted_via`. */
  by: 'you' | 'onboarder' | 'farmer_self' | null
  at: string | null
  /** The farmer took it back themselves; staff may not turn it on again. */
  locked: boolean
}

// The newest of this person's saved choices for the purpose wins while it is
// queued, and once sent while the server's row is not newer than its answer
// (the farmer may since have changed it from their own phone). A refused
// choice never counts: it is shown apart, to be removed.
export function choiceOf(server: ConsentState | undefined, local: ActionRecord[]): Choice {
  const mine = local.filter((r) => r.status !== 'needs_attention').at(-1)
  const recorded = (mine?.server_result?.recorded_at as string | undefined) ?? null
  const serverAt = server?.recorded_at ?? null
  const fromServer: Choice = {
    on: server?.granted ?? false,
    pending: false,
    by: server?.granted_via ?? null,
    at: serverAt,
    locked: server?.granted_via === 'farmer_self' && !server.granted,
  }
  if (!mine) return fromServer
  if (mine.status === 'sent' && serverAt !== null && recorded !== null && serverAt >= recorded) {
    return fromServer
  }
  return {
    on: mine.body.granted === true,
    pending: mine.status === 'queued',
    by: 'you',
    at: recorded,
    locked: false,
  }
}

/** A key that changes whenever one of these rows settles: sent, refused or
 *  removed. The page reloads what the server holds on each change. */
export function settledKey(rows: ActionRecord[] | null): string | null {
  return rows ? rows.map((r) => (r.status === 'queued' ? '' : r.id + r.status)).join() : null
}
