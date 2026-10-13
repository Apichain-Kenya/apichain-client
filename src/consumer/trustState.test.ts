// The four consumer trust states (12 D8), driven by real /verify responses
// captured from the backend (src/consumer/__fixtures__, written by
// apichain-backend tests/test_phase4a_reads.py).
import { describe, expect, it } from 'vitest'

import inProgress from './__fixtures__/in_progress.json'
import mismatch from './__fixtures__/mismatch.json'
import sealed from './__fixtures__/sealed.json'
import sealing from './__fixtures__/sealing.json'
import { journeySteps, stepsDone, trustState, type VerifyResponse } from './trustState'

const v = (x: unknown) => x as VerifyResponse

describe('trustState over real responses', () => {
  it('sealed: delivered, every check matches, and Bitcoin has attested it', () => {
    expect(trustState(v(sealed))).toBe('sealed')
  })
  it('sealing: delivered and matching, public seal still on its way', () => {
    expect(trustState(v(sealing))).toBe('sealing')
  })
  it('in progress: not yet delivered', () => {
    expect(trustState(v(inProgress))).toBe('in_progress')
  })
  it("doesn't match: a changed record, whatever the anchor says", () => {
    expect(trustState(v(mismatch))).toBe('mismatch')
  })
})

describe('trustState edge cases', () => {
  const base = v(sealed)
  it.each(['pending', 'partial', 'anchored'])('%s is never green', (anchor_status) => {
    expect(trustState({ ...base, anchor_status } as VerifyResponse)).toBe('sealing')
  })
  it('a mismatch before delivery is still a mismatch', () => {
    const r = v(mismatch)
    expect(trustState({ ...r, state: 'PROCESSED' } as VerifyResponse)).toBe('mismatch')
  })
  it('a stage not reached yet (null block) is not a mismatch', () => {
    expect(trustState(v(inProgress))).toBe('in_progress')
    expect(v(inProgress).verification.distribution).toBeNull()
  })
})

describe('the journey', () => {
  it('dates every reached step from its record and marks the rest not yet', () => {
    const steps = journeySteps(v(inProgress))
    expect(steps.map((s) => s.key)).toEqual([
      'CREATED',
      'HARVESTED',
      'PROCESSED',
      'LAB_VERIFIED',
      'PACKAGED',
      'DISTRIBUTED',
    ])
    expect(steps.slice(0, 5).every((s) => s.date !== null)).toBe(true)
    expect(steps[5].date).toBeNull()
    expect(stepsDone(v(inProgress))).toBe(5)
    expect(stepsDone(v(sealed))).toBe(6)
  })
})
