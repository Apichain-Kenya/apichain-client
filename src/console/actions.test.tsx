// Inline staff actions (13 §8, P4b-D): the next step at the foot of the
// record, offered only as `next_action` allows, saved through the outbox.
import axe from 'axe-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20_000 })
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { stageDraft } from '../offline/outbox'
import { renderConsole, staff, wide, type Env } from '../test/consoleHarness'

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-theme')
})

const card = () => screen.getByRole('region', { name: 'Next step' })
// A step is a save, a send and a reload: allow for two busy test workers.
const eventually = (fn: () => void) => vi.waitFor(fn, { timeout: 5000 })
const today = () => new Date().toLocaleDateString('en-CA')

// The card waits for this person's saved steps before it shows anything, so a
// step already saved never flashes up as a form that could be sent twice.
async function open(env: Env, id: number, code: string, next = true) {
  const utils = renderConsole(env, `/batches/${id}`)
  await screen.findByRole('heading', { name: code })
  if (next) await screen.findByRole('region', { name: 'Next step' })
  return utils
}

describe('The four staff kinds (13 §8 item 1)', () => {
  it('each sends to its own step, with the batch id in the path only', async () => {
    const env = await staff('admin')
    const steps = [
      ['batch.process', { extraction_method: 'centrifugal' }],
      ['batch.lab_verify', { moisture_pct: '18.4' }],
      ['batch.package', { unit_count: 120, jar_ids: [] }],
      ['batch.distribute', { retailer_name: 'Naivas Nyeri' }],
    ] as const
    await env.outbox.enqueue(
      21,
      steps.map(([kind, body]) => stageDraft(kind, 4180, body)),
      Date.now(),
    )
    expect(await env.outbox.waitingWork(21)).toBe(4)
    const result = await env.outbox.replay(21, env.session, Date.now)
    expect(result).toEqual({ sent: 4, paused: null })
    expect(env.server.requests.map((r) => [r.path, r.body])).toEqual([
      ['/v2/batches/4180/process', { extraction_method: 'centrifugal' }],
      ['/v2/batches/4180/lab-verify', { moisture_pct: '18.4' }],
      ['/v2/batches/4180/package', { unit_count: 120, jar_ids: [] }],
      ['/v2/batches/4180/distribute', { retailer_name: 'Naivas Nyeri' }],
    ])
    expect(new Set(env.server.requests.map((r) => r.key)).size).toBe(4)
    expect(await env.outbox.waitingWork(21)).toBe(0)
  })

  it('stays with the person who saved it', async () => {
    const env = await staff('operator')
    await env.outbox.enqueue(21, [stageDraft('batch.process', 4180, {})], Date.now())
    expect(await env.outbox.list(22)).toEqual([])
    await expect(env.outbox.replay(22, env.session, Date.now)).rejects.toThrow(/another user/)
  })
})

describe('The next step, as the server allows it', () => {
  it('an operator records processing, and the record names her', async () => {
    const env = await staff('operator')
    await open(env, 4180, 'B-000000')
    expect(within(card()).getByRole('heading', { name: 'Record processing' })).toBeVisible()
    expect(screen.queryByText(/as an admin/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Crush and strain' }))
    await userEvent.type(screen.getByLabelText(/^Moisture after processing/), '17.8')
    await userEvent.type(screen.getByLabelText(/^Handling notes/), 'Strained twice')
    await userEvent.click(screen.getByRole('button', { name: 'Save processing' }))

    expect(await screen.findByText('Recorded by Jane Mwende, operator')).toBeInTheDocument()
    expect(env.server.stageWrites).toEqual([
      {
        route: 'process',
        batchId: 4180,
        body: {
          extraction_method: 'crush_and_strain',
          moisture_content: '17.8',
          handling_notes: 'Strained twice',
        },
      },
    ])
    // Past her step, the card says what it waits for and offers no form.
    expect(
      await within(card()).findByRole('heading', { name: 'Waiting for the lab' }),
    ).toBeVisible()
    expect(within(card()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('"Other" sends the method in the operator\'s own words', async () => {
    const env = await staff('operator')
    await open(env, 4180, 'B-000000')
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save processing' }))
    expect(await screen.findByText('Say how it was extracted.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('How, in a few words'), 'Press and settle')
    await userEvent.click(screen.getByRole('button', { name: 'Save processing' }))
    await eventually(() =>
      expect(env.server.stageWrites[0]?.body).toEqual({ extraction_method: 'Press and settle' }),
    )
  })

  it('a lab officer on a harvested batch sees "Waiting for processing" and no form', async () => {
    const env = await staff('lab_officer')
    await open(env, 4180, 'B-000000')
    expect(within(card()).getByRole('heading', { name: 'Waiting for processing' })).toBeVisible()
    expect(within(card()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(card()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('an admin gets every form at the right state, warned it records as admin', async () => {
    const env = await staff('admin', { name: 'Peter Otieno' })
    const expected = [
      [4180, 'B-000000', 'Record processing'],
      [4181, 'B-000001', 'Record the lab result'],
      [4182, 'B-000002', 'Record packaging'],
      [4183, 'B-000003', 'Record sending to shops'],
    ] as const
    for (const [id, code, title] of expected) {
      const { unmount } = await open(env, id, code)
      expect(within(card()).getByRole('heading', { name: title })).toBeVisible()
      expect(within(card()).getByText(/You're recording this as an admin/)).toHaveTextContent(
        'The batch record will show "Recorded by Peter Otieno, as admin".',
      )
      unmount()
    }
    // A finished batch has no next step at all.
    await open(env, 4184, 'B-000004', false)
    expect(screen.queryByRole('region', { name: 'Next step' })).not.toBeInTheDocument()
  })

  it('an admin packaging: the jar count and the step marked as admin', async () => {
    const env = await staff('admin', { name: 'Peter Otieno' })
    await open(env, 4182, 'B-000002')
    const jars = screen.getByLabelText('Jars packed')
    await userEvent.clear(jars)
    await userEvent.type(jars, '120')
    await userEvent.type(screen.getByLabelText(/^Jar numbers/), 'J-001, J-002 J-003')
    await userEvent.click(screen.getByRole('button', { name: 'Save packaging' }))
    expect(await screen.findAllByText('Recorded by Peter Otieno, as admin')).not.toHaveLength(0)
    expect(env.server.stageWrites[0]).toEqual({
      route: 'package',
      batchId: 4182,
      body: { unit_count: 120, jar_ids: ['J-001', 'J-002', 'J-003'] },
    })
  })

  it('distribution needs the shop, and nothing else', async () => {
    const env = await staff('operator')
    await open(env, 4183, 'B-000003')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Name the shop or buyer.')).toBeInTheDocument()
    expect(env.server.requests).toEqual([])
    await userEvent.type(screen.getByLabelText('Shop or buyer'), 'Naivas Nyeri')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(env.server.stageWrites[0]?.body).toEqual({ retailer_name: 'Naivas Nyeri' }),
    )
  })
})

describe('The lab result', () => {
  it('stops swapped sugars at the two fields, then sends only what was filled in', async () => {
    const env = await staff('lab_officer')
    await open(env, 4181, 'B-000001')
    await userEvent.type(screen.getByLabelText('Moisture (%)'), '18,4')
    await userEvent.type(screen.getByLabelText('Fructose + glucose (g/100 g)'), '4.1')
    await userEvent.type(screen.getByLabelText('Sucrose (g/100 g)'), '71')
    await userEvent.click(screen.getByRole('button', { name: 'Save lab result' }))

    expect(
      await screen.findByText(
        'Sucrose is higher than fructose + glucose. These two may be swapped.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Sucrose (g/100 g)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Fructose + glucose (g/100 g)')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(env.server.requests).toEqual([])
    expect(await env.outbox.list(21)).toEqual([])

    await userEvent.clear(screen.getByLabelText('Fructose + glucose (g/100 g)'))
    await userEvent.clear(screen.getByLabelText('Sucrose (g/100 g)'))
    await userEvent.type(screen.getByLabelText('Fructose + glucose (g/100 g)'), '71')
    await userEvent.type(screen.getByLabelText('Sucrose (g/100 g)'), '4.1')
    await userEvent.type(screen.getByLabelText(/^Laboratory/), 'KEBS Testing Lab, Nairobi')
    await userEvent.click(screen.getByRole('button', { name: 'Save lab result' }))

    await eventually(() =>
      expect(env.server.stageWrites[0]?.body).toEqual({
        moisture_pct: '18.4',
        fructose_glucose_g_100g: '71',
        sucrose_g_100g: '4.1',
        laboratory_name: 'KEBS Testing Lab, Nairobi',
        tested_at: today(),
      }),
    )
  })

  it('refuses a value the server would refuse, before saving', async () => {
    const env = await staff('lab_officer')
    await open(env, 4181, 'B-000001')
    await userEvent.type(screen.getByLabelText('Moisture (%)'), '118')
    await userEvent.type(screen.getByLabelText('HMF (mg/kg)'), '22.125')
    await userEvent.click(screen.getByRole('button', { name: 'Save lab result' }))
    expect(await screen.findByText('Use a number from 0 to 100.')).toBeInTheDocument()
    expect(screen.getByText('Use a number with at most 2 decimals.')).toBeInTheDocument()
    expect(await env.outbox.list(21)).toEqual([])
  })

  it('never shows a verdict while it is filled in', async () => {
    const env = await staff('lab_officer')
    await open(env, 4181, 'B-000001')
    await userEvent.type(screen.getByLabelText('HMF (mg/kg)'), '95')
    expect(card().textContent).not.toMatch(/pass|fail|meets|within|exceeds|verdict/i)
  })

  it('can be completed with the keyboard alone', async () => {
    const env = await staff('lab_officer')
    await open(env, 4181, 'B-000001')
    const user = userEvent.setup()
    async function tabTo(name: RegExp) {
      for (let i = 0; i < 80; i++) {
        const el = document.activeElement as HTMLElement | null
        const label =
          el?.getAttribute('aria-label') ??
          (el?.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
          el?.textContent ??
          ''
        if (name.test(label)) return
        await user.tab()
      }
      throw new Error(`never reached ${name}`)
    }
    await tabTo(/^Moisture \(%\)$/)
    await user.keyboard('18.4')
    await tabTo(/^Save lab result$/)
    await user.keyboard('{Enter}')
    await eventually(() =>
      expect(env.server.stageWrites[0]?.body).toEqual({ moisture_pct: '18.4', tested_at: today() }),
    )
  })
})

describe('When the step was already taken (409 invalid_transition)', () => {
  it('says so, reloads the record, and offers only "Remove mine and reload"', async () => {
    const env = await staff('operator')
    await open(env, 4180, 'B-000000')
    // Someone else records processing after this page loaded.
    const row = env.server.batchDetails[0] as { state: string }
    row.state = 'PROCESSED'

    await userEvent.click(screen.getByRole('button', { name: 'Save processing' }))
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('This step was already recorded')).toBeInTheDocument()
    expect(within(alert).queryByRole('button', { name: /fix/i })).not.toBeInTheDocument()
    // The record reloaded on its own: the card now waits for the lab.
    expect(
      await within(card()).findByRole('heading', { name: 'Waiting for the lab' }),
    ).toBeVisible()

    await userEvent.click(within(alert).getByRole('button', { name: 'Remove mine and reload' }))
    await eventually(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(await env.outbox.list(21)).toEqual([])
  })
})

describe('Offline', () => {
  it('saves on this device, hides the form, counts it, and sends when back', async () => {
    const env = await staff('operator')
    await open(env, 4180, 'B-000000')
    env.server.offline = true
    await userEvent.click(screen.getByRole('button', { name: 'Save processing' }))

    expect(await within(card()).findByText('Saved on this device')).toBeVisible()
    expect(within(card()).queryByRole('button', { name: 'Save processing' })).toBeNull()
    expect(await screen.findAllByText('1 waiting to send')).not.toHaveLength(0)
    // The record stays on screen; nothing claims it was recorded yet.
    expect(screen.getByRole('heading', { name: 'B-000000' })).toBeVisible()

    env.server.offline = false
    await env.sync.kick({ force: true })
    expect(await screen.findByText('Recorded by Jane Mwende, operator')).toBeInTheDocument()
    expect(await screen.findAllByText('All sent')).not.toHaveLength(0)
  })
})

describe('Accessibility', () => {
  for (const theme of ['light', 'dark']) {
    it(`a record with the lab form open has no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      wide(true)
      const env = await staff('admin')
      const { container } = await open(env, 4181, 'B-000001')
      await screen.findByText('B-000004')
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })
  }
})
