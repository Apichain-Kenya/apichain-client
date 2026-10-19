import type { ActionRecord } from '../offline/outbox'
import type { Fix } from './FarmServices'

export type Honey = 'acacia' | 'wildflower' | 'eucalyptus' | 'sunflower' | 'mixed'
export type Method = 'organic' | 'conventional' | 'regenerative'

/** What the harvest form holds. `where` is an apiary id, or 'new'. */
export type HarvestForm = {
  where: string | null
  name: string
  hives: number
  fix: Fix | null
  honey: Honey
  kg: number
  expected: number
  method: Method
  day: string
}

/**
 * A refused harvest's chain (13 §11 item 2): its harvest, the batch it goes
 * in, and the new apiary, if it made one. A part the server already accepted
 * stays as it is: only a part never sent may change, since a new key on one
 * the server holds would record it twice.
 */
export type FixGroup = {
  harvest: ActionRecord
  batch: ActionRecord
  apiary?: ActionRecord
  editApiary: boolean
  editBatch: boolean
  /** The refusal the farmer is fixing. */
  refused: ActionRecord
}

export function fixGroup(actions: ActionRecord[], harvestId: string): FixGroup | null {
  const byRef = new Map(actions.map((a) => [a.local_ref, a]))
  const harvest = actions.find((a) => a.id === harvestId && a.kind === 'batch.harvest')
  const batch = harvest && byRef.get(harvest.depends_on[0])
  if (!harvest || !batch || harvest.status === 'sent') return null
  const apiary = batch.depends_on[0] ? byRef.get(batch.depends_on[0]) : undefined
  const refused = [apiary, batch, harvest].find((a) => a?.status === 'needs_attention')
  if (!refused) return null
  return {
    harvest,
    batch,
    apiary,
    editApiary: !!apiary && apiary.status !== 'sent',
    editBatch: batch.status !== 'sent',
    refused,
  }
}

/** The form as the farmer last saved it, from the stored bodies. */
export function formOf(g: FixGroup): HarvestForm {
  const a = g.apiary?.body
  const meta = (g.batch.body.metadata ?? {}) as Record<string, unknown>
  return {
    where: a ? 'new' : String(g.batch.body.apiary_id),
    name: a ? String(a.name ?? '') : '',
    hives: a ? Number(a.hive_count ?? 1) : 1,
    // The stored point has no GPS accuracy: 0 says "the place saved before".
    fix: a ? { lat: Number(a.latitude), lon: Number(a.longitude), accuracy: 0 } : null,
    honey: (meta.honey_type as Honey | undefined) ?? 'mixed',
    kg: Number(g.harvest.body.quantity_kg ?? 0),
    expected: Number(meta.expected_yield_kg ?? 0),
    method: (meta.apiary_management_method as Method | undefined) ?? 'organic',
    day: String(g.harvest.body.harvest_date),
  }
}

/** The request bodies the form makes, for a new harvest or a fixed one. */
export function bodiesOf(f: HarvestForm, farmerId: number) {
  return {
    apiary: {
      farmer_id: farmerId,
      name: f.name.trim(),
      latitude: f.fix?.lat.toFixed(6),
      longitude: f.fix?.lon.toFixed(6),
      hive_count: f.hives,
    },
    metadata: {
      honey_type: f.honey,
      expected_yield_kg: (f.expected || f.kg).toFixed(2),
      harvest_window_start: f.day,
      harvest_window_end: f.day,
      apiary_management_method: f.method,
    },
    harvest: { harvest_date: f.day, quantity_kg: f.kg.toFixed(2), hive_ids: [] },
  }
}

/** The fixes for `Outbox.fixAll`: every part not yet sent, parents first,
 *  each pointing at its parent by local reference as at capture. */
export function fixesOf(g: FixGroup, f: HarvestForm, farmerId: number) {
  const b = bodiesOf(f, farmerId)
  const fixes: { id: string; body: Record<string, unknown> }[] = []
  if (g.apiary && g.editApiary) fixes.push({ id: g.apiary.id, body: b.apiary })
  if (g.editBatch) {
    fixes.push({
      id: g.batch.id,
      body: {
        farmer_id: farmerId,
        apiary_id: g.apiary ? { $ref: g.apiary.local_ref } : Number(f.where),
        metadata: b.metadata,
      },
    })
  }
  fixes.push({
    id: g.harvest.id,
    body: { batch_id: { $ref: g.batch.local_ref }, ...b.harvest },
  })
  return fixes
}
