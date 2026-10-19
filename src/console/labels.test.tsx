// Jar labels, the batch record sheet and anchor health (13 §10, D10, D12, D13).
import axe from 'axe-core'
import jsQR from 'jsqr'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 30_000 })
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { extractPublicId } from '../api/batchId'
import inProgress from '../consumer/__fixtures__/in_progress.json'
import mismatch from '../consumer/__fixtures__/mismatch.json'
import sealed from '../consumer/__fixtures__/sealed.json'
import sealing from '../consumer/__fixtures__/sealing.json'
import { renderConsole, staff, wide, type Env } from '../test/consoleHarness'
import { PRINT_ORIGINS } from './labels/printOrigins'
import { QUIET, qrMatrix, qrSvg } from './labels/qr'

type Json = Record<string, unknown>

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-theme')
  PRINT_ORIGINS.length = 0
})

// Batch 4183 (B-000003) is packed; its public id in the harness is p3.
function packed(env: Env, verify: Json = inProgress) {
  env.server.verifies = { ...env.server.verifies, p3: { ...verify, public_id: 'p3' } }
}

/** A matrix as a printed code: black modules, a white quiet zone, 4 px each. */
function pixels(m: boolean[][]) {
  const scale = 4
  const n = (m.length + QUIET * 2) * scale
  const data = new Uint8ClampedArray(n * n * 4).fill(255)
  m.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const i = (((y + QUIET) * scale + dy) * n + (x + QUIET) * scale + dx) * 4
          data[i] = data[i + 1] = data[i + 2] = 0
        }
    }),
  )
  return { data, n }
}

describe('The QR code (13 §10 item 1)', () => {
  it('decodes back to the jar link, and the link back to the same public id', () => {
    const id = '58e8e2216f64de5b62f74b900b65368d'
    const link = `https://apichain.example/v/${id}`
    const { data, n } = pixels(qrMatrix(link))
    const read = jsQR(data, n, n)
    expect(read?.data).toBe(link)
    expect(extractPublicId(read!.data)).toBe(id)
  })

  it('the SVG path that prints draws exactly those modules, inside the quiet zone', () => {
    const link = `https://apichain.example/v/${'a'.repeat(32)}`
    const m = qrMatrix(link)
    const { d, size } = qrSvg(link)
    expect(size).toBe(m.length + QUIET * 2)
    const drawn = m.map((row) => row.map(() => false))
    for (const [, x, y, w] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g))
      for (let i = 0; i < Number(w); i++) drawn[Number(y) - QUIET][Number(x) - QUIET + i] = true
    expect(drawn).toEqual(m)
    const { data, n } = pixels(drawn)
    expect(jsQR(data, n, n)?.data).toBe(link)
  })
})

describe('Jar labels and the print gate (D12)', () => {
  it('off the allowlist: every label is a sample, and the button says so', async () => {
    const env = await staff('operator')
    packed(env)
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderConsole(env, '/batches/4183/labels')
    await screen.findByRole('heading', { name: 'Jar labels' })
    expect(await screen.findByText('120 labels on 10 sheets')).toBeInTheDocument()
    expect(await screen.findAllByText('SAMPLE: not for jars')).toHaveLength(120)
    expect(screen.getAllByText('Scan to see where this honey came from')).toHaveLength(120)
    expect(screen.getAllByText('Acacia honey')).toHaveLength(120)
    expect(screen.getAllByText('B-000003')).not.toHaveLength(0)
    expect(screen.getAllByText('Packed 14 Oct 2026')).toHaveLength(120)
    expect(screen.getByText(/Printing real jar labels is switched off/)).toBeInTheDocument()
    expect(screen.getByText('Sample only')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Print sample sheet (not for jars)' }))
    expect(print).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Print labels' })).not.toBeInTheDocument()
  })

  it('on a listed origin: no mark, no notice, and "Print labels"', async () => {
    PRINT_ORIGINS.push(window.location.origin)
    const env = await staff('operator')
    packed(env)
    renderConsole(env, '/batches/4183/labels')
    expect(await screen.findByRole('button', { name: 'Print labels' })).toBeInTheDocument()
    await screen.findAllByText('Scan to see where this honey came from')
    expect(screen.queryByText('SAMPLE: not for jars')).not.toBeInTheDocument()
    expect(screen.queryByText(/Printing real jar labels is switched off/)).not.toBeInTheDocument()
  })

  it('every label carries the one code for this batch: its /v/ link', async () => {
    const env = await staff('operator')
    packed(env)
    const { container } = renderConsole(env, '/batches/4183/labels')
    await screen.findAllByText('SAMPLE: not for jars')
    const code = await vi.waitFor(() => {
      const el = container.querySelector('[data-qr-text]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(code.getAttribute('data-qr-text')).toBe(`${window.location.origin}/v/p3`)
    expect(container.querySelectorAll('[data-qr-text]')).toHaveLength(1) // drawn once, used per label
  })

  it('a batch not yet packed has no labels, but always has a record sheet', async () => {
    const env = await staff('operator')
    renderConsole(env, '/batches/4181')
    await screen.findByRole('heading', { name: 'B-000001' })
    expect(screen.getByRole('link', { name: 'Print record' })).toHaveAttribute(
      'href',
      '/batches/4181/record',
    )
    expect(screen.queryByRole('link', { name: 'Jar labels' })).not.toBeInTheDocument()
  })

  it('a packed batch links to its labels', async () => {
    const env = await staff('operator')
    renderConsole(env, '/batches/4183')
    await screen.findByRole('heading', { name: 'B-000003' })
    expect(screen.getByRole('link', { name: 'Jar labels' })).toHaveAttribute(
      'href',
      '/batches/4183/labels',
    )
  })
})

describe('The batch record sheet (D13)', () => {
  const FORBIDDEN = ['verified', 'authentic', 'fake', 'flagged']

  async function sheet(verify: Json, verdict?: 'pass' | 'fail' | 'incomplete') {
    const env = await staff('operator')
    const conformance =
      verdict && verify.conformance
        ? { ...(verify.conformance as Json), verdict }
        : verify.conformance
    packed(env, { ...verify, conformance })
    const utils = renderConsole(env, '/batches/4183/record')
    await screen.findByText(/^As of /)
    return { env, ...utils }
  }

  it('states the trust state as of the printed time, and who printed it', async () => {
    await sheet(inProgress)
    expect(
      screen.getByText(/^As of \d{1,2} \w+ \d{4}, \d{2}:\d{2} \(East Africa Time\)$/),
    ).toBeInTheDocument()
    expect(screen.getByText('Still on its journey')).toBeInTheDocument()
    expect(
      screen.getByText(
        'This sheet shows the record at the moment it was printed. Scan the code for its state now.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/^Printed by Jane Mwende from the ApiChain console\./),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Acacia honey from Nyeri, Kenya' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/120 jars/)).toBeInTheDocument()
  })

  it('names who recorded each step, with the declared day where there is one', async () => {
    await sheet(inProgress)
    const rows = screen.getAllByRole('row').map((r) => r.textContent)
    expect(rows).toContain('Harvested15 Mar 2026Wanjiru Kamau, farmer, on 14 Oct')
    expect(rows).toContain('Lab tested2 Apr 2026Achieng Odhiambo, lab officer, on 14 Oct')
    expect(rows).toContain('Packed14 Oct 2026Peter Otieno, as admin')
    expect(rows).toContain('Sent to shopsNot yet')
  })

  for (const [name, verify] of [
    ['in progress', inProgress],
    ['being sealed', sealing],
    ['sealed', sealed],
    ['mismatch', mismatch],
  ] as const) {
    for (const verdict of ['pass', 'fail', 'incomplete'] as const) {
      it(`never says verified, authentic, fake or flagged, nor a raw score (${name}, ${verdict})`, async () => {
        const { container } = await sheet(verify as Json, verdict)
        const text = (container.textContent ?? '').toLowerCase()
        for (const word of FORBIDDEN) expect(text).not.toContain(word)
        const params =
          ((verify as Json).conformance as { parameters?: { measured: string }[] } | null)
            ?.parameters ?? []
        for (const p of params) expect(text).not.toContain(p.measured)
      })
    }
  }

  it('words a failed lab result as being reviewed', async () => {
    await sheet(inProgress, 'fail')
    expect(screen.getByText(/Lab results are being reviewed\./)).toBeInTheDocument()
  })

  it('a mismatch says so plainly', async () => {
    await sheet(mismatch)
    expect(screen.getByText("This record doesn't match")).toBeInTheDocument()
  })
})

describe('Anchor health (13 §10 item 4)', () => {
  it("sits at the foot of an admin's rail, in words", async () => {
    wide(true)
    const env = await staff('admin')
    env.server.auditHealth = {
      chain_ok: true,
      checked_at: new Date(Date.now() - 4 * 60_000).toISOString(),
      rows_checked: 40,
    }
    env.server.anchorHealth = { anchor_ok: true, pending_rows: 3, pending_anchors: 1 }
    renderConsole(env, '/batches')
    // The rail is CSS-hidden at jsdom's width, as on a phone: hence `hidden`.
    const card = await screen.findByRole('region', { name: 'Record health', hidden: true })
    expect(
      await within(card).findByText('Chain checked 4 min ago. Nothing has changed.'),
    ).toBeInTheDocument()
    expect(within(card).getByText('3 records waiting to be sealed.')).toBeInTheDocument()
  })

  it('says a failed check and a stopped sealer in words, not only colour', async () => {
    wide(true)
    const env = await staff('admin')
    env.server.auditHealth = {
      chain_ok: false,
      checked_at: new Date().toISOString(),
      rows_checked: 40,
    }
    env.server.anchorHealth = {
      anchor_ok: false,
      pending_rows: 12,
      pending_anchors: 0,
      last_error: 'x',
    }
    renderConsole(env, '/batches')
    // The rail is CSS-hidden at jsdom's width, as on a phone: hence `hidden`.
    const card = await screen.findByRole('region', { name: 'Record health', hidden: true })
    expect(await within(card).findByText(/^Chain check found a change\./)).toBeInTheDocument()
    expect(
      within(card).getByText('Sealing has stopped: the last attempt failed.'),
    ).toBeInTheDocument()
  })

  it("is on an admin's Me page too, where a phone or the narrow rail finds it", async () => {
    const env = await staff('admin')
    env.server.anchorHealth = { anchor_ok: true, pending_rows: 0, pending_anchors: 0 }
    renderConsole(env, '/me')
    const card = await screen.findByRole('region', { name: 'Record health' })
    expect(await within(card).findByText('No records waiting to be sealed.')).toBeInTheDocument()
    expect(within(card).getByText("The chain hasn't been checked yet.")).toBeInTheDocument()
  })

  it('an operator has no card and never asks', async () => {
    wide(true)
    const env = await staff('operator')
    renderConsole(env, '/batches')
    await screen.findByRole('heading', { name: 'Batches', level: 1 })
    expect(
      screen.queryByRole('region', { name: 'Record health', hidden: true }),
    ).not.toBeInTheDocument()
    expect(env.server.reads.some((p) => p.startsWith('/v2/audit'))).toBe(false)
  })
})

describe('Accessibility', () => {
  for (const theme of ['light', 'dark']) {
    it(`the label sheet and the record sheet have no axe violations (${theme})`, async () => {
      document.documentElement.setAttribute('data-theme', theme)
      wide(true)
      const env = await staff('admin')
      packed(env)
      const { container, unmount } = renderConsole(env, '/batches/4183/labels')
      await screen.findAllByText('SAMPLE: not for jars')
      let result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
      unmount()
      const next = renderConsole(env, '/batches/4183/record')
      await screen.findByText(/^As of /)
      result = await axe.run(next.container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((v) => v.id)).toEqual([])
    })
  }
})
