// The consumer trust state (12 D8), redesigned from v1's two-state
// `isThreeWayVerified` (Apichain-Frontend api/verifyService.js) for the
// Merkle-proof model. Four states, and green only when it is true:
//
//   mismatch     any recorded stage no longer matches what was saved
//   in_progress  the jar has not been marked as sent to shops yet
//   sealed       delivered, every check matches, Bitcoin has attested it
//   sealing      delivered and matching; the public seal is on its way
//
// `anchored` (an OpenTimestamps calendar holds it, Bitcoin has not attested
// it yet) is deliberately not green: that is the window 03 P6 warns about.

import type { components } from '../api/client/schema'
import type { TrustState } from '../ui/TrustSeal'
import { dayOf } from '../ui/day'
import type { JourneyStep, StepKey } from '../ui/Journey'

export type VerifyResponse = components['schemas']['BatchVerifyResponse']
type Blocks = VerifyResponse['verification']

const ORDER: StepKey[] = [
  'CREATED',
  'HARVESTED',
  'PROCESSED',
  'LAB_VERIFIED',
  'PACKAGED',
  'DISTRIBUTED',
]

// Which verification block dates each step of the journey.
const STEP_BLOCK: Record<StepKey, keyof Blocks> = {
  CREATED: 'metadata',
  HARVESTED: 'harvest',
  PROCESSED: 'process',
  LAB_VERIFIED: 'lab',
  PACKAGED: 'packaging',
  DISTRIBUTED: 'distribution',
}

export function trustState(v: VerifyResponse): TrustState {
  const blocks = Object.values(v.verification)
  if (blocks.some((b) => b !== null && b !== undefined && b.match === false)) return 'mismatch'
  if (v.state !== 'DISTRIBUTED') return 'in_progress'
  return v.anchor_status === 'confirmed' ? 'sealed' : 'sealing'
}

export function stepsDone(v: VerifyResponse): number {
  const i = ORDER.indexOf(v.state as StepKey)
  return i < 0 ? 0 : i + 1
}

// The two steps with a day the person declared (13 §0 #10), both public
// fields of the stage payload. The other steps have none, so they show the
// day they were recorded, worded as such.
const DECLARED: Partial<Record<StepKey, { field: string; word: JourneyStep['word'] }>> = {
  HARVESTED: { field: 'harvest_date', word: 'harvested' },
  LAB_VERIFIED: { field: 'tested_at', word: 'tested' },
}

export function journeySteps(v: VerifyResponse): JourneyStep[] {
  const done = stepsDone(v)
  return ORDER.map((key, i) => {
    const block = v.verification[STEP_BLOCK[key]]
    if (i >= done || !block) return { key, date: null, word: 'recorded' }
    const d = DECLARED[key]
    const declared = d ? dayOf(block.payload?.[d.field]) : null
    if (d && declared) return { key, date: declared, word: d.word }
    return { key, date: dayOf(block.recorded_on), word: 'recorded' }
  })
}
