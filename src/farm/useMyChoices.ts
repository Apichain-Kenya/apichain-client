import { useEffect, useState } from 'react'

import type { components } from '../api/client/schema'
import { settledKey } from '../offline/choice'
import type { ActionRecord } from '../offline/outbox'
import { useFarm } from './FarmServices'

type Detail = components['schemas']['FarmerDetail']
export type ConsentStates = components['schemas']['ConsentStateResponse']
/** All this phone keeps of the farmer's profile: what the Me page shows. */
export type Contact = { phone: string; has_email: boolean }

/**
 * The farmer's own message choices (13 §11 item 1): their saved
 * `consent.record` actions, live, and what the server holds, read again
 * whenever one settles. Like the harvest lists, the server's answer is kept
 * on this phone, so the switches still work after an offline reload.
 */
export function useMyChoices(userId: number, farmerId: number | null) {
  const { session, snapshots, outbox, online } = useFarm()
  const [rows, setRows] = useState<ActionRecord[] | null>(null)
  const [contact, setContact] = useState<Contact | null>(null)
  const [states, setStates] = useState<ConsentStates | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      void outbox.list(userId).then((all) => {
        if (!live) return
        setRows(
          all
            .filter((r) => r.kind === 'consent.record' && r.body.farmer_id === farmerId)
            .sort((a, b) => a.seq - b.seq),
        )
      })
    load()
    const off = outbox.subscribe(load)
    return () => {
      live = false
      off()
    }
  }, [outbox, userId, farmerId])

  const settled = settledKey(rows)
  useEffect(() => {
    if (settled === null || farmerId === null) return
    let live = true
    void (async () => {
      const [c, s] = await Promise.all([
        snapshots.get<Contact>(userId, 'contact'),
        snapshots.get<ConsentStates>(userId, 'consents'),
      ])
      if (!live) return
      if (c) setContact(c)
      if (s) setStates(s)
      if (!online()) return
      try {
        const [rd, rs] = await Promise.all([
          session.authFetch(`/v2/farmers/${farmerId}`, {}, { asUser: userId }),
          session.authFetch(`/v2/farmers/${farmerId}/consents`, {}, { asUser: userId }),
        ])
        if (rd.ok) {
          const d = (await rd.json()) as Detail
          const kept: Contact = { phone: d.phone, has_email: d.has_email }
          await snapshots.set(userId, 'contact', kept)
          if (live) setContact(kept)
        }
        if (rs.ok) {
          const list = (await rs.json()) as ConsentStates
          await snapshots.set(userId, 'consents', list)
          if (live) setStates(list)
        }
      } catch {
        // Offline after all: what this phone last saw stands.
      }
    })()
    return () => {
      live = false
    }
  }, [settled, userId, farmerId, session, snapshots, online])

  return { rows, contact, states }
}
