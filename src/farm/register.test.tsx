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
import { Outbox, harvestDrafts } from '../offline/outbox'
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
          signedInAs={{
            user_id: 11,
            role: 'farmer',
            display_name: 'Wanjiru K',
            farmer_id: 7,
            must_change_password: false,
          }}
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
    const kg = screen.getByLabelText('Harvested (kg)')
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
    await userEvent.type(screen.getByLabelText('Harvested (kg)'), '12')
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
    await userEvent.type(screen.getByLabelText('Harvested (kg)'), '12')
    await next()
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Save harvest' }))
    await screen.findByRole('heading', { name: 'Saved on this phone' })
    expect(await services.outbox.waitingWork(11)).toBe(1)

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

describe('review fixes', () => {
  it('server lists are fetched for the signed-in farmer only (asUser)', async () => {
    await setup({ online: true })
    const spy = vi
      .spyOn(services.session, 'authFetch')
      .mockImplementation(async () => new Response('[]', { status: 200 }))
    renderAt('/')
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    for (const call of spy.mock.calls) expect(call[2]).toEqual({ asUser: 11 })
  })

  it('the sent list is fetched again when a harvest finishes sending', async () => {
    await setup({ online: true })
    server.apiaries.push({ id: 101, farmer_id: 7 })
    const spy = vi.spyOn(services.session, 'authFetch') // passes through to the fake server
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiaryId: 101,
        metadata: { honey_type: 'acacia' },
        harvest: { harvest_date: TODAY, quantity_kg: '1.00', hive_ids: [] },
      }),
      services.now(),
    )
    renderAt('/')
    const batchCalls = () =>
      spy.mock.calls.filter((c) => String(c[0]).startsWith('/v2/batches?')).length
    await vi.waitFor(() => expect(batchCalls()).toBe(1))
    await services.outbox.replay(11, services.session, services.now) // the harvest is sent
    await vi.waitFor(() => expect(batchCalls()).toBe(2))
  })
})

describe('browser-walk fixes', () => {
  it('a GPS timeout says to try again, not that the phone cannot share location', async () => {
    await setup({
      locate: async () => Promise.reject(Object.assign(new Error('timeout'), { code: 3 })),
    })
    renderAt('/register')
    await userEvent.click(await screen.findByRole('radio', { name: 'Add a new apiary' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText(/Couldn't get your location yet/)).toBeInTheDocument()
  })

  it('the denied message only offers what the screen can do', async () => {
    await setup({
      locate: async () => Promise.reject(Object.assign(new Error('denied'), { code: 1 })),
    })
    renderAt('/register')
    await userEvent.click(await screen.findByRole('radio', { name: 'Add a new apiary' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use my location' }))
    const msg = await screen.findByText(/Location is turned off/)
    expect(msg.textContent).not.toMatch(/map/)
  })

  it('kg fields are plain decimal fields, not spinbuttons with a 0..0 range', async () => {
    renderAt('/register')
    await newApiaryStep()
    await next()
    const kg = screen.getByLabelText('Harvested (kg)')
    expect(kg).not.toHaveAttribute('role', 'spinbutton')
    expect(kg).toHaveAttribute('inputmode', 'decimal')
  })

  it('online with no snapshot yet, "No harvests yet" waits for the server list', async () => {
    await setup({ online: true })
    let release: () => void = () => {}
    vi.spyOn(services.session, 'authFetch').mockImplementation(
      () =>
        new Promise(
          (r) =>
            (release = () =>
              r(new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200 }))),
        ),
    )
    renderAt('/')
    await screen.findByRole('heading', { name: 'My harvests' })
    await new Promise((r) => setTimeout(r, 300)) // snapshot read; server still answering
    expect(screen.queryByText('No harvests yet. Register your first one.')).not.toBeInTheDocument()
    release()
  })
})

describe('the "Sending" gap (13 §11 item 3)', () => {
  /** The farmer's batch list, answered only when the test says so. */
  function heldList() {
    const answers: ((items: unknown[]) => void)[] = []
    const real = services.session.authFetch.bind(services.session)
    vi.spyOn(services.session, 'authFetch').mockImplementation((path, init, opts) =>
      String(path).startsWith('/v2/batches?')
        ? new Promise((r) =>
            answers.push((items) =>
              r(new Response(JSON.stringify({ items, next_cursor: null }), { status: 200 })),
            ),
          )
        : real(path, init, opts),
    )
    return answers
  }

  const summary = (id: number, state: string) => ({
    id,
    public_id: 'b'.repeat(32),
    batch_code: `B-${id}`,
    state,
    honey_type: 'acacia',
    apiary_name: 'Mukurwe-ini',
    created_at: '2026-10-13T06:00:00',
    state_updated_at: '2026-10-13T07:00:00',
  })

  it('a sent harvest stays as "Sending" at every moment until the list has it', async () => {
    await setup({ online: true })
    server.apiaries.push({ id: 101, farmer_id: 7, name: 'Mukurwe-ini' })
    const answers = heldList()
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiaryId: 101,
        metadata: { honey_type: 'acacia' },
        harvest: { harvest_date: TODAY, quantity_kg: '35.00', hive_ids: [] },
      }),
      services.now(),
    )
    const { container } = renderAt('/')
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    answers[0]([])
    expect(await screen.findByText('Saved on this phone')).toBeInTheDocument()

    // Count the harvest rows at every change to the screen from here on.
    const rows = () => container.querySelectorAll('ul > li').length
    const seen: number[] = [rows()]
    const watch = new MutationObserver(() => seen.push(rows()))
    watch.observe(container, { childList: true, subtree: true, characterData: true })

    await services.outbox.replay(11, services.session, services.now) // sent
    expect(await screen.findByText('Sending')).toBeInTheDocument()
    await vi.waitFor(() => expect(answers).toHaveLength(2))
    answers[1]([summary(Number(server.batches[0].id), 'HARVESTED')])
    expect(await screen.findByText('Sent. Now harvest recorded')).toBeInTheDocument()
    expect(screen.queryByText('Sending')).not.toBeInTheDocument()
    watch.disconnect()
    expect(Math.min(...seen)).toBe(1)
    expect(Math.max(...seen)).toBe(1)
  })

  it('a list read before the harvest landed (batch still registered) keeps one "Sending" row', async () => {
    await setup({ online: true })
    server.apiaries.push({ id: 101, farmer_id: 7, name: 'Mukurwe-ini' })
    const answers = heldList()
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiaryId: 101,
        metadata: { honey_type: 'acacia' },
        harvest: { harvest_date: TODAY, quantity_kg: '35.00', hive_ids: [] },
      }),
      services.now(),
    )
    await services.outbox.replay(11, services.session, services.now)
    const { container } = renderAt('/')
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    answers[0]([summary(Number(server.batches[0].id), 'CREATED')])
    await screen.findByText('Sending')
    await new Promise((r) => setTimeout(r, 50))
    expect(container.querySelectorAll('ul > li')).toHaveLength(1)
    expect(screen.queryByText(/^Sent\./)).not.toBeInTheDocument()
  })

  it('opening the page never flashes a harvest already in the list as "Sending"', async () => {
    await setup({ online: true })
    server.apiaries.push({ id: 101, farmer_id: 7, name: 'Mukurwe-ini' })
    const answers = heldList()
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiaryId: 101,
        metadata: { honey_type: 'acacia' },
        harvest: { harvest_date: TODAY, quantity_kg: '35.00', hive_ids: [] },
      }),
      services.now(),
    )
    await services.outbox.replay(11, services.session, services.now)
    const batchId = Number(server.batches[0].id)
    await services.snapshots.set(11, 'batches', [summary(batchId, 'HARVESTED')])

    // Watch from before the first render: every frame, not just the last.
    let flashed = false
    const watch = new MutationObserver(() => {
      flashed ||= document.body.textContent?.includes('Sending') ?? false
    })
    watch.observe(document.body, { childList: true, subtree: true, characterData: true })
    renderAt('/')
    expect(await screen.findByText('Sent. Now harvest recorded')).toBeInTheDocument()
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    answers[0]([summary(batchId, 'HARVESTED')])
    await new Promise((r) => setTimeout(r, 50))
    watch.disconnect()
    expect(flashed).toBe(false)
  })

  it('an old sent harvest beyond the first page of 100 never comes back as "Sending"', async () => {
    await setup({ online: true })
    const answers = heldList()
    server.apiaries.push({ id: 101, farmer_id: 7, name: 'Mukurwe-ini' })
    server.seq.batch = 4 // sent long ago, as batch 5
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiaryId: 101,
        metadata: { honey_type: 'acacia' },
        harvest: { harvest_date: TODAY, quantity_kg: '35.00', hive_ids: [] },
      }),
      services.now(),
    )
    await services.outbox.replay(11, services.session, services.now)
    expect(server.batches[0].id).toBe(5)
    // The first page holds batches 200 down to 101.
    renderAt('/')
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    answers[0](Array.from({ length: 100 }, (_, i) => summary(200 - i, 'PACKAGED')))
    expect(await screen.findAllByText('Sent. Now packed')).toHaveLength(100)
    expect(screen.queryByText('Sending')).not.toBeInTheDocument()
  })
})

describe('fix and send again (13 §11 item 2)', () => {
  it('a refused harvest opens filled in; sending again makes a new action, the refused one is gone', async () => {
    await setup({ online: true })
    server.apiaries.push({ id: 101, farmer_id: 7, name: 'Mukurwe-ini' })
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiaryId: 101,
        metadata: { honey_type: 'acacia', apiary_management_method: 'organic' },
        harvest: { harvest_date: '2026-10-12', quantity_kg: '0.00', hive_ids: [] },
      }),
      services.now(),
    )
    await services.outbox.replay(11, services.session, services.now)
    const refused = (await services.outbox.list(11)).find((r) => r.kind === 'batch.harvest')!
    expect(refused.status).toBe('needs_attention')

    const { memory } = renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Fix and send again' }))
    expect(memory.history.at(-1)).toBe(`/register?fix=${refused.id}`)

    // The batch was accepted, so where and what honey stay as they are.
    expect(await screen.findByText(/The server refused it: invalid_quantity/)).toBeInTheDocument()
    expect(await screen.findByText('Mukurwe-ini')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Add a new apiary' })).not.toBeInTheDocument()
    await next()
    expect(screen.queryByRole('radio', { name: 'Acacia' })).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Harvested (kg)'), '35')
    await next()
    // The day is the batch's harvest window too, already accepted: kept, so
    // the harvest never disagrees with the window the jar shows.
    expect(screen.queryByRole('radio', { name: 'Yesterday' })).not.toBeInTheDocument()
    expect(screen.getByText(/^yesterday$/i)).toBeInTheDocument()
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }))

    const rows = await services.outbox.list(11)
    expect(rows.some((r) => r.id === refused.id)).toBe(false)
    const fixed = rows.find((r) => r.kind === 'batch.harvest')!
    expect(fixed.idempotency_key).not.toBe(refused.idempotency_key)
    expect(fixed.body).toMatchObject({ quantity_kg: '35.00', harvest_date: '2026-10-12' })
    expect(rows.filter((r) => r.kind === 'batch.create')).toHaveLength(1) // never sent twice
    expect(memory.history.at(-1)).toBe(`/saved?id=${fixed.id}`)

    await services.outbox.replay(11, services.session, services.now)
    expect(server.harvests).toHaveLength(1)
    expect(server.batches).toHaveLength(1)
  })

  it('a refused new apiary: its name is fixed, and the batch and harvest held behind it send', async () => {
    await setup({ online: true })
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiary: {
          name: 'Ridge\u0000',
          latitude: '-0.428713',
          longitude: '36.951247',
          hive_count: 4,
        },
        metadata: { honey_type: 'wildflower', apiary_management_method: 'organic' },
        harvest: { harvest_date: TODAY, quantity_kg: '12.00', hive_ids: [] },
      }),
      services.now(),
    )
    await services.outbox.replay(11, services.session, services.now)
    const harvest = (await services.outbox.list(11)).find((r) => r.kind === 'batch.harvest')!
    services.online = () => false // no live map in jsdom

    renderAt(`/register?fix=${harvest.id}`)
    const name = await screen.findByLabelText('Name this apiary')
    expect(name).toHaveValue('Ridge\u0000')
    expect(screen.getByText('The place you saved before.')).toBeInTheDocument()
    expect(screen.queryByText(/within about/)).not.toBeInTheDocument()
    await userEvent.clear(name)
    await userEvent.type(name, 'Ridge')
    await next()
    expect(screen.getByRole('radio', { name: 'Wildflower' })).toBeChecked()
    expect(screen.getByLabelText('Harvested (kg)')).toHaveValue('12')
    await next()
    await next()
    expect(screen.getByText('Ridge (new), 4 hives')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }))
    await screen.findByRole('heading', { name: 'Saved on this phone' })

    await services.outbox.replay(11, services.session, services.now)
    const rows = await services.outbox.list(11)
    expect(rows.map((r) => r.status)).toEqual(['sent', 'sent', 'sent'])
    expect(server.apiaries.at(-1)).toMatchObject({ name: 'Ridge', hive_count: 4 })
    expect(server.harvests).toHaveLength(1)
  })

  it('a link to a harvest with nothing to fix says so', async () => {
    renderAt('/register?fix=nothing-here')
    expect(await screen.findByText('This harvest has nothing to fix.')).toBeInTheDocument()
  })

  it('the fix form has no axe violations', async () => {
    await setup({ online: true })
    await services.outbox.enqueue(
      11,
      harvestDrafts({
        farmerId: 7,
        apiary: {
          name: 'Ridge\u0000',
          latitude: '-0.428713',
          longitude: '36.951247',
          hive_count: 4,
        },
        metadata: { honey_type: 'wildflower' },
        harvest: { harvest_date: TODAY, quantity_kg: '12.00', hive_ids: [] },
      }),
      services.now(),
    )
    await services.outbox.replay(11, services.session, services.now)
    const harvest = (await services.outbox.list(11)).find((r) => r.kind === 'batch.harvest')!
    services.online = () => false // no live map in jsdom
    const { container } = renderAt(`/register?fix=${harvest.id}`)
    await screen.findByLabelText('Name this apiary')
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => v.id)).toEqual([])
  })
})
