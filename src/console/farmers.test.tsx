// Farmers (13 §9): the list and a farmer's page for field officers and
// admins (D7), online-only enrolment (D8), consent choices through the
// outbox, contact checks, documents (D9) and apiaries.
import axe from 'axe-core'
import { openDB } from 'idb'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 })
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { signInIdentifier } from '../auth/phone'
import { Session } from '../auth/session'
import { consentDraft } from '../offline/outbox'
import { FakeLocks, type FakeFarmer } from '../test/fakeBackend'
import { renderConsole, STAFF_PW, staff, wide, type Env } from '../test/consoleHarness'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
})

const FARMER_PW = 'nafula 2026'

// Jane (21) signs in. Faith (33) is a colleague, so Mwende is hers: Jane can
// still find her and finish the visit (D7).
async function officer(role: 'field_officer' | 'admin' = 'field_officer') {
  const env = await staff(role)
  env.server.addStaff('faith', STAFF_PW, 33, 'field_officer', 'Faith Wairimu')
  const wanjiru = env.server.seedFarmer(
    {
      first_name: 'Wanjiru',
      last_name: 'Kamau',
      phone: '+254712345312',
      number_of_hives: 14,
      phone_verified_at: '2026-10-03T08:10:00',
    },
    { by: 'jane' },
  )
  const mwende = env.server.seedFarmer(
    {
      first_name: 'Mwende',
      last_name: 'Musyoka',
      phone: '+254722908114',
      number_of_hives: 6,
      created_at: '2026-09-28T08:00:00',
    },
    { by: 'faith' },
  )
  return { ...env, wanjiru, mwende }
}

const nav = () => screen.getAllByRole('navigation', { name: 'Main' })[0]
const enrols = (env: Env) => env.server.requests.filter((r) => r.path === '/v2/farmers')

/** Everything this device has kept in IndexedDB, as one string. */
async function everythingStored(): Promise<string> {
  let all = ''
  for (const { name } of await indexedDB.databases()) {
    if (!name) continue
    const db = await openDB(name)
    for (const store of db.objectStoreNames) all += JSON.stringify(await db.getAll(store))
    db.close()
  }
  return all
}

async function fillDetails() {
  await userEvent.type(screen.getByLabelText('First name'), 'Nafula')
  await userEvent.type(screen.getByLabelText('Last name'), 'Wekesa')
  await userEvent.type(screen.getByLabelText('Phone number'), '0745 220 961')
}

/** Phone width: one decision per screen, then Enrol on the last. */
async function enrolOnPhone() {
  await screen.findByRole('heading', { name: 'Enrol a farmer' })
  await fillDetails()
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Read this to Nafula' })
  await userEvent.click(screen.getByRole('checkbox', { name: 'Nafula agrees' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await userEvent.type(await screen.findByLabelText('Their password'), FARMER_PW)
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await screen.findByRole('heading', { name: 'Check before enrolling' })
}

function offlineBrowser() {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

describe('Who sees Farmers (D7)', () => {
  it('an operator has no Farmers item, and the route sends them to Batches', async () => {
    const env = await staff('operator')
    const { memory } = renderConsole(env, '/farmers')
    await screen.findByRole('heading', { name: 'Batches', level: 1 })
    expect(memory.history.at(-1)).toBe('/batches')
    expect(within(nav()).queryByRole('link', { name: 'Farmers' })).not.toBeInTheDocument()
    expect(env.server.reads.some((p) => p.startsWith('/v2/farmers'))).toBe(false)
  })

  it('a field officer has Batches, Farmers and Me; an admin also has People', async () => {
    const env = await officer()
    const { unmount } = renderConsole(env, '/farmers')
    await screen.findByText('Wanjiru Kamau')
    expect(
      within(nav())
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Batches', 'Farmers', 'Me'])
    unmount()
    const admin = await officer('admin')
    renderConsole(admin, '/farmers')
    await screen.findByText('Wanjiru Kamau')
    expect(
      within(nav())
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Batches', 'Farmers', 'People', 'Me'])
  })
})

describe('The list', () => {
  it("shows every farmer, a colleague's too, with phone, hives and who enrolled them", async () => {
    const env = await officer()
    renderConsole(env, '/farmers')
    const mwende = await screen.findByRole('link', { name: /Mwende Musyoka/ })
    expect(mwende).toHaveTextContent('0722 908 114 · 6 hives')
    // en-KE's own month abbreviation (CLDR).
    expect(mwende).toHaveTextContent('Enrolled 28 Sept by Faith Wairimu')
    expect(mwende).toHaveTextContent('Phone not confirmed')
    expect(screen.getByRole('link', { name: /Wanjiru Kamau/ })).toHaveTextContent('Phone confirmed')
  })

  it('finds a farmer by a phone number typed the local way', async () => {
    const env = await officer()
    renderConsole(env, '/farmers')
    await screen.findByText('Wanjiru Kamau')
    await userEvent.type(
      screen.getByRole('searchbox', { name: 'Find by name or phone' }),
      '0722 908 114',
    )
    await vi.waitFor(() => expect(screen.queryByText('Wanjiru Kamau')).not.toBeInTheDocument())
    expect(screen.getByText('Mwende Musyoka')).toBeInTheDocument()
    expect(env.server.reads.at(-1)).toContain('q=722908114')
  })
})

describe('Enrolling a farmer (D8: online only)', () => {
  it('enrols, never keeps the password on the device, and the farmer can sign in the local way', async () => {
    const env = await officer()
    const { memory } = renderConsole(env, '/farmers/new')
    await enrolOnPhone()
    const summary = screen.getByRole('list', { name: 'Check before enrolling' })
    expect(summary).toHaveTextContent('Phone0745 220 961')
    expect(summary).toHaveTextContent('AgreementAgreed')
    expect(summary).toHaveTextContent('PasswordChosen')
    expect(summary).not.toHaveTextContent(FARMER_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Enrol' }))

    await screen.findByRole('heading', { name: 'Nafula Wekesa' })
    expect(
      screen.getByText(
        "Nafula Wekesa is enrolled. They'll choose their own password when they first sign in.",
      ),
    ).toBeInTheDocument()
    const [farmer] = env.server.farmers.slice(-1)
    expect(memory.history.at(-1)).toBe(`/farmers/${farmer.id}`)
    expect(enrols(env)).toEqual([
      {
        path: '/v2/farmers',
        key: expect.any(String),
        body: {
          first_name: 'Nafula',
          last_name: 'Wekesa',
          phone: '+254745220961',
          email: null,
          address: null,
          number_of_hives: null,
          password: FARMER_PW,
          consent_granted: true,
          consent_text_version: 'en-2026-10',
        },
      },
    ])
    expect(env.server.consents.filter((c) => c.farmer_id === farmer.id)).toMatchObject([
      { purpose: 'data_processing', granted: true, text_version: 'en-2026-10' },
    ])

    // Nothing of it was kept: not in the outbox, not anywhere in IndexedDB.
    expect(await env.outbox.list(21)).toEqual([])
    expect(await everythingStored()).not.toContain(FARMER_PW)

    // The stored phone is the sign-in identifier; typed the local way, it works.
    const phone = new Session({
      fetch: env.server.fetch,
      locks: new FakeLocks(),
      channel: null,
      storage: null,
    })
    expect(await phone.signIn(signInIdentifier('0745 220 961'), FARMER_PW)).toBe('ok')
    expect(env.server.farmerAccount(farmer.id)?.must_change_password).toBe(true)
  })

  it('on a laptop, every section is on one page and one press enrols', async () => {
    wide(true)
    const env = await officer()
    renderConsole(env, '/farmers/new')
    await screen.findByRole('heading', { name: 'Enrol a farmer' })
    await userEvent.click(screen.getByRole('button', { name: 'Enrol' }))
    // Everything is checked at once, and nothing is sent.
    expect(await screen.findByText('Write their first name.')).toBeInTheDocument()
    expect(screen.getByText('Enrolment needs their agreement.')).toBeInTheDocument()
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(enrols(env)).toEqual([])
    await fillDetails()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nafula agrees' }))
    await userEvent.type(screen.getByLabelText('Their password'), FARMER_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Enrol' }))
    await screen.findByRole('heading', { name: 'Nafula Wekesa' })
    expect(enrols(env)).toHaveLength(1)
  })

  it('checks each section before moving on, and sends nothing until it is right', async () => {
    const env = await officer()
    renderConsole(env, '/farmers/new')
    await screen.findByRole('heading', { name: 'Enrol a farmer' })
    await userEvent.type(screen.getByLabelText('Phone number'), '0812 345 678')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Write their first name.')).toBeInTheDocument()
    expect(screen.getByText('Use a Kenyan mobile number, like 0712 345 678.')).toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Phone number'))
    await fillDetails()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Read this to Nafula' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Enrolment needs their agreement.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Nafula agrees' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.type(await screen.findByLabelText('Their password'), 'short')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(enrols(env)).toEqual([])
  })

  it('offline, the button is off and says why', async () => {
    const env = await officer()
    renderConsole(env, '/farmers/new')
    await enrolOnPhone()
    offlineBrowser()
    const button = await screen.findByRole('button', { name: 'Enrolling needs internet' })
    expect(button).toBeDisabled()
    expect(
      screen.getByText(
        "This isn't saved on this device, because it includes their password. Stay on this screen and press Enrol when you have signal. If you leave, you'll need to type it again.",
      ),
    ).toBeInTheDocument()
    expect(enrols(env)).toEqual([])
  })

  it('a reply lost on the way back is retried under the same key, enrolling once', async () => {
    const env = await officer()
    renderConsole(env, '/farmers/new')
    await enrolOnPhone()
    env.server.loseResponseFor = '/v2/farmers'
    await userEvent.click(screen.getByRole('button', { name: 'Enrol' }))
    expect(await screen.findByText("You're offline. Enrolling needs internet.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enrol' }))
    await screen.findByRole('heading', { name: 'Nafula Wekesa' })
    const [first, second] = enrols(env)
    expect(second.key).toBe(first.key)
    expect(env.server.farmers.filter((f) => f.phone === '+254745220961')).toHaveLength(1)
  })

  it('says plainly when the number is already enrolled', async () => {
    const env = await officer()
    renderConsole(env, '/farmers/new')
    await screen.findByRole('heading', { name: 'Enrol a farmer' })
    await userEvent.type(screen.getByLabelText('First name'), 'Mwende')
    await userEvent.type(screen.getByLabelText('Last name'), 'Musyoka')
    await userEvent.type(screen.getByLabelText('Phone number'), '0722 908 114')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mwende agrees' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.type(await screen.findByLabelText('Their password'), FARMER_PW)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Enrol' }))
    expect(
      await screen.findByText(
        'This number is already enrolled. If you just enrolled them, find them in Farmers.',
      ),
    ).toBeInTheDocument()
  })
})

describe('Their choices (13 §4.5, D11)', () => {
  const sw = (name: string) => screen.getByRole('switch', { name })

  it('shows three switches and the fixed agreement, and no photo row', async () => {
    const env = await officer()
    env.server.consent(env.wanjiru.id, 'sms_notifications', false, 'farmer_self')
    renderConsole(env, `/farmers/${env.wanjiru.id}`)
    await screen.findByRole('heading', { name: 'Their choices' })
    expect(screen.getAllByRole('switch')).toHaveLength(3)
    expect(sw('Keep copies of my ID and land papers')).toHaveAttribute('aria-checked', 'false')
    expect(sw('Keep copies of my ID and land papers')).toBeEnabled()
    // The farmer turned texts off themselves: locked for staff.
    expect(sw('Send me a text when my honey reaches a new step')).toBeDisabled()
    expect(screen.getByText('Only the farmer can turn this back on')).toBeInTheDocument()
    expect(screen.getByText('Turned off by the farmer, 11 Oct')).toBeInTheDocument()
    expect(sw('Email me when my honey reaches a new step')).toBeDisabled()
    expect(screen.getByText('No email on file')).toBeInTheDocument()
    expect(screen.getByText('Keep my details and harvest records')).toBeInTheDocument()
    expect(screen.getByText('Agreed at enrolment, 3 Oct')).toBeInTheDocument()
    const rows = screen.getByRole('heading', { name: 'Their choices' }).parentElement!
    expect(within(rows).queryByText(/photo/i)).not.toBeInTheDocument()
  })

  it('a switch saves on the device first, then the server records it in this wording', async () => {
    const env = await officer()
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await screen.findByRole('switch', { name: 'Send me a text when my honey reaches a new step' })
    env.server.offline = true
    await userEvent.click(sw('Send me a text when my honey reaches a new step'))
    expect(await screen.findByText('Saved on this device')).toBeInTheDocument()
    expect(screen.getByText('Turned on with Jane Mwende, just now')).toBeInTheDocument()
    expect(sw('Send me a text when my honey reaches a new step')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    env.server.offline = false
    await env.sync.kick({ force: true })
    await vi.waitFor(() =>
      expect(env.server.consents.at(-1)).toMatchObject({
        farmer_id: env.mwende.id,
        purpose: 'sms_notifications',
        granted: true,
        granted_via: 'onboarder',
        text_version: 'en-2026-10',
      }),
    )
    await vi.waitFor(() =>
      expect(screen.queryByText('Saved on this device')).not.toBeInTheDocument(),
    )
  })

  it("the server's refusal of a farmer's own withdrawal says so, and can be removed", async () => {
    const env = await officer()
    // The farmer withdrew, then staff recorded a withdrawal on top: the newest
    // row is not the farmer's, so only the server can tell (farmers.py).
    env.server.consent(
      env.mwende.id,
      'sms_notifications',
      false,
      'farmer_self',
      '2026-10-10T07:00:00',
    )
    env.server.consent(
      env.mwende.id,
      'sms_notifications',
      false,
      'onboarder',
      '2026-10-11T07:00:00',
    )
    renderConsole(env, `/farmers/${env.mwende.id}`)
    const texts = await screen.findByRole('switch', {
      name: 'Send me a text when my honey reaches a new step',
    })
    expect(texts).toBeEnabled()
    await userEvent.click(texts)
    const refusal = await screen.findByRole('alert')
    expect(refusal).toHaveTextContent('Only the farmer can turn this back on')
    // No second press behind it: the switch waits until the refusal is gone.
    expect(texts).toBeDisabled()
    expect(await env.outbox.waitingWork(21)).toBe(1)
    await userEvent.click(within(refusal).getByRole('button', { name: 'Remove' }))
    await vi.waitFor(async () => expect(await env.outbox.list(21)).toEqual([]))
    // The page hears of it on its next outbox read: wait for the screen.
    await vi.waitFor(() => expect(texts).toBeEnabled())
    expect(texts).toHaveAttribute('aria-checked', 'false')
  })
})

describe('Documents (D9: online only)', () => {
  const PDF = () =>
    new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 9])], 'id.pdf', {
      type: 'application/pdf',
    })
  const upload = () => screen.getByLabelText('Choose a file')
  const uploads = (env: Env) => env.server.requests.filter((r) => r.path.endsWith('/documents'))

  it('upload stays off until the server has the agreement, not just this device', async () => {
    const env = await officer()
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await screen.findByRole('heading', { name: 'Documents' })
    expect(upload()).toBeDisabled()
    // The reason appears once the outbox has been read too.
    expect(
      await screen.findByText(
        'Upload opens once they agree to copies of their ID and papers being kept.',
      ),
    ).toBeInTheDocument()

    env.server.offline = true
    await userEvent.click(
      screen.getByRole('switch', { name: 'Keep copies of my ID and land papers' }),
    )
    expect(
      await screen.findByText(
        'Waiting for their agreement to reach the server. Upload opens once it has.',
      ),
    ).toBeInTheDocument()
    expect(upload()).toBeDisabled()

    env.server.offline = false
    await env.sync.kick({ force: true })
    await vi.waitFor(() => expect(upload()).toBeEnabled())
  })

  it('a withdrawal saved on this device closes upload at once', async () => {
    const env = await officer()
    env.server.consent(env.mwende.id, 'document_upload', true, 'onboarder')
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await vi.waitFor(() => expect(upload()).toBeEnabled())
    env.server.offline = true
    await userEvent.click(
      screen.getByRole('switch', { name: 'Keep copies of my ID and land papers' }),
    )
    await vi.waitFor(() => expect(upload()).toBeDisabled())
    expect(
      screen.getByText('Upload opens once they agree to copies of their ID and papers being kept.'),
    ).toBeInTheDocument()
  })

  it('refuses an 11 MB file and a renamed .docx without sending anything', async () => {
    const env = await officer()
    env.server.consent(env.mwende.id, 'document_upload', true, 'onboarder')
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await vi.waitFor(() => expect(upload()).toBeEnabled())

    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'scan.pdf', {
      type: 'application/pdf',
    })
    await userEvent.upload(upload(), big)
    expect(
      await screen.findByText('That file is over 10 MB. Choose a smaller one.'),
    ).toBeInTheDocument()

    // A Word file (a zip) renamed to look like a PDF.
    const docx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 6, 0])], 'id.pdf', {
      type: 'application/pdf',
    })
    await userEvent.upload(upload(), docx)
    expect(
      await screen.findByText(
        'Only PDF, JPG or PNG files can be filed. This file is another kind, whatever its name says.',
      ),
    ).toBeInTheDocument()
    expect(uploads(env)).toEqual([])
  })

  it('files a document, says so plainly when it is already on file, and lists it', async () => {
    const env = await officer()
    env.server.consent(env.mwende.id, 'document_upload', true, 'onboarder')
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await vi.waitFor(() => expect(upload()).toBeEnabled())
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'National ID')
    await userEvent.upload(upload(), PDF())
    expect(await screen.findByText('Filed.')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Download National ID, id.pdf' }),
    ).toBeInTheDocument()
    expect(uploads(env)).toEqual([
      {
        path: `/v2/farmers/${env.mwende.id}/documents`,
        key: null,
        body: { doc_type: 'national_id', file: 'id.pdf' },
      },
    ])
    await userEvent.upload(upload(), PDF())
    expect(await screen.findByText('This file is already on file.')).toBeInTheDocument()
    expect(env.server.documents).toHaveLength(1)
  })

  it("says the file checker is starting up when it's down", async () => {
    const env = await officer()
    env.server.consent(env.mwende.id, 'document_upload', true, 'onboarder')
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await vi.waitFor(() => expect(upload()).toBeEnabled())
    env.server.answerNext = {
      path: /\/documents$/,
      status: 503,
      body: { code: 'scanner_unavailable', message: 'The virus scanner is unavailable' },
    }
    await userEvent.upload(upload(), PDF())
    expect(
      await screen.findByText('The file checker is starting up. Try again in a few minutes.'),
    ).toBeInTheDocument()
  })

  it('asks for a fresh signed link on every download, opens no tab, and keeps none', async () => {
    const env = await officer()
    env.server.consent(env.mwende.id, 'document_upload', true, 'onboarder')
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await vi.waitFor(() => expect(upload()).toBeEnabled())
    await userEvent.upload(upload(), PDF())
    const download = await screen.findByRole('button', {
      name: 'Download National ID, id.pdf',
    })
    // The server signs every link as an attachment (3b, `storage.py`), so the
    // browser saves it and the console stays. A tab opened first would only
    // ever stay blank (found in the P4b-H browser walk).
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    const followed: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      followed.push(this.href)
    })
    await userEvent.click(download)
    await userEvent.click(download)
    await vi.waitFor(() => expect(followed).toEqual(env.server.signedUrls))
    click.mockRestore()
    expect(env.server.signedUrls).toHaveLength(2)
    expect(new Set(env.server.signedUrls).size).toBe(2)
    expect(opened).not.toHaveBeenCalled()
    expect(document.body.innerHTML).not.toContain('store.test')
    expect(await everythingStored()).not.toContain('store.test')
  })
})

describe('Confirming a number (13 §9 item 5)', () => {
  async function open(env: Env & { mwende: FakeFarmer }) {
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await userEvent.click(await screen.findByRole('link', { name: 'Confirm their number' }))
    await screen.findByRole('heading', { name: 'Confirm this number is theirs' })
  }

  it('sends a code, counts down to the resend time the server gives, and confirms', async () => {
    const env = await officer()
    // The server's clock is 55 s behind ours: the wait comes from its answer.
    env.server.now = () => Date.now() - 55_000
    await open(env)
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText('Code sent. It works for 10 minutes.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send a new code in 0:0[1-5]$/ })).toBeDisabled()
    await vi.waitFor(
      () => expect(screen.getByRole('button', { name: 'Send a new code' })).toBeEnabled(),
      {
        timeout: 8000,
      },
    )

    const code = screen.getByLabelText('Code')
    expect(code).toHaveAttribute('inputmode', 'numeric')
    expect(code).toHaveAttribute('autocomplete', 'one-time-code')
    await userEvent.type(code, '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText("That code isn't right. 4 tries left.")).toBeInTheDocument()

    await userEvent.clear(code)
    await userEvent.type(code, env.server.outbound.at(-1)!.code)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('heading', { name: 'Mwende Musyoka' })
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
    expect(env.server.farmers.find((f) => f.id === env.mwende.id)?.phone_verified_at).not.toBeNull()
  })

  it('on a laptop, the list beside it says the number is confirmed too', async () => {
    wide(true)
    const env = await officer()
    renderConsole(env, `/farmers/${env.mwende.id}/verify/sms`)
    await screen.findByRole('heading', { name: 'Confirm this number is theirs' })
    const row = await screen.findByRole('link', { name: /Mwende Musyoka/ })
    expect(row).toHaveTextContent('Phone not confirmed')
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByText('Code sent. It works for 10 minutes.')
    await userEvent.type(screen.getByLabelText('Code'), env.server.outbound.at(-1)!.code)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await vi.waitFor(() =>
      expect(screen.getByRole('link', { name: /Mwende Musyoka/ })).toHaveTextContent(
        'Phone confirmed',
      ),
    )
  })

  it('an email on file is confirmed the same way, and can take the email choice', async () => {
    const env = await officer()
    const achieng = env.server.seedFarmer({
      first_name: 'Achieng',
      last_name: 'Otieno',
      phone: '+254733410287',
      email: 'achieng@example.org',
    })
    renderConsole(env, `/farmers/${achieng.id}`)
    expect(
      await screen.findByRole('switch', { name: 'Email me when my honey reaches a new step' }),
    ).toBeEnabled()
    await userEvent.click(screen.getByRole('link', { name: 'Confirm their email' }))
    await screen.findByRole('heading', { name: 'Confirm this email is theirs' })
    expect(screen.getByText(/achieng@example\.org/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByText('Code sent. It works for 10 minutes.')
    expect(env.server.outbound.at(-1)).toMatchObject({ farmerId: achieng.id, channel: 'email' })
    await userEvent.type(screen.getByLabelText('Code'), env.server.outbound.at(-1)!.code)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await screen.findByRole('heading', { name: 'Achieng Otieno' })
    expect(env.server.farmers.find((f) => f.id === achieng.id)?.email_verified_at).not.toBeNull()
  })

  it("a 429 holds the button for the server's Retry-After", async () => {
    const env = await officer()
    await open(env)
    env.server.answerNext = {
      path: /\/verifications$/,
      status: 429,
      body: { code: 'rate_limited', message: 'Too many', details: { retry_after_seconds: 30 } },
      headers: { 'Retry-After': '30' },
    }
    await userEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect(
      await screen.findByText('Too many codes for now. Wait, then send a new one.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send a new code in 0:(30|29)$/ })).toBeDisabled()
  })

  it('a locked or missing code asks for a new one', async () => {
    const env = await officer()
    await open(env)
    await userEvent.type(screen.getByLabelText('Code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText("There's no code to check. Send a new code."),
    ).toBeInTheDocument()
    env.server.answerNext = {
      path: /\/confirm$/,
      status: 422,
      body: { code: 'code_locked', message: 'Too many wrong attempts' },
    }
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(
      await screen.findByText("That code can't be used any more. Send a new code."),
    ).toBeInTheDocument()
  })
})

describe('Apiaries (13 §9 item 7)', () => {
  it('an officer adds an apiary for the farmer through the outbox', async () => {
    const env = await officer()
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({
            coords: { latitude: -0.9871, longitude: 38.0211, accuracy: 12 },
          } as GeolocationPosition),
      },
    })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false) // no map in this test
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await userEvent.click(await screen.findByRole('link', { name: 'Add an apiary' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use my location' }))
    expect(await screen.findByText('Your location, within about 12 m.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Apiary name'), 'Kyuso')
    await userEvent.click(screen.getByRole('button', { name: 'Save apiary' }))
    await screen.findByRole('heading', { name: 'Mwende Musyoka' })
    await vi.waitFor(() =>
      expect(env.server.apiaries).toEqual([
        {
          id: 101,
          farmer_id: env.mwende.id,
          name: 'Kyuso',
          latitude: '-0.987100',
          longitude: '38.021100',
          hive_count: 1,
        },
      ]),
    )
    expect(await screen.findByText('Kyuso')).toBeInTheDocument()
  })
})

describe('Resetting a farmer password (board call 5)', () => {
  it('admins only, with the farmer minimum of 8', async () => {
    const fo = await officer()
    const { unmount } = renderConsole(fo, `/farmers/${fo.mwende.id}`)
    await screen.findByRole('heading', { name: 'Their choices' })
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument()
    unmount()

    const env = await officer('admin')
    renderConsole(env, `/farmers/${env.mwende.id}`)
    await userEvent.type(await screen.findByLabelText('New starting password'), 'mwende 26')
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(
      await screen.findByText('Password reset. Give them the new one in person.'),
    ).toBeInTheDocument()
    expect(env.server.farmerAccount(env.mwende.id)).toMatchObject({
      must_change_password: true,
      password: 'mwende 26',
    })
  })
})

describe('Accessibility', () => {
  for (const theme of ['light', 'dark']) {
    it(`the list and a farmer's page have no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      wide(true)
      const env = await officer('admin')
      env.server.consent(env.mwende.id, 'sms_notifications', false, 'farmer_self')
      const { container } = renderConsole(env, `/farmers/${env.mwende.id}`)
      await screen.findByText('Wanjiru Kamau')
      await screen.findByRole('heading', { name: 'Their choices' })
      await screen.findByLabelText('Choose a file')
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })

    it(`a refused choice and the add-apiary screen have no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      const env = await officer()
      env.server.consent(
        env.mwende.id,
        'sms_notifications',
        false,
        'farmer_self',
        '2026-10-10T07:00:00',
      )
      env.server.consent(
        env.mwende.id,
        'sms_notifications',
        false,
        'onboarder',
        '2026-10-11T07:00:00',
      )
      const { container, unmount } = renderConsole(env, `/farmers/${env.mwende.id}`)
      await userEvent.click(
        await screen.findByRole('switch', {
          name: 'Send me a text when my honey reaches a new step',
        }),
      )
      await screen.findByRole('alert')
      let result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
      unmount()
      const next = renderConsole(env, `/farmers/${env.mwende.id}/apiary`)
      await screen.findByRole('heading', { name: 'Add an apiary' })
      result = await axe.run(next.container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })

    it(`the enrol form and the number check have no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      wide(true)
      const env = await officer()
      const { container, unmount } = renderConsole(env, '/farmers/new')
      await screen.findByRole('checkbox', { name: 'The farmer agrees' })
      let result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
      unmount()
      const next = renderConsole(env, `/farmers/${env.mwende.id}/verify/sms`)
      await screen.findByRole('heading', { name: 'Confirm this number is theirs' })
      result = await axe.run(next.container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })
  }
})

describe('Me: farmer work waiting or refused, never stranded', () => {
  it("counts queued choices and apiaries, and links a refused one to the farmer's page", async () => {
    const env = await officer()
    env.server.consent(env.mwende.id, 'sms_notifications', false, 'farmer_self')
    await env.outbox.enqueue(
      21,
      [consentDraft(env.mwende.id, 'sms_notifications', true, 'en-2026-10')],
      1,
    )
    await env.outbox.replay(21, env.session, Date.now)
    env.server.offline = true
    await env.outbox.enqueue(
      21,
      [consentDraft(env.wanjiru.id, 'document_upload', true, 'en-2026-10')],
      2,
    )
    renderConsole(env, '/me')
    expect(
      await screen.findByText(
        "1 change to a farmer's page is waiting to send. It will send the next time you sign in here.",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: `A choice for farmer ${env.mwende.id}` }),
    ).toHaveAttribute('href', `/farmers/${env.mwende.id}`)
  })
})
