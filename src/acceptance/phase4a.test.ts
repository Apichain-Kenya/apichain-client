// Phase 4a acceptance (12 §1), client side: the phase's evidence in one file.
// The detailed cases live next to their code; this walks the acceptance
// items end to end against the in-memory backend.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

import { Session } from '../auth/session'
import inProgress from '../consumer/__fixtures__/in_progress.json'
import mismatch from '../consumer/__fixtures__/mismatch.json'
import sealed from '../consumer/__fixtures__/sealed.json'
import sealing from '../consumer/__fixtures__/sealing.json'
import { trustState, type VerifyResponse } from '../consumer/trustState'
import { Outbox, harvestDrafts } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'

const DRAFT = {
  farmerId: 7,
  apiary: { name: 'Ridge', latitude: '-0.428713', longitude: '36.951247', hive_count: 6 },
  metadata: {
    honey_type: 'acacia',
    expected_yield_kg: '28.00',
    harvest_window_start: '2026-10-13',
    harvest_window_end: '2026-10-13',
    apiary_management_method: 'organic',
  },
  harvest: { harvest_date: '2026-10-13', quantity_kg: '35.00', hive_ids: [] },
}

describe('Phase 4a acceptance', () => {
  it('a farmer registers a harvest offline and it reaches the server exactly once on reconnect', async () => {
    const server = new FakeBackend()
    server.addFarmer('+254700000001', 'hunter2', 11, 7)
    const locks = new FakeLocks()
    const session = new Session({ fetch: server.fetch, locks, channel: new FakeBus().channel() })
    expect(await session.signIn('+254700000001', 'hunter2')).toBe('ok')

    // At the apiary: no signal.
    server.offline = true
    const outbox = new Outbox('acceptance-outbox', locks)
    await outbox.enqueue(11, harvestDrafts(DRAFT), Date.now())
    expect(await outbox.waitingHarvests(11)).toBe(1)

    // Back in signal, and the first reply is lost after the server commits.
    server.offline = false
    server.loseNextResponse = true
    const runner = new SyncRunner(outbox, session)
    runner.start() // the app opens: first attempt, whose reply is lost
    await vi.waitFor(() => expect(runner.state.paused).toBe('offline'))
    window.dispatchEvent(new Event('online')) // signal steadies: retried, same key
    await vi.waitFor(async () => expect(await outbox.waitingHarvests(11)).toBe(0))
    runner.stop()

    expect(server.apiaries).toHaveLength(1)
    expect(server.batches).toHaveLength(1)
    expect(server.harvests).toHaveLength(1)
    expect(server.batches[0].apiary_id).toBe(server.apiaries[0].id)
  })

  it('a different person on the same phone never sends someone else’s saved work', async () => {
    const server = new FakeBackend()
    server.addFarmer('+254700000001', 'hunter2', 11, 7)
    server.addFarmer('+254700000002', 'hunter2', 12, 8)
    const locks = new FakeLocks()
    const outbox = new Outbox('acceptance-outbox-2', locks)
    server.offline = true
    await outbox.enqueue(11, harvestDrafts(DRAFT), Date.now())
    server.offline = false

    const other = new Session({ fetch: server.fetch, locks, channel: new FakeBus().channel() })
    await other.signIn('+254700000002', 'hunter2')
    expect((await outbox.replay(12, other, Date.now)).sent).toBe(0)
    await expect(outbox.replay(11, other, Date.now)).rejects.toThrow()
    expect(server.requests).toHaveLength(0)
  })

  it('a consumer sees an honest trust state for every kind of jar, including seal pending', () => {
    const states = [sealed, sealing, inProgress, mismatch].map((v) =>
      trustState(v as unknown as VerifyResponse),
    )
    expect(states).toEqual(['sealed', 'sealing', 'in_progress', 'mismatch'])
  })
})
