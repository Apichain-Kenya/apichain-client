// Pre-merge review fixes (Phase 4a review, 2026-10-13). Each case failed
// before its fix.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Providers } from '../app/Providers'
import { Session } from '../auth/session'
import ScanPage from '../consumer/ScanPage'
import { localDay } from '../farm/dayLabel'
import { Outbox, harvestDrafts } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { FakeBackend, FakeLocks } from './fakeBackend'

const DRAFT = {
  farmerId: 7,
  apiaryId: 101,
  metadata: { honey_type: 'acacia' },
  harvest: { harvest_date: '2026-10-13', quantity_kg: '35.00', hive_ids: [] },
}
let n = 0

async function farmer() {
  const server = new FakeBackend()
  server.addFarmer('+254700000001', 'hunter2', 11, 7)
  server.apiaries.push({ id: 101, farmer_id: 7 })
  const session = new Session({
    fetch: server.fetch,
    locks: new FakeLocks(),
    channel: null,
    storage: null,
  })
  await session.signIn('+254700000001', 'hunter2')
  return { server, session }
}

describe('outbox', () => {
  it('network failures do not use up the in-progress conflict retries', async () => {
    const { server, session } = await farmer()
    const outbox = new Outbox(`review-${++n}`, new FakeLocks())
    await outbox.enqueue(11, harvestDrafts(DRAFT), 0)
    server.offline = true
    for (let i = 0; i < 4; i++) await outbox.replay(11, session, () => 0, { ignoreBackoff: true })
    server.offline = false
    server.conflictNext = true // the earlier attempt is still committing
    await outbox.replay(11, session, () => 0, { ignoreBackoff: true })
    const batch = (await outbox.list(11)).find((r) => r.kind === 'batch.create')!
    expect(batch.status).toBe('queued')
  })

  it('works where the browser has no Web Locks', async () => {
    const { server, session } = await farmer()
    expect(navigator.locks).toBeUndefined() // jsdom, like an old WebView
    const outbox = new Outbox(`review-${++n}`)
    await outbox.enqueue(11, harvestDrafts(DRAFT), 0)
    expect((await outbox.replay(11, session, () => 0)).sent).toBe(2)
    expect(server.harvests).toHaveLength(1)
  })

  it('keeps capture order however many actions one save holds', async () => {
    const { session } = await farmer()
    const outbox = new Outbox(`review-${++n}`, new FakeLocks())
    for (let i = 0; i < 60; i++) {
      const rows = await outbox.enqueue(11, harvestDrafts(DRAFT), 1_000)
      expect(rows[0].seq).toBeLessThan(rows[1].seq)
    }
    const all = await outbox.list(11)
    const seqs = all.map((r) => r.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
    void session
  })
})

describe('Providers', () => {
  it('does not refresh again when the session is already signed in (sign-in to /farm)', async () => {
    const { session } = await farmer()
    const restore = vi.spyOn(session, 'restore')
    const outbox = new Outbox(`review-${++n}`, new FakeLocks())
    render(
      <Providers session={session} outbox={outbox} sync={new SyncRunner(outbox, session)}>
        <p>farm</p>
      </Providers>,
    )
    await screen.findByText('farm')
    expect(restore).not.toHaveBeenCalled()
  })
})

describe('ScanPage', () => {
  it('a camera that finishes starting after Stop is stopped at once', async () => {
    let resolveStart: (stop: () => void) => void = () => {}
    const stop = vi.fn()
    const startCamera = vi.fn(() => new Promise<() => void>((resolve) => (resolveStart = resolve)))
    const memory = memoryLocation({ path: '/scan' })
    render(
      <Router hook={memory.hook}>
        <ScanPage startCamera={startCamera} />
      </Router>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Use the camera' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stop the camera' }))
    await act(async () => resolveStart(stop)) // permission granted late
    expect(stop).toHaveBeenCalledOnce()
  })
})

describe('dates', () => {
  it("a server time is shown on the farmer's local day, not the UTC day", () => {
    // 22:30 UTC on 12 Oct is 01:30 on 13 Oct in Nairobi.
    expect(localDay('2026-10-12T22:30:00', 'Africa/Nairobi')).toBe('2026-10-13')
    expect(localDay('2026-10-12T22:30:00Z', 'Africa/Nairobi')).toBe('2026-10-13')
  })
})
