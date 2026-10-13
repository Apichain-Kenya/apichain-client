// Replay triggers (12 §8): app start, coming back online, the app coming to
// the foreground, and a successful sign-in. Background Sync is deliberately
// not used in 4a (a woken service worker has no signed-in user in memory).
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Session } from '../auth/session'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { Outbox, harvestDrafts } from './outbox'
import { SyncRunner } from './runner'

let server: FakeBackend
let session: Session
let outbox: Outbox
let n = 0

const drafts = () =>
  harvestDrafts({
    farmerId: 7,
    apiaryId: 101,
    metadata: { honey_type: 'acacia' },
    harvest: { harvest_date: '2026-10-13', quantity_kg: '35.00', hive_ids: [] },
  })

beforeEach(async () => {
  server = new FakeBackend()
  server.addFarmer('+254700000001', 'hunter2', 11, 7)
  // The batch create needs the apiary to exist on the server.
  server.apiaries.push({ id: 101, farmer_id: 7 })
  session = new Session({
    fetch: server.fetch,
    locks: new FakeLocks(),
    channel: new FakeBus().channel(),
  })
  outbox = new Outbox(`runner-test-${++n}`, new FakeLocks())
})

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('SyncRunner', () => {
  it('sends what was saved offline when the phone comes back online', async () => {
    await session.signIn('+254700000001', 'hunter2')
    server.offline = true
    await outbox.enqueue(11, drafts(), Date.now())
    const runner = new SyncRunner(outbox, session)
    runner.start()
    await settle()
    expect(server.batches).toHaveLength(0)

    server.offline = false
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(server.harvests).toHaveLength(1))
    expect(server.batches).toHaveLength(1)
    runner.stop()
  })

  it('sends after a sign-in, for the person who signed in', async () => {
    await session.signIn('+254700000001', 'hunter2')
    await outbox.enqueue(11, drafts(), Date.now())
    await session.signOut()
    const runner = new SyncRunner(outbox, session)
    runner.start()
    await settle()
    expect(server.batches).toHaveLength(0) // signed out: nothing sends

    await session.signIn('+254700000001', 'hunter2')
    await vi.waitFor(() => expect(server.batches).toHaveLength(1))
    runner.stop()
  })

  it('reports the pause reason for the UI', async () => {
    await session.signIn('+254700000001', 'hunter2')
    await outbox.enqueue(11, drafts(), Date.now())
    server.offline = true
    const runner = new SyncRunner(outbox, session)
    runner.start()
    await vi.waitFor(() => expect(runner.state.paused).toBe('offline'))
    runner.stop()
  })
})
