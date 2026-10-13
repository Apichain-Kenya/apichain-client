import { useEffect, useState } from 'react'

import type { components } from '../api/client/schema'
import type { ActionRecord } from '../offline/outbox'
import { useFarm } from './FarmServices'

export type Apiary = components['schemas']['ApiaryResponse']
export type BatchSummary = components['schemas']['BatchSummary']

/**
 * The farmer's apiaries and sent batches: from the server when it answers,
 * otherwise the last snapshot on this phone. Plus the outbox, live.
 * `fresh` says whether the server lists were reached this time.
 */
export function useFarmData(userId: number, farmerId: number | null) {
  const { session, snapshots, outbox, online } = useFarm()
  const [apiaries, setApiaries] = useState<Apiary[] | null>(null)
  const [batches, setBatches] = useState<BatchSummary[] | null>(null)
  const [actions, setActions] = useState<ActionRecord[] | null>(null)
  const [fresh, setFresh] = useState(false)
  // How many harvests have reached the server. When it grows (the outbox just
  // sent one), fetch the sent list again so the harvest does not vanish from
  // the screen between "on this phone" and the server's list (review).
  // -1 until the outbox has loaded, so a reload does not fetch twice.
  const sentHarvests =
    actions === null
      ? -1
      : actions.filter((a) => a.kind === 'batch.harvest' && a.status === 'sent').length

  useEffect(() => {
    let live = true
    const off = outbox.subscribe(() => void outbox.list(userId).then((a) => live && setActions(a)))
    void outbox.list(userId).then((a) => live && setActions(a))
    return () => {
      live = false
      off()
    }
  }, [userId, outbox])

  useEffect(() => {
    let live = true
    if (sentHarvests < 0) return
    void (async () => {
      const [a, b] = await Promise.all([
        snapshots.get<Apiary[]>(userId, 'apiaries'),
        snapshots.get<BatchSummary[]>(userId, 'batches'),
      ])
      if (!live) return
      setApiaries(a ?? [])
      setBatches(b ?? null)
      if (!online() || farmerId === null) return
      try {
        const [ra, rb] = await Promise.all([
          // asUser: if renewing the session turns it into someone else, these
          // are not retried, so another farmer's lists are never saved
          // under this one's snapshot (review).
          session.authFetch(`/v2/apiaries?farmer_id=${farmerId}`, {}, { asUser: userId }),
          session.authFetch('/v2/batches?limit=100', {}, { asUser: userId }),
        ])
        if (ra.ok) {
          const list = (await ra.json()) as Apiary[]
          await snapshots.set(userId, 'apiaries', list)
          if (live) setApiaries(list)
        }
        if (rb.ok) {
          const page = (await rb.json()) as { items: BatchSummary[] }
          await snapshots.set(userId, 'batches', page.items)
          if (live) {
            setBatches(page.items)
            setFresh(true)
          }
        }
      } catch {
        // Offline after all: the snapshot stands.
      }
    })()
    return () => {
      live = false
    }
  }, [userId, farmerId, session, snapshots, online, sentHarvests])

  return { apiaries, batches, actions: actions ?? [], fresh }
}
