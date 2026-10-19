// Phase 4b acceptance (13 §1), client side: the phase's evidence in one file.
// The detailed cases live next to their code (named below); this walks the
// items end to end against the in-memory backend. It sits beside 4a's file
// in src/acceptance, not the plan's tests/acceptance, so the typecheck sees it.
import 'fake-indexeddb/auto'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Providers } from '../app/Providers'
import { RequireRole } from '../app/RequireRole'
import { Session } from '../auth/session'
import { useSession } from '../auth/SessionContext'
import { FarmRoutes } from '../farm/FarmApp'
import { FarmServicesContext, type FarmServices } from '../farm/FarmServices'
import { Outbox, harvestDrafts } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { Snapshots } from '../offline/snapshots'
import { renderConsole, staff, STAFF_PW, type Env } from '../test/consoleHarness'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'

// Whole flows through the screens, several people in turn: slow under load.
vi.setConfig({ testTimeout: 60_000 })
const eventually = (fn: () => void | Promise<void>) => vi.waitFor(fn, { timeout: 5000 })

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

let n = 0
const harvest = (farmerId: number, apiaryId: number, kg = '35.00') =>
  harvestDrafts({
    farmerId,
    apiaryId,
    metadata: { honey_type: 'acacia', apiary_management_method: 'organic' },
    harvest: { harvest_date: '2026-10-14', quantity_kg: kg, hive_ids: [] },
  })

/** One person signed in on their own device, against the shared server. */
async function device(server: FakeBackend, identifier: string, password: string) {
  const locks = new FakeLocks()
  const session = new Session({
    fetch: server.fetch,
    locks,
    channel: new FakeBus().channel(),
    storage: null,
  })
  expect(await session.signIn(identifier, password)).toBe('ok')
  const outbox = new Outbox(`acceptance-4b-${++n}`, locks)
  return { server, session, outbox, sync: new SyncRunner(outbox, session) } satisfies Env
}

const card = () => screen.getByRole('region', { name: 'Next step' })

describe('Phase 4b acceptance', () => {
  it('the headline walk: four people take the four staff steps, each named on the record', async () => {
    const server = new FakeBackend()
    const farmer = server.seedFarmer(
      { first_name: 'Wanjiru', last_name: 'Kamau', phone: '+254712345312' },
      { password: 'mukurweini26' },
    )
    server.apiaries = [{ id: 101, farmer_id: farmer.id, name: 'Ridge apiary', hive_count: 12 }]
    server.addStaff('otieno', STAFF_PW, 31, 'operator', 'Otieno Kiprop')
    server.addStaff('akinyi', STAFF_PW, 32, 'lab_officer', 'Akinyi Odhiambo')
    server.addStaff('peter', STAFF_PW, 33, 'admin', 'Peter Mwangi')

    // The farmer creates and harvests the batch, from her phone.
    const phone = await device(server, '+254712345312', 'mukurweini26')
    await phone.outbox.enqueue(phone.session.userId!, harvest(farmer.id, 101), Date.now())
    await phone.outbox.replay(phone.session.userId!, phone.session, Date.now)
    const id = Number(server.batches[0].id)
    const code = `B-${id}`
    const state = () => String(server.batchDetails.find((b) => b.id === id)!.state)
    expect(state()).toBe('HARVESTED')

    const people = {
      operator: await device(server, 'otieno', STAFF_PW),
      lab_officer: await device(server, 'akinyi', STAFF_PW),
      admin: await device(server, 'peter', STAFF_PW),
    }
    // Who may take each step (`next_action`): the form for them, a waiting
    // card for everyone else. The admin may take any step, in place.
    const steps = [
      { from: 'HARVESTED', by: 'operator', may: ['operator', 'admin'], title: 'Record processing' },
      {
        from: 'PROCESSED',
        by: 'lab_officer',
        may: ['lab_officer', 'admin'],
        title: 'Record the lab result',
      },
      { from: 'LAB_VERIFIED', by: 'admin', may: ['operator', 'admin'], title: 'Record packaging' },
      {
        from: 'PACKAGED',
        by: 'operator',
        may: ['operator', 'admin'],
        title: 'Record sending to shops',
      },
    ] as const

    for (const step of steps) {
      expect(state()).toBe(step.from)
      // First everyone looks: a form only for those `next_action` allows.
      for (const role of ['operator', 'lab_officer', 'admin'] as const) {
        const view = renderConsole(people[role], `/batches/${id}`)
        await screen.findByRole('heading', { name: code })
        const next = await screen.findByRole('region', { name: 'Next step' })
        if ((step.may as readonly string[]).includes(role)) {
          expect(within(next).getByRole('heading', { name: step.title })).toBeVisible()
        } else {
          expect(within(next).queryByRole('heading', { name: step.title })).not.toBeInTheDocument()
          expect(within(next).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
        }
        view.unmount()
      }
      // Then the one whose step it is takes it.
      const view = renderConsole(people[step.by], `/batches/${id}`)
      await screen.findByRole('heading', { name: code })
      await screen.findByRole('region', { name: 'Next step' })
      if (step.from === 'PROCESSED') {
        await userEvent.type(screen.getByLabelText('Moisture (%)'), '18.4')
        await userEvent.click(screen.getByRole('button', { name: 'Save lab result' }))
      } else if (step.from === 'LAB_VERIFIED') {
        const jars = screen.getByLabelText('Jars packed')
        await userEvent.clear(jars)
        await userEvent.type(jars, '120')
        await userEvent.click(screen.getByRole('button', { name: 'Save packaging' }))
      } else if (step.from === 'PACKAGED') {
        await userEvent.type(screen.getByLabelText('Shop or buyer'), 'Naivas Nyeri')
        await userEvent.click(within(card()).getByRole('button', { name: 'Save' }))
      } else {
        await userEvent.click(screen.getByRole('button', { name: 'Save processing' }))
      }
      await eventually(() => expect(state()).not.toBe(step.from))
      view.unmount()
    }
    expect(state()).toBe('DISTRIBUTED')

    // The record names every person and role, and marks the admin's step.
    renderConsole(people.operator, `/batches/${id}`)
    await screen.findByRole('heading', { name: code })
    const record = screen.getByRole('region', { name: 'Its record' })
    for (const line of [
      'Recorded by Wanjiru Kamau, farmer',
      'Recorded by Otieno Kiprop, operator',
      'Recorded by Akinyi Odhiambo, lab officer',
      'Recorded by Peter Mwangi, as admin',
    ]) {
      expect(within(record).getAllByText(line).length).toBeGreaterThan(0)
    }
    const packed = within(record)
      .getAllByRole('listitem')
      .find((li) => li.textContent?.startsWith('Packed'))!
    expect(packed).toHaveTextContent('Recorded by Peter Mwangi, as admin')
    // And the server holds each step under the person who took it.
    const stages = server.batchDetails.find((b) => b.id === id)!.stages as {
      action: string
      actor_display_name: string
      actor_role: string
    }[]
    expect(stages.slice(4).map((s) => [s.action, s.actor_display_name, s.actor_role])).toEqual([
      ['batch.process_recorded', 'Otieno Kiprop', 'operator'],
      ['batch.lab_verified', 'Akinyi Odhiambo', 'lab_officer'],
      ['batch.packaged', 'Peter Mwangi', 'admin'],
      ['batch.distributed', 'Otieno Kiprop', 'operator'],
    ])
  })

  it('a queue survives an admin reset: nothing sends or needs attention until the change, then all three go under their keys', async () => {
    const server = new FakeBackend()
    server.addFarmer('+254700000009', 'mukurweini26', 19, 9)
    server.apiaries = [{ id: 109, farmer_id: 9 }]
    const locks = new FakeLocks()
    const session = new Session({
      fetch: server.fetch,
      locks,
      channel: new FakeBus().channel(),
      storage: null,
    })
    await session.signIn('+254700000009', 'mukurweini26')
    const outbox = new Outbox(`acceptance-4b-reset-${++n}`, locks)

    // Three harvests saved at the apiary, with no signal.
    server.offline = true
    for (const kg of ['12.00', '20.00', '35.00']) {
      await outbox.enqueue(19, harvest(9, 109, kg), Date.now())
    }
    const keys = (await outbox.list(19)).map((r) => r.idempotency_key)

    // Meanwhile an admin resets her password: every session ends, and the
    // new one must change it.
    server.offline = false
    server.resetPassword('+254700000009', 'given by admin')
    server.revokeAllSessions()
    expect(await session.signIn('+254700000009', 'given by admin')).toBe('ok')

    const services: FarmServices = {
      session,
      outbox,
      sync: new SyncRunner(outbox, session),
      snapshots: new Snapshots(`acceptance-4b-snap-${n}`),
      today: () => '2026-10-14',
      now: Date.now,
      locate: async () => ({ lat: -0.4, lon: 36.9, accuracy: 10 }),
      online: () => true,
    }
    function Gate() {
      const s = useSession()
      return (
        <RequireRole roles={['farmer']}>
          {s.status === 'signed_in' ? <FarmRoutes signedInAs={s.me} /> : null}
        </RequireRole>
      )
    }
    const memory = memoryLocation({ path: '/', record: true })
    render(
      <FarmServicesContext.Provider value={services}>
        <Providers session={session} outbox={outbox} sync={services.sync}>
          <Router hook={memory.hook} searchHook={memory.searchHook}>
            <Gate />
          </Router>
        </Providers>
      </FarmServicesContext.Provider>,
    )
    await screen.findByRole('heading', { name: 'Choose your own password' })
    expect(
      await screen.findByText(
        'Your 3 saved harvests are safe on this phone. They will send as soon as you save your password.',
      ),
    ).toBeInTheDocument()
    expect(server.requests).toEqual([])
    expect((await outbox.list(19)).every((r) => r.status === 'queued')).toBe(true)

    await userEvent.type(screen.getByLabelText('The password you used just now'), 'given by admin')
    await userEvent.type(screen.getByLabelText('New password'), 'nyeri-hills-26')
    await userEvent.type(screen.getByLabelText('Type it again'), 'nyeri-hills-26')
    await userEvent.click(screen.getByRole('button', { name: 'Save my password' }))

    await eventually(() => expect(server.harvests).toHaveLength(3))
    const rows = await outbox.list(19)
    expect(rows.every((r) => r.status === 'sent')).toBe(true)
    expect(rows.map((r) => r.idempotency_key)).toEqual(keys)
    expect(new Set(server.requests.map((r) => r.key))).toEqual(new Set(keys))
  })

  it.each(['light', 'dark'])(
    'the forced change and an operator Me page with a waiting step have no axe violations (%s)',
    async (theme) => {
      document.documentElement.setAttribute('data-theme', theme)
      const forced = await staff('operator', { mustChange: true })
      const first = renderConsole(forced, '/batches')
      await screen.findByRole('heading', { name: 'Choose your own password' })
      let result = await axe.run(first.container, {
        rules: { 'color-contrast': { enabled: false } },
      })
      expect(result.violations.map((v) => v.id)).toEqual([])
      first.unmount()

      const env = await staff('operator')
      env.server.offline = true
      const { stageDraft } = await import('../offline/outbox')
      await env.outbox.enqueue(21, [stageDraft('batch.process', 4180, {})], Date.now())
      const me = renderConsole(env, '/me')
      await screen.findByText(
        '1 step is waiting to send. It will send the next time you sign in here.',
      )
      result = await axe.run(me.container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    },
  )

  it('the rest of §1 is held by the detailed tests, named here so none goes missing', async () => {
    const detailed = import.meta.glob('../**/*.test.{ts,tsx}')
    for (const file of [
      '../console/actions.test.tsx', // next_action per role, the four kinds, 409, keyboard-only step
      '../console/console.test.tsx', // the shell, role-shaped filters, forced change, admin mark
      '../console/people.test.tsx', // staff accounts: only an admin; resets; refusals
      '../console/farmers.test.tsx', // enrolment UX: consents, 409 withdrawn_by_farmer, files, 429, codes
      '../console/labels.test.tsx', // QR round trip, SAMPLE off the allowlist, record sheet, health
      '../farm/choices.test.tsx', // the farmer's own toggles, off by default, through the outbox
      '../farm/register.test.tsx', // fix and send again, the "Sending" gap
      '../consumer/declaredDays.test.tsx', // declared day under TZ=America/Bogota
      '../consumer/VerifyView.test.tsx', // the consumer-safety lock
      '../offline/outbox.test.ts', // user scoping, staff kinds, fixAll
      '../i18n/consent.test.ts', // D17: the consent wording and its version
    ]) {
      expect(detailed, file).toHaveProperty([file])
    }
  })
})
