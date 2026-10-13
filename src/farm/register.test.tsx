// "Register a harvest" (12 §11, design board): one decision per screen, GPS
// first, no latitude/longitude field anywhere, and the save commits to the
// outbox at once with no network.
import 'fake-indexeddb/auto'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Whole flows typed through userEvent: slow under a parallel full-suite run.
vi.setConfig({ testTimeout: 20_000 })
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Session } from '../auth/session'
import { Outbox } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { Snapshots } from '../offline/snapshots'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { FarmRoutes } from './FarmApp'
import { FarmServicesContext, type FarmServices, type Fix } from './FarmServices'

let server: FakeBackend
let services: FarmServices
let n = 0
const TODAY = '2026-10-13'

async function setup(opts: { locate?: () => Promise<Fix>; online?: boolean } = {}) {
  server = new FakeBackend()
  server.addFarmer('+254700000001', 'hunter2', 11, 7)
  const session = new Session({
    fetch: server.fetch,
    locks: new FakeLocks(),
    channel: new FakeBus().channel(),
  })
  await session.signIn('+254700000001', 'hunter2')
  const outbox = new Outbox(`farm-test-${++n}`, new FakeLocks())
  services = {
    session,
    outbox,
    sync: new SyncRunner(outbox, session),
    snapshots: new Snapshots(`farm-snap-${n}`),
    today: () => TODAY,
    now: () => Date.parse(`${TODAY}T06:52:00Z`),
    locate: opts.locate ?? (async () => ({ lat: -0.428713, lon: 36.951247, accuracy: 12 })),
    online: () => opts.online ?? false,
  }
  server.offline = !(opts.online ?? false)
}

function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true })
  const utils = render(
    <FarmServicesContext.Provider value={services}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <FarmRoutes
          signedInAs={{ user_id: 11, role: 'farmer', display_name: 'Wanjiru K', farmer_id: 7 }}
        />
      </Router>
    </FarmServicesContext.Provider>,
  )
  return { memory, ...utils }
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }))

async function newApiaryStep() {
  await userEvent.click(await screen.findByRole('radio', { name: 'Add a new apiary' }))
  await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
  await screen.findByText(/within about 12 m/)
  await userEvent.type(screen.getByLabelText('Name this apiary'), 'Ridge')
}

beforeEach(async () => {
  await setup()
})

describe('Register a harvest, offline', () => {
  it('a new apiary and its harvest commit as three linked actions, and say where they are', async () => {
    const { memory } = renderAt('/register')
    await newApiaryStep()
    await next()

    await userEvent.click(screen.getByRole('radio', { name: 'Acacia' }))
    const kg = screen.getByRole('spinbutton', { name: 'Harvested (kg)' })
    await userEvent.clear(kg)
    await userEvent.type(kg, '35')
    await next()

    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked()
    await next()

    expect(screen.getByText('Ridge (new), 1 hive')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save harvest' }))

    const rows = await services.outbox.list(11)
    expect(rows.map((r) => r.kind)).toEqual(['apiary.create', 'batch.create', 'batch.harvest'])
    expect(rows[0].body).toMatchObject({
      farmer_id: 7,
      name: 'Ridge',
      latitude: '-0.428713',
      longitude: '36.951247',
      hive_count: 1,
    })
    expect(rows[1].body).toMatchObject({
      metadata: { honey_type: 'acacia', harvest_window_start: TODAY },
    })
    expect(rows[2].body).toMatchObject({ quantity_kg: '35.00', harvest_date: TODAY })
    expect(server.requests).toHaveLength(0)

    expect(memory.history.at(-1)).toMatch(/^\/saved/)
    expect(await screen.findByRole('heading', { name: 'Saved on this phone' })).toBeInTheDocument()
  })

  it('has no latitude or longitude field at any step', async () => {
    const { container } = renderAt('/register')
    await newApiaryStep()
    const labels = [...container.querySelectorAll('label')].map(
      (l) => l.textContent?.toLowerCase() ?? '',
    )
    expect(labels.some((l) => /lat|long|coordinate/.test(l))).toBe(false)
    expect(container.querySelectorAll('input[type="number"]')).toHaveLength(1) // the hive count only
  })

  it('an existing apiary makes a two-action harvest', async () => {
    await services.snapshots.set(11, 'apiaries', [
      {
        id: 101,
        farmer_id: 7,
        name: 'Mukurwe-ini',
        latitude: '-0.5',
        longitude: '37.0',
        altitude: null,
        vegetation_type: null,
        hive_count: 14,
        locality: null,
      },
    ])
    renderAt('/register')
    await userEvent.click(await screen.findByRole('radio', { name: /Mukurwe-ini/ }))
    await next()
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Harvested (kg)' }), '12')
    await next()
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Save harvest' }))
    const rows = await services.outbox.list(11)
    expect(rows.map((r) => r.kind)).toEqual(['batch.create', 'batch.harvest'])
    expect(rows[0].body).toMatchObject({ apiary_id: 101 })
  })

  it('will not continue without the apiary location, and says why', async () => {
    renderAt('/register')
    await userEvent.click(await screen.findByRole('radio', { name: 'Add a new apiary' }))
    await userEvent.type(screen.getByLabelText('Name this apiary'), 'Ridge')
    await next()
    expect(screen.getByText("Add the apiary's location to continue")).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 4: where')).toBeInTheDocument()
  })
})

describe('location', () => {
  it('a refused location explains how to turn it on', async () => {
    await setup({
      locate: async () => Promise.reject(Object.assign(new Error('denied'), { code: 1 })),
    })
    renderAt('/register')
    await userEvent.click(await screen.findByRole('radio', { name: 'Add a new apiary' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText(/Location is turned off for this app/)).toBeInTheDocument()
  })

  it('a weak fix asks to wait, and can be used anyway', async () => {
    await setup({ locate: async () => ({ lat: -0.4, lon: 36.9, accuracy: 80 }) })
    renderAt('/register')
    await userEvent.click(await screen.findByRole('radio', { name: 'Add a new apiary' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText(/only accurate to about 80 m/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use it anyway' }))
    expect(screen.getByText(/within about 80 m/)).toBeInTheDocument()
  })

  it('offline, the map says it will show later and the location is still saved', async () => {
    renderAt('/register')
    await newApiaryStep()
    expect(
      screen.getByText("Map will show when you're online. Your location is saved."),
    ).toBeInTheDocument()
  })
})

describe('accessibility', () => {
  it('the where step has no axe violations', async () => {
    const { container } = renderAt('/register')
    await newApiaryStep()
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => v.id)).toEqual([])
  }, 20_000)
})

describe('My harvests', () => {
  it('shows saved harvests with where they are, and counts what is waiting', async () => {
    const first = renderAt('/register')
    await newApiaryStep()
    await next()
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Harvested (kg)' }), '12')
    await next()
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Save harvest' }))
    await screen.findByRole('heading', { name: 'Saved on this phone' })
    expect(await services.outbox.waitingHarvests(11)).toBe(1)

    first.unmount()
    renderAt('/')
    expect(await screen.findByText('New apiary: Ridge, today')).toBeInTheDocument()
    expect(screen.getByText('Saved on this phone')).toBeInTheDocument()
    expect(screen.getByText('Connect to see harvests you sent before.')).toBeInTheDocument()
  })

  it('an empty phone invites the first harvest', async () => {
    renderAt('/')
    expect(await screen.findByText('No harvests yet. Register your first one.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Register a harvest' })).toBeInTheDocument()
  })
})

describe('online', () => {
  it('sent harvests come from the server and are remembered for offline', async () => {
    await setup({ online: true })
    server.apiaries.push({ id: 101, farmer_id: 7, name: 'Mukurwe-ini' })
    vi.spyOn(services.session, 'authFetch').mockImplementation(async (path: string) => {
      if (path.startsWith('/v2/batches')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 501,
                public_id: 'a'.repeat(32),
                batch_code: 'B-1',
                state: 'PROCESSED',
                honey_type: 'acacia',
                apiary_name: 'Mukurwe-ini',
                created_at: '2026-10-09T08:00:00',
                state_updated_at: '2026-10-10T08:00:00',
              },
            ],
            next_cursor: null,
          }),
          { status: 200 },
        )
      }
      return new Response('[]', { status: 200 })
    })
    renderAt('/')
    expect(await screen.findByText('Sent. Now at processing')).toBeInTheDocument()
    expect((await services.snapshots.get<unknown[]>(11, 'batches'))?.length).toBe(1)
  })
})

it('refuses to continue with nothing harvested', async () => {
  renderAt('/register')
  await newApiaryStep()
  await next()
  await next()
  expect(screen.getByText('Enter how much you harvested')).toBeInTheDocument()
})
