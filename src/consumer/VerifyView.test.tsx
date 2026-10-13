// The jar label (12 §10, design board): place, seal, one quality line, the
// journey, and "How this was checked". Rendered from real /verify responses.
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'

import '../i18n/i18n'
import inProgress from './__fixtures__/in_progress.json'
import mismatch from './__fixtures__/mismatch.json'
import sealed from './__fixtures__/sealed.json'
import sealing from './__fixtures__/sealing.json'
import type { VerifyResponse } from './trustState'
import { VerifyView } from './VerifyView'

const FIXTURES = {
  sealed: [sealed, 'Checked and publicly sealed'],
  sealing: [sealing, 'Checked. Public seal on its way'],
  in_progress: [inProgress, 'Still on its journey'],
  mismatch: [mismatch, "This record doesn't match"],
} as const

const show = (v: unknown, cachedAt: string | null = null) =>
  render(<VerifyView verify={v as VerifyResponse} cachedAt={cachedAt} />)

describe('VerifyView', () => {
  it.each(Object.entries(FIXTURES))(
    '%s: leads with the place, then the seal',
    (_n, [v, headline]) => {
      show(v)
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Nyeri, Kenya')
      expect(screen.getByRole('heading', { name: headline })).toBeInTheDocument()
    },
  )

  it('names the honey and when it was harvested', () => {
    show(sealed)
    expect(screen.getByText(/^Acacia honey, harvested /)).toBeInTheDocument()
  })

  it('shows the quality line from the lab verdict', () => {
    show(sealed)
    expect(screen.getByText('Lab test meets the international honey standard.')).toBeInTheDocument()
  })

  it('says which step changed when a record does not match', () => {
    show(mismatch)
    const how = screen.getByText('How this was checked').closest('details') as HTMLElement
    const harvest = within(how).getByText('Harvest').closest('li') as HTMLElement
    expect(harvest).toHaveTextContent("Doesn't match")
    expect(screen.getByText(/keep it and its receipt/)).toBeInTheDocument()
  })

  it('keeps lab measurements and hashes out of the default view', () => {
    const { container } = show(sealed)
    const how = container.querySelector('details') as HTMLElement
    const outside = container.cloneNode(true) as HTMLElement
    outside.querySelector('details')?.remove()
    for (const p of (sealed as unknown as VerifyResponse).conformance?.parameters ?? []) {
      if (p.measured) expect(outside.textContent).not.toContain(p.measured)
    }
    expect(within(how).getByText('Moisture')).toBeInTheDocument()
    expect(outside.textContent).not.toMatch(/[0-9a-f]{32,}/)
  })

  it('never shows coordinates, scores or scary words in any state', () => {
    for (const [v] of Object.values(FIXTURES)) {
      const { container, unmount } = show(v)
      const text = container.textContent?.toLowerCase() ?? ''
      expect(text).not.toMatch(/flagged|suspicious|fake/)
      expect(text).not.toMatch(/-?\d+\.\d{2,}\s*,\s*-?\d+\.\d{2,}/) // no "lat, lon"
      unmount()
    }
  })

  it('dates a cached answer instead of passing it off as live', () => {
    show(sealing, '2026-10-12T09:00:00.000Z')
    expect(screen.getByText('Checked on 12 Oct. Connect to check again.')).toBeInTheDocument()
  })

  it('falls back to "Harvested in Kenya" when there is no place name', () => {
    show({ ...sealed, place: null })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Harvested in Kenya')
  })

  it.each(Object.keys(FIXTURES))(
    '%s has no axe violations',
    async (name) => {
      const { container } = show(FIXTURES[name as keyof typeof FIXTURES][0])
      const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
      expect(result.violations.map((x) => x.id)).toEqual([])
    },
    20_000,
  )
})
