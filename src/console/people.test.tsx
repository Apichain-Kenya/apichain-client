// People (13 §8 item 5): staff accounts, admin only and online only.
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20_000 })
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { renderConsole, STAFF_PW, staff, wide, type Env } from '../test/consoleHarness'

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

const NEW_PW = 'a starting sentence for otieno'

// Jane (id 21) is the admin signing in. Around her: the first admin, another
// admin, an operator who has not chosen a password yet, and a lab officer.
async function admin(opts: { isRoot?: boolean } = {}) {
  const env = await staff('admin', { isRoot: opts.isRoot })
  env.server.addStaff('grace', STAFF_PW, 1, 'admin', 'Grace Njeri', { isRoot: !opts.isRoot })
  env.server.addStaff('peter', STAFF_PW, 30, 'admin', 'Peter Otieno')
  env.server.addStaff('omark', STAFF_PW, 31, 'operator', 'Otieno Mark', { mustChange: true })
  env.server.addStaff('achieng', STAFF_PW, 32, 'lab_officer', 'Achieng Odhiambo')
  return env
}

const nav = () => screen.getAllByRole('navigation', { name: 'Main' })[0]
const writes = (env: Env) => env.server.requests.filter((r) => r.path.startsWith('/v2/users'))

describe('Who sees People', () => {
  it('an operator has no People item, and the route sends them to Batches', async () => {
    const env = await staff('operator')
    const { memory } = renderConsole(env, '/people')
    await screen.findByRole('heading', { name: 'Batches', level: 1 })
    expect(memory.history.at(-1)).toBe('/batches')
    expect(within(nav()).queryByRole('link', { name: 'People' })).not.toBeInTheDocument()
    expect(env.server.reads.some((p) => p.startsWith('/v2/users'))).toBe(false)
  })

  it('an admin has Batches, People and Me', async () => {
    const env = await admin()
    renderConsole(env, '/batches')
    await screen.findByText('B-000004')
    expect(
      within(nav())
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Batches', 'People', 'Me'])
  })
})

describe('The list', () => {
  it('shows each person with their role, and who still has a password someone else set', async () => {
    const env = await admin()
    renderConsole(env, '/people')
    const row = await screen.findByRole('link', { name: /Otieno Mark/ })
    expect(row).toHaveTextContent('omark · operator')
    expect(row).toHaveTextContent("Hasn't chosen a password")
    expect(screen.getByRole('link', { name: /Achieng Odhiambo/ })).toHaveTextContent('Active')
  })
})

describe('Adding a person', () => {
  it('offers "Admin" only to the first admin', async () => {
    for (const isRoot of [false, true]) {
      const env = await admin({ isRoot })
      const { unmount } = renderConsole(env, '/people/new')
      await screen.findByRole('radio', { name: 'Operator' })
      // The root check waits for the admin list; give it time to land.
      await vi.waitFor(() =>
        expect(env.server.reads.some((p) => p.includes('role=admin'))).toBe(true),
      )
      if (isRoot) expect(await screen.findByRole('radio', { name: 'Admin' })).toBeInTheDocument()
      else {
        expect(screen.queryByRole('radio', { name: 'Admin' })).not.toBeInTheDocument()
        expect(screen.getByText('Only the first admin can add another admin.')).toBeVisible()
      }
      unmount()
    }
  })

  it('checks the form first, then adds them, and keeps the password nowhere', async () => {
    const env = await admin()
    const { memory } = renderConsole(env, '/people/new')
    await screen.findByRole('radio', { name: 'Operator' })
    await userEvent.type(screen.getByLabelText('Full name'), 'Mark Kamau')
    await userEvent.type(screen.getByLabelText('Username'), '9mark')
    await userEvent.click(screen.getByRole('radio', { name: 'Operator' }))
    await userEvent.type(screen.getByLabelText('Starting password'), 'too short')
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(
      await screen.findByText(
        'Use 3 to 40 lower-case letters, numbers, dots, dashes or underscores, starting with a letter.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText('Use at least 15 characters.')).toBeInTheDocument()
    expect(writes(env)).toEqual([])

    await userEvent.clear(screen.getByLabelText('Username'))
    await userEvent.type(screen.getByLabelText('Username'), 'mkamau')
    await userEvent.clear(screen.getByLabelText('Starting password'))
    await userEvent.type(screen.getByLabelText('Starting password'), NEW_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))

    expect(await screen.findByRole('link', { name: /Mark Kamau/ })).toHaveTextContent(
      "Hasn't chosen a password",
    )
    expect(writes(env)).toEqual([
      {
        path: '/v2/users',
        key: expect.any(String),
        body: { username: 'mkamau', full_name: 'Mark Kamau', role: 'operator', password: NEW_PW },
      },
    ])
    expect(memory.history.at(-1)).toBe('/people')
    expect(
      screen.getByText(
        "Added Mark Kamau. They'll choose their own password when they first sign in.",
      ),
    ).toHaveAttribute('role', 'status')
    // Online only: nothing of it, least of all the password, goes to the outbox.
    expect(await env.outbox.list(21)).toEqual([])
  })

  it('says plainly when the username is taken', async () => {
    const env = await admin()
    renderConsole(env, '/people/new')
    await screen.findByRole('radio', { name: 'Operator' })
    await userEvent.type(screen.getByLabelText('Full name'), 'Another Mark')
    await userEvent.type(screen.getByLabelText('Username'), 'omark')
    await userEvent.click(screen.getByRole('radio', { name: 'Lab officer' }))
    await userEvent.type(screen.getByLabelText('Starting password'), NEW_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(await screen.findByText('That username is taken. Try another.')).toBeInTheDocument()
  })

  it('says adding people needs internet when offline', async () => {
    const env = await admin()
    renderConsole(env, '/people/new')
    await screen.findByRole('radio', { name: 'Operator' })
    await userEvent.type(screen.getByLabelText('Full name'), 'Mark Kamau')
    await userEvent.type(screen.getByLabelText('Username'), 'mkamau')
    await userEvent.click(screen.getByRole('radio', { name: 'Operator' }))
    await userEvent.type(screen.getByLabelText('Starting password'), NEW_PW)
    env.server.offline = true
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect(
      await screen.findByText("You're offline. Adding people needs internet."),
    ).toBeInTheDocument()
    expect(await env.outbox.list(21)).toEqual([])
  })
})

describe('A person', () => {
  async function deactivate(env: Env, id: number, name: string) {
    const { unmount } = renderConsole(env, `/people/${id}`)
    await screen.findByRole('heading', { name })
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, deactivate' }))
    return unmount
  }

  it('deactivates someone, who can then no longer sign in', async () => {
    const env = await admin()
    await deactivate(env, 32, 'Achieng Odhiambo')
    expect(await screen.findByText('Deactivated')).toBeInTheDocument()
    expect(env.server.account('achieng')?.is_active).toBe(false)
  })

  it('renders each of the three refusals in words', async () => {
    const env = await admin()
    let unmount = await deactivate(env, 1, 'Grace Njeri')
    expect(
      await screen.findByText(
        "This is the first admin's account. It can't be deactivated from the console.",
      ),
    ).toBeInTheDocument()
    unmount()

    unmount = await deactivate(env, 21, 'Jane Mwende')
    expect(
      await screen.findByText("You can't deactivate your own account. Another admin can."),
    ).toBeInTheDocument()
    unmount()

    // Unreachable in one request (ledger, P4b-A): forced to check its words.
    env.server.answerNext = {
      path: /deactivate$/,
      status: 409,
      body: { code: 'last_admin', message: 'Last admin' },
    }
    await deactivate(env, 30, 'Peter Otieno')
    expect(
      await screen.findByText('This is the last active admin. Add another admin first.'),
    ).toBeInTheDocument()
  })

  it('resets a password, so they must choose their own at the next sign-in', async () => {
    const env = await admin()
    renderConsole(env, '/people/32')
    await screen.findByRole('heading', { name: 'Achieng Odhiambo' })
    await userEvent.type(screen.getByLabelText('New starting password'), NEW_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(
      await screen.findByText('Password reset. Give them the new one in person.'),
    ).toBeInTheDocument()
    expect(env.server.account('achieng')?.must_change_password).toBe(true)
    expect(screen.getByLabelText('New starting password')).toHaveValue('')
  })

  it('refuses resets that would take over an account, in words', async () => {
    const env = await admin()
    let { unmount } = renderConsole(env, '/people/21')
    await screen.findByRole('heading', { name: 'Jane Mwende' })
    await userEvent.type(screen.getByLabelText('New starting password'), NEW_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(
      await screen.findByText('Change your own password from Me, with your current one.'),
    ).toBeInTheDocument()
    unmount()
    ;({ unmount } = renderConsole(env, '/people/30'))
    await screen.findByRole('heading', { name: 'Peter Otieno' })
    await userEvent.type(screen.getByLabelText('New starting password'), NEW_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(
      await screen.findByText("Only the first admin can reset another admin's password."),
    ).toBeInTheDocument()
    unmount()
  })
})

describe('Accessibility', () => {
  for (const theme of ['light', 'dark']) {
    it(`the list and the add form have no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      wide(true)
      const env = await admin()
      const { container } = renderConsole(env, '/people/new')
      await screen.findByRole('link', { name: /Otieno Mark/ })
      await screen.findByRole('radio', { name: 'Operator' })
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })
  }
})
