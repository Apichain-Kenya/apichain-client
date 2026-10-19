// The farmer's own message choices (13 §11 item 1, board "The farmer's own
// choices"): texts and emails only, both off until the farmer turns one on,
// each a `consent.record` through the outbox in the wording the farmer read.
import 'fake-indexeddb/auto'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Session } from '../auth/session'
import { CONSENT_TEXT_VERSION } from '../i18n/consent'
import { Outbox, consentDraft } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { Snapshots } from '../offline/snapshots'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { FarmRoutes } from './FarmApp'
import { FarmServicesContext, type FarmServices } from './FarmServices'

vi.setConfig({ testTimeout: 20_000 })

const TEXTS = 'Send me a text when my honey reaches a new step'
const EMAILS = 'Email me when my honey reaches a new step'
const NOW = Date.parse('2026-10-13T06:52:00Z')

let server: FakeBackend
let services: FarmServices
let farmer: { id: number; user_id: number }
let online = true
let n = 0

async function setup(opts: { email?: string | null } = {}) {
  server = new FakeBackend()
  server.now = () => NOW
  farmer = server.seedFarmer(
    {
      first_name: 'Wanjiru',
      last_name: 'Kamau',
      phone: '+254712345312',
      email: opts.email ?? null,
    },
    { password: 'hunter22' },
  )
  const session = new Session({
    fetch: server.fetch,
    locks: new FakeLocks(),
    channel: new FakeBus().channel(),
  })
  await session.signIn('+254712345312', 'hunter22')
  const outbox = new Outbox(`choices-test-${++n}`, new FakeLocks())
  online = true
  services = {
    session,
    outbox,
    sync: new SyncRunner(outbox, session, () => NOW),
    snapshots: new Snapshots(`choices-snap-${n}`),
    today: () => '2026-10-13',
    now: () => NOW,
    locate: async () => ({ lat: 0, lon: 0, accuracy: 10 }),
    online: () => online,
  }
}

function goOffline() {
  online = false
  server.offline = true
}

function renderMe() {
  const memory = memoryLocation({ path: '/me', record: true })
  return render(
    <FarmServicesContext.Provider value={services}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <FarmRoutes
          signedInAs={{
            user_id: farmer.user_id,
            role: 'farmer',
            display_name: 'Wanjiru Kamau',
            farmer_id: farmer.id,
            must_change_password: false,
          }}
        />
      </Router>
    </FarmServicesContext.Provider>,
  )
}

const choices = () => services.outbox.list(farmer.user_id)
/** A switch once the page has read this phone's saved choices. */
async function ready(name: string) {
  const sw = await screen.findByRole('switch', { name })
  await vi.waitFor(() => expect(sw).toBeEnabled())
  return sw
}
const sendAll = () => services.outbox.replay(farmer.user_id, services.session, () => NOW)

beforeEach(async () => {
  await setup()
})

describe("the farmer's own message choices", () => {
  it('both start off; emails wait for an email on file; nothing else of consent shows', async () => {
    renderMe()
    const texts = await ready(TEXTS)
    const emails = screen.getByRole('switch', { name: EMAILS })
    expect(texts).toHaveAttribute('aria-checked', 'false')
    expect(emails).toHaveAttribute('aria-checked', 'false')
    expect(emails).toBeDisabled()
    expect(screen.getByText('No email on file')).toBeInTheDocument()
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryByText(/Keep copies of my ID/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Keep my details/)).not.toBeInTheDocument()
    // The phone the farmer signs in with, as they would write it.
    expect(await screen.findByText('0712 345 312')).toBeInTheDocument()
  })

  it('turning texts on queues one consent.record in the wording shown, and it sends', async () => {
    renderMe()
    await userEvent.click(await ready(TEXTS))
    const [row] = await choices()
    expect(row.kind).toBe('consent.record')
    expect(row.body).toEqual({
      farmer_id: farmer.id,
      purpose: 'sms_notifications',
      granted: true,
      text_version: CONSENT_TEXT_VERSION,
    })
    await vi.waitFor(() =>
      expect(screen.getByRole('switch', { name: TEXTS })).toHaveAttribute('aria-checked', 'true'),
    )

    await sendAll()
    expect(server.consents.at(-1)).toMatchObject({
      purpose: 'sms_notifications',
      granted: true,
      granted_via: 'farmer_self',
    })
    expect(await screen.findByText('You turned this on on 13 Oct')).toBeInTheDocument()
  })

  it('works offline after a reload, from what this phone last saw', async () => {
    await setup({ email: 'wanjiru@example.com' })
    const first = renderMe()
    await vi.waitFor(() => expect(screen.getByRole('switch', { name: EMAILS })).toBeEnabled())
    first.unmount()

    goOffline()
    renderMe()
    const emails = await ready(EMAILS)
    await userEvent.click(emails)
    expect(
      await within(emails.closest('div')!.parentElement!).findByText('Saved on this phone'),
    ).toBeInTheDocument()
    expect((await choices())[0].body).toMatchObject({
      purpose: 'email_notifications',
      granted: true,
    })
  })

  it('says who set a choice, and the farmer may turn back on what they turned off', async () => {
    server.consent(farmer.id, 'sms_notifications', false, 'farmer_self', '2026-10-11T07:00:00')
    server.consent(farmer.id, 'email_notifications', true, 'onboarder', '2026-10-03T08:00:00')
    renderMe()
    expect(await screen.findByText('You turned this off on 11 Oct')).toBeInTheDocument()
    await userEvent.click(await ready(TEXTS))
    expect((await choices())[0].body).toMatchObject({ granted: true })
  })

  it("a field officer's choice is said as theirs", async () => {
    await setup({ email: 'wanjiru@example.com' })
    server.consent(farmer.id, 'email_notifications', true, 'onboarder', '2026-10-03T08:00:00')
    renderMe()
    expect(
      await screen.findByText('Your field officer turned this on on 3 Oct'),
    ).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: EMAILS })).toHaveAttribute('aria-checked', 'true')
  })

  it('a refused choice says so and can be removed; its switch waits until then', async () => {
    await services.outbox.enqueue(
      farmer.user_id,
      [consentDraft(farmer.id, 'sms_notifications', true, CONSENT_TEXT_VERSION)],
      NOW,
    )
    server.answerNext = {
      path: /\/consents$/,
      status: 422,
      body: { code: 'invalid', message: 'Something was wrong' },
    }
    await sendAll()
    renderMe()
    expect(await screen.findByText('Not accepted: Something was wrong')).toBeInTheDocument()
    const texts = screen.getByRole('switch', { name: TEXTS })
    expect(texts).toBeDisabled()
    expect(texts).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }))
    await vi.waitFor(() => expect(texts).toBeEnabled())
    expect(await choices()).toHaveLength(0)
  })

  it('a waiting choice is not called a harvest when signing out', async () => {
    goOffline()
    renderMe()
    await userEvent.click(await ready(TEXTS))
    expect(
      await screen.findByText(
        '1 choice about messages is still on this phone. It will send when you sign back in.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/harvest/)).not.toBeInTheDocument()
  })

  it.each(['light', 'dark'])('the Me page has no axe violations (%s)', async (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    server.consent(farmer.id, 'sms_notifications', true, 'farmer_self', '2026-10-11T07:00:00')
    const { container } = renderMe()
    await screen.findByText('You turned this on on 11 Oct')
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => v.id)).toEqual([])
    document.documentElement.removeAttribute('data-theme')
  })
})
