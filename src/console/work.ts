import type { components } from '../api/client/schema'
import type { Me } from '../auth/SessionContext'

export type BatchSummary = components['schemas']['BatchSummary']
export type BatchPage = components['schemas']['BatchPage']
export type BatchDetail = components['schemas']['BatchDetail']
export type BatchStage = components['schemas']['BatchStageOut']

export const STATES = [
  'CREATED',
  'HARVESTED',
  'PROCESSED',
  'LAB_VERIFIED',
  'PACKAGED',
  'DISTRIBUTED',
] as const
export type StateKey = (typeof STATES)[number]

// "To do" per role (13 §4.2): the states a batch waits in for this person's
// next step. A work-queue filter, not a permission table (D10): the server's
// `next_action` and `requires(action)` decide what anyone may record. A field
// officer has no stage step and an admin may take any, so both open on "All".
const TODO: Partial<Record<Me['role'], StateKey[]>> = {
  operator: ['HARVESTED', 'LAB_VERIFIED', 'PACKAGED'],
  lab_officer: ['PROCESSED'],
}

export function todoStates(role: Me['role']): StateKey[] | null {
  return TODO[role] ?? null
}

// The step a batch in this state waits for, in words, for a "To do" row.
export const WAITING_FOR: Partial<Record<StateKey, string>> = {
  HARVESTED: 'process',
  PROCESSED: 'labTest',
  LAB_VERIFIED: 'package',
  PACKAGED: 'distribute',
}

// Each audit action belongs to one step of the journey. The three S0 rows
// (created, apiary, metadata) are one step: "Registered" (13 §4.3).
export const STEP_OF: Record<string, StateKey> = {
  'batch.created': 'CREATED',
  'batch.apiary_recorded': 'CREATED',
  'batch.metadata_recorded': 'CREATED',
  'batch.harvest_recorded': 'HARVESTED',
  'batch.process_recorded': 'PROCESSED',
  'batch.lab_verified': 'LAB_VERIFIED',
  'batch.packaged': 'PACKAGED',
  'batch.distributed': 'DISTRIBUTED',
}

export type TimelineStep = {
  key: StateKey
  /** The first record of this step: who recorded it, and when. */
  stage: BatchStage | null
  /** Every record in this step, for the integrity view. */
  records: BatchStage[]
}

export function timeline(stages: BatchStage[]): TimelineStep[] {
  return STATES.map((key) => {
    const records = stages
      .filter((s) => STEP_OF[s.action] === key)
      .sort((a, b) => a.audit_id - b.audit_id)
    return { key, stage: records[0] ?? null, records }
  })
}

/** The server sends naive UTC; read it as UTC whatever the device's zone. */
export function serverDate(ts: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts}Z`)
}

const dayMonth = new Intl.DateTimeFormat('en-KE', { day: 'numeric', month: 'short' })

/** "14 Oct", in the device's own calendar day. */
export function shortDay(ts: string): string {
  return dayMonth.format(serverDate(ts))
}
