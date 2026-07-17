// Ported from v1 Apichain-Frontend/apichain-website/src/api/authenticity.test.js.
// The consumer-safety contract is unchanged: never surface a raw score or the
// words "flagged"/"suspicious" to a consumer.
import { describe, it, expect } from 'vitest'
import { interpretAuthenticity } from './authenticity'

describe('interpretAuthenticity', () => {
  it('maps consistent band to the positive consumer key', () => {
    expect(interpretAuthenticity({ authenticity_band: 'consistent' }).key).toBe('consistent')
    expect(interpretAuthenticity({ authenticity_band: 'consistent' }).tone).toBe('positive')
  })
  it('maps under_review band to neutral', () => {
    expect(interpretAuthenticity({ authenticity_band: 'under_review' }).key).toBe('under_review')
  })
  it('absent authenticity returns unknown (no scary words)', () => {
    expect(interpretAuthenticity({}).key).toBe('unknown')
    expect(interpretAuthenticity(null).key).toBe('unknown')
    expect(interpretAuthenticity(undefined).key).toBe('unknown')
  })
  it("never exposes the raw word 'flagged' or 'suspicious'", () => {
    const r = interpretAuthenticity({ authenticity_band: 'under_review', status: 'flagged' })
    const blob = JSON.stringify(r).toLowerCase()
    expect(blob).not.toMatch(/flagged|suspicious/)
  })
})
