// Declared days on the journey (13 §11 item 4, §0 #10). Harvest and lab show
// the day the person declared; every other step the day it was recorded.
// The backend sends a declared day as naive UTC midnight
// ("2026-03-15T00:00:00"), so the day is the string's first ten characters,
// never a Date round-trip: read as local time, that midnight is the day
// before anywhere a formatter in another zone touches it.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import '../i18n/i18n'
import { Journey } from '../ui/Journey'
import inProgress from './__fixtures__/in_progress.json'
import sealed from './__fixtures__/sealed.json'
import { journeySteps, type VerifyResponse } from './trustState'
import { VerifyView } from './VerifyView'

type Json = Record<string, unknown>

/** A /verify answer whose harvest and lab carry the backend's real shape. */
function withDeclared(base: unknown, harvest: string, tested: string | null): VerifyResponse {
  const v = structuredClone(base) as VerifyResponse
  const blocks = v.verification as unknown as Record<string, { payload: Json } | null>
  blocks.harvest!.payload = { ...blocks.harvest!.payload, harvest_date: harvest }
  blocks.lab!.payload = { ...blocks.lab!.payload, tested_at: tested }
  return v
}

describe.each([
  ['America/Bogota', 300],
  ['Africa/Nairobi', -180],
])('under TZ=%s', (zone, offset) => {
  // Sets process.env.TZ, which Node applies to every later Date call.
  beforeAll(() => {
    vi.stubEnv('TZ', zone)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('the zone really applies in this process', () => {
    expect(new Date(2026, 2, 15).getTimezoneOffset()).toBe(offset)
  })

  it('harvest and lab show the declared day; the rest the recorded day', () => {
    const v = withDeclared(inProgress, '2026-03-15T00:00:00', '2026-04-02T00:00:00')
    const steps = journeySteps(v)
    expect(steps.map((s) => [s.key, s.date, s.word])).toEqual([
      ['CREATED', '2026-10-13', 'recorded'],
      ['HARVESTED', '2026-03-15', 'harvested'],
      ['PROCESSED', '2026-10-13', 'recorded'],
      ['LAB_VERIFIED', '2026-04-02', 'tested'],
      ['PACKAGED', '2026-10-13', 'recorded'],
      ['DISTRIBUTED', null, 'recorded'],
    ])
    render(<Journey steps={steps} />)
    expect(screen.getByText('Harvested 15 Mar')).toBeInTheDocument()
    expect(screen.getByText('Tested 2 Apr')).toBeInTheDocument()
    expect(screen.getAllByText('Recorded 13 Oct')).toHaveLength(3)
    expect(screen.getByText('Not yet')).toBeInTheDocument()
  })

  it('a lab result with no test day says when it was recorded', () => {
    const steps = journeySteps(withDeclared(sealed, '2026-03-15T00:00:00', null))
    expect(steps[3]).toEqual({ key: 'LAB_VERIFIED', date: '2026-10-13', word: 'recorded' })
  })
})

describe('the jar page', () => {
  it('words every journey day as declared or recorded, and nothing else', () => {
    const v = withDeclared(sealed, '2026-03-15T00:00:00', '2026-04-02T00:00:00')
    const { container } = render(<VerifyView verify={v} cachedAt={null} />)
    const when = [...container.querySelectorAll('ol li')].map(
      (li) => li.lastElementChild?.textContent ?? '',
    )
    expect(when).toHaveLength(6)
    for (const w of when) expect(w).toMatch(/^(Recorded|Harvested|Tested) \d{1,2} [A-Z][a-z]{2,3}$/)
    // The consumer-safety lock (4a) still holds with the new words.
    const text = container.textContent?.toLowerCase() ?? ''
    expect(text).not.toMatch(/flagged|suspicious|fake/)
    expect(text).not.toMatch(/-?\d+\.\d{2,}\s*,\s*-?\d+\.\d{2,}/)
  })
})
