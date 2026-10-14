// The console shell, batch list and batch detail (13 §7, P4b-C), against the
// in-memory backend serving the backend's own console fixtures.
import 'fake-indexeddb/auto'
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20_000 })
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Providers } from '../app/Providers'
import { Session } from '../auth/session'
import { SignInPage } from '../auth/SignInPage'
import { Outbox } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import distributed from './__fixtures__/distributed.json'
import harvested from './__fixtures__/harvested.json'
import labVerified from './__fixtures__/lab_verified.json'
import packaged from './__fixtures__/packaged.json'
import processed from './__fixtures__/processed.json'
import { ConsoleGate } from './ConsoleApp'

type Json = Record<string, unknown>
const STAFF_PW = 'a long staff passphrase'
let n = 0

// Five batches, one per state after CREATED, with distinct ids and codes.
function seed(server: FakeBackend) {
  server.batchDetails = [harvested, processed, labVerified, packaged, distributed].map((b, i) => ({
    ...(b as Json),
    id: 4180 + i,
    batch_code: `B-00000${i}`,
    public_id: `p${i}`,
  }))
}

async function staff(
  role: 'operator' | 'lab_officer' | 'admin' | 'field_officer',
  opts: { mustChange?: boolean } = {},
) {
  const server = new FakeBackend()
  server.addStaff('jane', STAFF_PW, 21, role, 'Jane Mwende', opts)
  seed(server)
  const locks = new FakeLocks()
  const session = new Session({
    fetch: server.fetch,
    locks,
    channel: new FakeBus().channel(),
    storage: null,
  })
  expect(await session.signIn('jane', STAFF_PW)).toBe('ok')
  const outbox = new Outbox(`console-test-${++n}`, locks)
  return { server, session, outbox, sync: new SyncRunner(outbox, session) }
}

type Env = Awaited<ReturnType<typeof staff>>

function renderConsole(env: Env, path: string) {
  const memory = memoryLocation({ path, record: true })
  const utils = render(
    <Providers session={env.session} outbox={env.outbox} sync={env.sync}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <ConsoleGate />
      </Router>
    </Providers>,
  )
  return { memory, ...utils }
}

const lastList = (server: FakeBackend) =>
  new URL(server.reads.filter((p) => p.startsWith('/v2/batches?')).at(-1)!, 'http://x')

function wide(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('min-width: 1024px'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

describe('Batches: the work queue', () => {
  it('opens an operator on "To do": harvested, lab tested and packed, each with its step', async () => {
    const env = await staff('operator')
    renderConsole(env, '/batches')
    await screen.findByText('B-000000')
    expect(lastList(env.server).searchParams.getAll('state')).toEqual([
      'HARVESTED',
      'LAB_VERIFIED',
      'PACKAGED',
    ])
    expect(screen.getByRole('button', { name: 'To do' })).toHaveAttribute('aria-pressed', 'true')
    const rows = screen.getAllByRole('link', { name: /B-0000/ })
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/B-000003Send to shops.*Packed · waiting since/),
      expect.stringMatching(/B-000002Package.*Lab tested · waiting since/),
      expect.stringMatching(/B-000000Process.*Harvested · waiting since/),
    ])
    // The farmer's name is all an operator sees about the farmer (D7).
    expect(rows[0]).toHaveTextContent('Acacia · Wanjiru Kamau')

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await screen.findByText('B-000004')
    expect(lastList(env.server).searchParams.getAll('state')).toEqual([])
  })

  it('opens a lab officer on the batches waiting for the lab', async () => {
    const env = await staff('lab_officer')
    renderConsole(env, '/batches')
    await screen.findByText('B-000001')
    expect(lastList(env.server).searchParams.getAll('state')).toEqual(['PROCESSED'])
    expect(screen.getByRole('link', { name: /B-000001/ })).toHaveTextContent('Lab test')
  })

  it('opens an admin and a field officer on everything, with no "To do"', async () => {
    for (const role of ['admin', 'field_officer'] as const) {
      const env = await staff(role)
      const { unmount } = renderConsole(env, '/batches')
      await screen.findByText('B-000004')
      expect(lastList(env.server).searchParams.getAll('state')).toEqual([])
      expect(screen.queryByRole('button', { name: 'To do' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
      unmount()
    }
  })

  it('filters by one step, and finds a batch by the code typed from a tub', async () => {
    const env = await staff('admin')
    renderConsole(env, '/batches')
    await screen.findByText('B-000004')
    await userEvent.click(screen.getByRole('button', { name: 'Packed' }))
    await vi.waitFor(() =>
      expect(lastList(env.server).searchParams.getAll('state')).toEqual(['PACKAGED']),
    )
    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await userEvent.type(screen.getByRole('searchbox'), 'b-000002')
    await vi.waitFor(() => expect(lastList(env.server).searchParams.get('q')).toBe('b-000002'))
    await vi.waitFor(() =>
      expect(screen.getAllByRole('link', { name: /B-0000/ }).map((r) => r.textContent)).toEqual([
        expect.stringContaining('B-000002'),
      ]),
    )
  })
})

describe('A batch record', () => {
  it('names a person and a role at every step, and marks the step taken as admin', async () => {
    const env = await staff('operator')
    renderConsole(env, '/batches/4183') // the packed batch
    await screen.findByRole('heading', { name: 'B-000003' })
    expect(screen.getAllByText('Recorded by Wanjiru Kamau, farmer')).toHaveLength(2) // S0 + harvest
    expect(screen.getByText('Recorded by Jane Mwende, operator')).toBeInTheDocument()
    expect(screen.getByText('Recorded by Achieng Odhiambo, lab officer')).toBeInTheDocument()
    expect(screen.getByText('Recorded by Peter Otieno, as admin')).toBeInTheDocument()
    // Counted by step (five recorded), not by audit row (seven).
    expect(screen.getByText('Integrity · 0 sealed, 5 sealing')).toBeInTheDocument()
    // Six steps: the three S0 rows are one "Registered" step; the open one is next.
    const timeline = screen.getByRole('region', { name: 'Its record' })
    expect(within(timeline).getAllByRole('listitem').slice(0, 6)).toHaveLength(6)
    expect(within(timeline).getByText('Next')).toBeInTheDocument()
    expect(screen.getByText('Wanjiru Kamau')).toBeInTheDocument()
    expect(screen.getByText('Ridge apiary')).toBeInTheDocument()
  })

  it('on a laptop shows the list and the record side by side, the row marked', async () => {
    wide(true)
    const env = await staff('operator')
    renderConsole(env, '/batches/4183')
    await screen.findByRole('heading', { name: 'B-000003' })
    const row = await screen.findByRole('link', { name: /B-000003/ })
    expect(row).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Batches', level: 1 })).toBeInTheDocument()
  })

  it('on a phone, opens as its own page with a way back', async () => {
    const env = await staff('operator')
    const { memory } = renderConsole(env, '/batches/4183')
    await screen.findByRole('heading', { name: 'B-000003' })
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Batches' }))
    expect(memory.history.at(-1)).toBe('/batches')
  })

  it('says so when a batch does not exist', async () => {
    const env = await staff('operator')
    renderConsole(env, '/batches/9999')
    expect(await screen.findByRole('alert')).toHaveTextContent("There's no batch with this number.")
  })

  it('shows only Batches and Me to an operator', async () => {
    const env = await staff('operator')
    renderConsole(env, '/batches')
    await screen.findByText('B-000000')
    const nav = screen.getAllByRole('navigation', { name: 'Main' })[0]
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Batches', 'Me'])
    expect(screen.getAllByText('Jane Mwende').length).toBeGreaterThan(0)
  })
})

describe('A password someone else set (13 D5)', () => {
  it('blocks every console route until the person chooses their own', async () => {
    const env = await staff('operator', { mustChange: true })
    renderConsole(env, '/batches/4183')
    await screen.findByRole('heading', { name: 'Choose your own password' })
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
    expect(env.server.reads).toEqual([])
    expect(screen.getByText('At least 15 characters. A short sentence works well.')).toBeVisible()

    await userEvent.type(screen.getByLabelText('The password you were given'), STAFF_PW)
    await userEvent.type(screen.getByLabelText('New password'), 'too short')
    await userEvent.type(screen.getByLabelText('Type it again'), 'too short')
    await userEvent.click(screen.getByRole('button', { name: 'Save my password' }))
    expect(await screen.findByText('Use at least 15 characters.')).toBeInTheDocument()
    expect(env.server.requests).toEqual([])

    await userEvent.clear(screen.getByLabelText('New password'))
    await userEvent.clear(screen.getByLabelText('Type it again'))
    await userEvent.type(screen.getByLabelText('New password'), 'honey from tetu in march')
    await userEvent.type(screen.getByLabelText('Type it again'), 'honey from tetu in march')
    await userEvent.click(screen.getByRole('button', { name: 'Save my password' }))
    await screen.findByRole('heading', { name: 'B-000003' })
    expect(await env.session.signIn('jane', 'honey from tetu in march')).toBe('ok')
  })

  it('says plainly when the given password is wrong', async () => {
    const env = await staff('operator', { mustChange: true })
    renderConsole(env, '/batches')
    await screen.findByRole('heading', { name: 'Choose your own password' })
    await userEvent.type(screen.getByLabelText('The password you were given'), 'not it at all')
    await userEvent.type(screen.getByLabelText('New password'), 'honey from tetu in march')
    await userEvent.type(screen.getByLabelText('Type it again'), 'honey from tetu in march')
    await userEvent.click(screen.getByRole('button', { name: 'Save my password' }))
    expect(
      await screen.findByText("That isn't the password you were given. Check it and try again."),
    ).toBeInTheDocument()
  })
})

describe('One sign-in for everyone (13 §7 step 2)', () => {
  async function signInAt(path: string, who: 'farmer' | 'operator') {
    const server = new FakeBackend()
    server.addFarmer('+254700000001', 'hunter2!', 11, 7)
    server.addStaff('jane', STAFF_PW, 21, 'operator', 'Jane Mwende')
    const locks = new FakeLocks()
    const session = new Session({
      fetch: server.fetch,
      locks,
      channel: new FakeBus().channel(),
      storage: null,
    })
    const outbox = new Outbox(`console-signin-${++n}`, locks)
    const memory = memoryLocation({ path, record: true })
    render(
      <Providers session={session} outbox={outbox} sync={new SyncRunner(outbox, session)}>
        <Router hook={memory.hook} searchHook={memory.searchHook}>
          <Switch>
            <Route path="/sign-in" component={SignInPage} />
          </Switch>
        </Router>
      </Providers>,
    )
    await screen.findByRole('heading', { name: 'Sign in' })
    const [id, pw] = who === 'farmer' ? ['+254700000001', 'hunter2!'] : ['jane', STAFF_PW]
    await userEvent.type(screen.getByLabelText('Phone number or username'), id)
    await userEvent.type(screen.getByLabelText('Password'), pw)
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await vi.waitFor(() => expect(memory.history.at(-1)).not.toMatch(/^\/sign-in/))
    return memory.history.at(-1)
  }

  it('sends staff to the console and a farmer to the capture app', async () => {
    expect(await signInAt('/sign-in', 'operator')).toBe('/console')
    expect(await signInAt('/sign-in', 'farmer')).toBe('/farm')
  })

  it('follows a next only inside the person’s own app', async () => {
    expect(await signInAt('/sign-in?next=%2Fconsole%2Fbatches%2F4', 'operator')).toBe(
      '/console/batches/4',
    )
    expect(await signInAt('/sign-in?next=%2Ffarm%2Fregister', 'operator')).toBe('/console')
    expect(await signInAt('/sign-in?next=%2Fconsole', 'farmer')).toBe('/farm')
  })
})

describe('Accessibility', () => {
  for (const theme of ['light', 'dark']) {
    it(`the shell, list and record have no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      wide(true)
      const env = await staff('admin')
      const { container } = renderConsole(env, '/batches/4183')
      await screen.findByRole('heading', { name: 'B-000003' })
      await screen.findByText('B-000004')
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })
  }
})

describe('Integrity, by step', () => {
  it('a step is sealed only when every record in it is confirmed', async () => {
    const env = await staff('operator')
    const b = env.server.batchDetails[3] as { stages: { action: string; anchor_status: string }[] }
    // Two of the three S0 rows and the harvest confirmed: only Harvested is sealed.
    b.stages = b.stages.map((s, i) => (i < 2 || i === 3 ? { ...s, anchor_status: 'confirmed' } : s))
    renderConsole(env, '/batches/4183')
    expect(await screen.findByText('Integrity · 1 sealed, 4 sealing')).toBeInTheDocument()
  })
})
