// The offline outbox (12 §8, D6): capture commits locally at once, replays
// in order on reconnect, chains dependent actions by local reference, sends
// the same key and the same resolved body on every retry, and never sends
// one person's saved work under another person's session.
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'

import { Session } from '../auth/session'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { Outbox, harvestDrafts, type ActionRecord } from './outbox'

let server: FakeBackend
let session: Session
let outbox: Outbox
let clock: number
let dbn = 0

const NOW = Date.parse('2026-10-13T06:52:00Z')
const HARVEST = { harvest_date: '2026-10-13', quantity_kg: '35.00', hive_ids: [] }
const METADATA = {
  honey_type: 'acacia',
  expected_yield_kg: '28.00',
  harvest_window_start: '2026-10-13',
  harvest_window_end: '2026-10-13',
  apiary_management_method: 'organic',
}

async function signedIn(identifier = '+254700000001') {
  const s = new Session({
    fetch: server.fetch,
    locks: new FakeLocks(),
    channel: new FakeBus().channel(),
  })
  expect(await s.signIn(identifier, 'hunter2')).toBe('ok')
  return s
}

function newApiaryHarvest(farmerId = 7) {
  return harvestDrafts({
    farmerId,
    apiary: { name: 'Ridge', latitude: '-0.428713', longitude: '36.951247', hive_count: 6 },
    metadata: METADATA,
    harvest: HARVEST,
  })
}

const replay = (userId = 11) => outbox.replay(userId, session, () => clock)
const byKind = (rows: ActionRecord[]) => Object.fromEntries(rows.map((r) => [r.kind, r]))

beforeEach(async () => {
  server = new FakeBackend()
  server.addFarmer('+254700000001', 'hunter2', 11, 7)
  server.addFarmer('+254700000002', 'hunter2', 12, 8)
  clock = NOW
  outbox = new Outbox(`outbox-test-${++dbn}`, new FakeLocks())
  session = await signedIn()
})

describe('capture', () => {
  it('commits a new apiary and its harvest as three linked actions, offline', async () => {
    server.offline = true
    const rows = await outbox.enqueue(11, newApiaryHarvest(), clock)
    expect(rows.map((r) => r.kind)).toEqual(['apiary.create', 'batch.create', 'batch.harvest'])
    expect(rows.every((r) => r.status === 'queued')).toBe(true)
    const k = byKind(rows)
    expect(k['batch.create'].depends_on).toEqual([k['apiary.create'].local_ref])
    expect(k['batch.harvest'].depends_on).toEqual([k['batch.create'].local_ref])
    expect(new Set(rows.map((r) => r.idempotency_key)).size).toBe(3)
    expect(server.requests).toHaveLength(0)
  })

  it('an existing apiary makes a two-action harvest', async () => {
    const rows = await outbox.enqueue(
      11,
      harvestDrafts({ farmerId: 7, apiaryId: 101, metadata: METADATA, harvest: HARVEST }),
      clock,
    )
    expect(rows.map((r) => r.kind)).toEqual(['batch.create', 'batch.harvest'])
    expect(rows[0].body).toMatchObject({ apiary_id: 101, farmer_id: 7 })
  })
})

describe('replay', () => {
  it('sends in order, resolving each reference before its dependant sends', async () => {
    server.offline = true
    await outbox.enqueue(11, newApiaryHarvest(), clock)
    server.offline = false

    const result = await replay()
    expect(result).toEqual({ sent: 3, paused: null })
    expect(server.requests.map((r) => r.path)).toEqual([
      '/v2/apiaries',
      '/v2/batches',
      `/v2/batches/${server.batches[0].id}/harvest`,
    ])
    expect(server.requests[1].body.apiary_id).toBe(server.apiaries[0].id)
    expect((await outbox.list(11)).every((r) => r.status === 'sent')).toBe(true)
  })

  it('a reply lost after the server committed still makes exactly one batch', async () => {
    await outbox.enqueue(11, newApiaryHarvest(), clock)
    server.loseNextResponse = true // the apiary commits; the phone hears nothing

    expect((await replay()).paused).toBe('offline')
    clock += 60_000
    await replay()

    expect(server.apiaries).toHaveLength(1)
    expect(server.batches).toHaveLength(1)
    expect(server.harvests).toHaveLength(1)
    const keys = server.requests.filter((r) => r.path === '/v2/apiaries').map((r) => r.key)
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('persists the resolved body before the first send, so retries are identical', async () => {
    await outbox.enqueue(11, newApiaryHarvest(), clock)
    server.loseResponseFor = '/v2/batches' // the apiary sends; the batch's reply is lost
    await replay()
    const stored = byKind(await outbox.list(11))['batch.create']
    expect(stored.resolved).toBe(true)
    expect(stored.body.apiary_id).toBe(server.apiaries[0].id)

    clock += 60_000
    await replay()
    const batchBodies = server.requests.filter((r) => r.path === '/v2/batches').map((r) => r.body)
    expect(batchBodies).toHaveLength(2)
    expect(batchBodies[0]).toEqual(batchBodies[1])
    expect(server.batches).toHaveLength(1)
  })

  it('waits for the backoff before retrying', async () => {
    await outbox.enqueue(11, newApiaryHarvest(), clock)
    server.offline = true
    await replay()
    server.offline = false
    expect((await replay()).sent).toBe(0) // still inside the 2 s backoff
    clock += 2_500
    expect((await replay()).sent).toBe(3)
  })

  it('a refused action needs attention and holds its dependants, sending nothing else', async () => {
    const drafts = newApiaryHarvest()
    drafts[2].body = { ...drafts[2].body, quantity_kg: '0' }
    await outbox.enqueue(11, drafts, clock)

    await replay()
    const k = byKind(await outbox.list(11))
    expect(k['apiary.create'].status).toBe('sent')
    expect(k['batch.create'].status).toBe('sent')
    expect(k['batch.harvest'].status).toBe('needs_attention')
    expect(k['batch.harvest'].last_error).toMatchObject({ status: 422, code: 'invalid_quantity' })
  })

  it('fixing and sending again uses a new key, and nothing is discarded', async () => {
    const drafts = newApiaryHarvest()
    drafts[2].body = { ...drafts[2].body, quantity_kg: '0' }
    await outbox.enqueue(11, drafts, clock)
    await replay()
    const bad = byKind(await outbox.list(11))['batch.harvest']

    const fixed = await outbox.fixAndResend(bad.id, { ...bad.body, quantity_kg: '35.00' }, clock)
    expect(fixed.idempotency_key).not.toBe(bad.idempotency_key)
    await replay()
    expect(server.harvests).toHaveLength(1)
    expect((await outbox.list(11)).some((r) => r.id === bad.id)).toBe(false)
  })

  it('pauses the whole queue when the session cannot be renewed, keeping every item', async () => {
    await outbox.enqueue(11, newApiaryHarvest(), clock)
    server.revokeAllSessions()
    expect((await replay()).paused).toBe('signed_out')
    expect(await outbox.list(11)).toHaveLength(3)
    expect((await outbox.list(11)).every((r) => r.status === 'queued')).toBe(true)
  })
})

describe('user scoping', () => {
  it("never sends or shows one person's saved work under another's session", async () => {
    await outbox.enqueue(11, newApiaryHarvest(7), clock) // Wanjiru, offline capture
    session = await signedIn('+254700000002') // someone else signs in on this phone

    expect(await outbox.list(12)).toHaveLength(0)
    expect((await outbox.replay(12, session, () => clock)).sent).toBe(0)
    expect(server.requests).toHaveLength(0)
    // Replaying Wanjiru's queue under this session is refused outright.
    await expect(outbox.replay(11, session, () => clock)).rejects.toThrow(/belongs to another user/)

    session = await signedIn('+254700000001') // Wanjiru again
    expect((await replay()).sent).toBe(3)
  })

  it('counts what is waiting per user', async () => {
    await outbox.enqueue(11, newApiaryHarvest(), clock)
    expect(await outbox.waiting(11)).toBe(3)
    expect(await outbox.waiting(12)).toBe(0)
  })

  it("never sends one person's queue after the session renews as someone else", async () => {
    // Farmer A captured offline and the app reopened as A from the remembered
    // identity, with no token. The cookie in the jar, though, is B's (B signed
    // in on this phone last). Renewing online would make the session B.
    const device = new Map<string, string>([
      [
        'apichain-last-me',
        JSON.stringify({ user_id: 11, role: 'farmer', display_name: 'A', farmer_id: 7 }),
      ],
    ])
    const storage = {
      getItem: (k: string) => device.get(k) ?? null,
      setItem: (k: string, v: string) => void device.set(k, v),
      removeItem: (k: string) => void device.delete(k),
    }
    await outbox.enqueue(11, newApiaryHarvest(7), clock)
    await new Session({
      fetch: server.fetch,
      locks: new FakeLocks(),
      channel: null,
      storage: null,
    }).signIn('+254700000002', 'hunter2') // B's cookie is now the jar's
    server.offline = true
    const a = new Session({ fetch: server.fetch, locks: new FakeLocks(), channel: null, storage })
    await a.restore()
    expect(a.userId).toBe(11) // offline session as A
    server.offline = false

    const result = await outbox.replay(11, a, () => clock)
    expect(result.sent).toBe(0)
    expect(result.paused).toBe('signed_out')
    expect(server.apiaries).toHaveLength(0)
    expect((await outbox.list(11)).every((r) => r.status === 'queued')).toBe(true)
  })
})
