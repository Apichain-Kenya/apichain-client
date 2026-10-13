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
  const [actions, setActions] = useState<ActionRecord[]>([])
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    let live = true
    const refreshActions = () => void outbox.list(userId).then((a) => live && setActions(a))
    refreshActions()
    const off = outbox.subscribe(refreshActions)

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
          session.authFetch(`/v2/apiaries?farmer_id=${farmerId}`),
          session.authFetch('/v2/batches?limit=100'),
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
      off()
    }
  }, [userId, farmerId, session, snapshots, outbox, online])

  return { apiaries, batches, actions, fresh }
}
