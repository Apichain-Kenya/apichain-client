// Ported from v1 Apichain-Frontend/apichain-website/src/api/authenticity.test.js.
// The consumer-safety contract is unchanged: never surface a raw score or the
// words "flagged"/"suspicious" to a consumer. What changed (12 D9): the input
// is the rule-based Codex verdict (`conformance.verdict`), because v2 has no
// ML authenticity band.
import { describe, it, expect } from 'vitest'
import { interpretAuthenticity } from './authenticity'

describe('interpretAuthenticity', () => {
  it('maps a pass to the positive consumer key', () => {
    expect(interpretAuthenticity({ verdict: 'pass' }).key).toBe('consistent')
    expect(interpretAuthenticity({ verdict: 'pass' }).tone).toBe('positive')
  })
  it('maps a fail to "being reviewed", never to a failure word', () => {
    const r = interpretAuthenticity({ verdict: 'fail' })
    expect(r.key).toBe('under_review')
    expect(r.tone).toBe('neutral')
  })
  it('incomplete or absent is unknown (no scary words)', () => {
    expect(interpretAuthenticity({ verdict: 'incomplete' }).key).toBe('unknown')
    expect(interpretAuthenticity(null).key).toBe('unknown')
    expect(interpretAuthenticity(undefined).key).toBe('unknown')
  })
  it("never exposes the raw word 'flagged' or 'suspicious', or a score", () => {
    const r = interpretAuthenticity({ verdict: 'fail', status: 'flagged', score: 0.31 })
    const blob = JSON.stringify(r).toLowerCase()
    expect(blob).not.toMatch(/flagged|suspicious|0\.31/)
  })
})
