// A farmer's own password (13 D5, D16): the forced change at first sign-in,
// with saved harvests waiting rather than refused, and the voluntary change
// from the Me page.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20_000 })
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Providers } from '../app/Providers'
import { RequireRole } from '../app/RequireRole'
import { Session } from '../auth/session'
import { useSession } from '../auth/SessionContext'
import { Outbox, harvestDrafts } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { Snapshots } from '../offline/snapshots'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { FarmRoutes } from './FarmApp'
import { FarmServicesContext, type FarmServices } from './FarmServices'

let n = 0

async function farmer(opts: { mustChange?: boolean } = {}) {
  const server = new FakeBackend()
  server.addFarmer('+254700000009', 'set by officer', 19, 9, opts)
  server.apiaries.push({ id: 109, farmer_id: 9 })
  const locks = new FakeLocks()
  const session = new Session({
    fetch: server.fetch,
    locks,
    channel: new FakeBus().channel(),
    storage: null,
  })
  await session.signIn('+254700000009', 'set by officer')
  const outbox = new Outbox(`farm-password-${++n}`, locks)
  const services: FarmServices = {
    session,
    outbox,
    sync: new SyncRunner(outbox, session),
    snapshots: new Snapshots(`farm-password-snap-${n}`),
    today: () => '2026-10-14',
    now: () => Date.parse('2026-10-14T06:52:00Z'),
    locate: async () => ({ lat: -0.428713, lon: 36.951247, accuracy: 12 }),
    online: () => true,
  }
  return { server, services }
}

function Gate() {
  const state = useSession()
  return (
    <RequireRole roles={['farmer']}>
      {state.status === 'signed_in' ? <FarmRoutes signedInAs={state.me} /> : null}
    </RequireRole>
  )
}

function renderFarm({ services }: Awaited<ReturnType<typeof farmer>>, path: string) {
  const memory = memoryLocation({ path, record: true })
  render(
    <FarmServicesContext.Provider value={services}>
      <Providers session={services.session} outbox={services.outbox} sync={services.sync}>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <Gate />
        </Router>
      </Providers>
    </FarmServicesContext.Provider>,
  )
  return memory
}

async function fill(current: string, label: string, next: string) {
  await userEvent.type(screen.getByLabelText(label), current)
  await userEvent.type(screen.getByLabelText('New password'), next)
  await userEvent.type(screen.getByLabelText('Type it again'), next)
  await userEvent.click(screen.getByRole('button', { name: 'Save my password' }))
}

describe('A farmer’s own password', () => {
  it('first sign-in: saved harvests wait, untouched, and send once the farmer chooses', async () => {
    const env = await farmer({ mustChange: true })
    const drafts = harvestDrafts({
      farmerId: 9,
      apiaryId: 109,
      metadata: { honey_type: 'acacia' },
      harvest: { harvest_date: '2026-10-14', quantity_kg: '35.00', hive_ids: [] },
    })
    await env.services.outbox.enqueue(19, drafts, Date.now())
    renderFarm(env, '/')

    await screen.findByRole('heading', { name: 'Choose your own password' })
    expect(screen.getByText('At least 8 characters')).toBeInTheDocument()
    expect(
      await screen.findByText(
        'Your saved harvest is safe on this phone. It will send as soon as you save your password.',
      ),
    ).toBeInTheDocument()
    expect(env.server.requests).toEqual([])

    await fill('set by officer', 'The password you used just now', 'mukurweini26')
    await vi.waitFor(() => expect(env.server.harvests).toHaveLength(1))
    expect((await env.services.outbox.list(19)).every((r) => r.status === 'sent')).toBe(true)
  })

  it('from Me: changes it, and goes back to Me', async () => {
    const env = await farmer()
    const memory = renderFarm(env, '/me')
    await userEvent.click(await screen.findByRole('link', { name: 'Change my password' }))
    await screen.findByRole('heading', { name: 'Change my password' })
    await fill('set by officer', 'Your current password', 'mukurweini26')
    await vi.waitFor(() => expect(memory.history.at(-1)).toBe('/farm/me'))
    expect(await env.services.session.signIn('+254700000009', 'mukurweini26')).toBe('ok')
  })
})
