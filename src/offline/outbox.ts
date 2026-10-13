// The offline outbox (12 §8, D6; 03 §3.2, §11).
//
// Capture writes here first, instantly, with no network. Replay sends each
// action to the server later, in the order it was captured.
//
// - One record per user action, with an Idempotency-Key minted when the user
//   committed the action, never per HTTP attempt. Every retry sends that key.
// - Dependent actions chain by local reference: a harvest names its batch as
//   `{ $ref: <batch's local_ref> }` until the server has assigned an id.
//   Before an action is first sent, its references are resolved and the
//   resolved body is written back, so every retry sends byte-identical JSON
//   under the same key and can never trip the server's fingerprint check.
// - Scoped to the user who captured it. Another person signing in on the
//   same phone neither sees nor sends it; replaying it under their session is
//   refused, because the audit log would then name the wrong person (03 §13.1).
// - Nothing is ever discarded automatically. A refused action waits for the
//   farmer to fix or remove it; a signed-out queue waits for them to sign in.
// - The client never hash-chains or assigns audit positions: the server does.

import { openDB, type IDBPDatabase } from 'idb'

import { browserLocks, OfflineError, type Session } from '../auth/session'

type Json = Record<string, unknown>
export type Ref = { $ref: string }
export type Kind = 'apiary.create' | 'batch.create' | 'batch.harvest'
export type Status = 'queued' | 'sent' | 'needs_attention'

export type Draft = { kind: Kind; local_ref: string; body: Json }

export type ActionRecord = Draft & {
  id: string
  user_id: number
  seq: number
  depends_on: string[]
  idempotency_key: string
  status: Status
  attempts: number
  // In-progress idempotency conflicts only, counted apart from network
  // failures, so a flaky link never uses up the conflict retries (review).
  conflicts?: number
  next_attempt_at: number
  created_at: number
  resolved: boolean
  server_result: Json | null
  last_error: { status: number; code?: string; message?: string } | null
}

export type ReplayResult = { sent: number; paused: null | 'offline' | 'signed_out' }

// How each kind becomes a request, and which field of the reply is the id a
// dependant refers to.
const KINDS: Record<Kind, { request: (body: Json) => { path: string; json: Json } }> = {
  'apiary.create': { request: (body) => ({ path: '/v2/apiaries', json: body }) },
  'batch.create': { request: (body) => ({ path: '/v2/batches', json: body }) },
  'batch.harvest': {
    request: ({ batch_id, ...rest }) => ({ path: `/v2/batches/${batch_id}/harvest`, json: rest }),
  },
}

const MAX_CONFLICT_RETRIES = 5
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 5 * 60_000
// Capture order: strictly increasing within this page's life, and roughly
// time-ordered across reloads. (The old `now*100 + counter%100` wrapped inside
// a single save, ordering a harvest before the batch it depends on.)
let lastSeq = 0
function nextSeq(now: number): number {
  lastSeq = Math.max(lastSeq + 1, now * 1000)
  return lastSeq
}

const uuid = () => globalThis.crypto.randomUUID()
const isRef = (v: unknown): v is Ref =>
  typeof v === 'object' && v !== null && '$ref' in v && typeof (v as Ref).$ref === 'string'

function refsIn(body: Json): string[] {
  return Object.values(body)
    .filter(isRef)
    .map((r) => r.$ref)
}

/** The drafts for one "Register a harvest": a new apiary only if needed. */
export function harvestDrafts(input: {
  farmerId: number
  apiaryId?: number
  apiary?: Json
  metadata: Json
  harvest: Json
}): Draft[] {
  const drafts: Draft[] = []
  let apiaryRef: number | Ref
  if (input.apiaryId !== undefined) {
    apiaryRef = input.apiaryId
  } else {
    const local = `apiary-${uuid()}`
    drafts.push({
      kind: 'apiary.create',
      local_ref: local,
      body: { farmer_id: input.farmerId, ...input.apiary },
    })
    apiaryRef = { $ref: local }
  }
  const batch = `batch-${uuid()}`
  drafts.push({
    kind: 'batch.create',
    local_ref: batch,
    body: { farmer_id: input.farmerId, apiary_id: apiaryRef, metadata: input.metadata },
  })
  drafts.push({
    kind: 'batch.harvest',
    local_ref: `harvest-${uuid()}`,
    body: { batch_id: { $ref: batch }, ...input.harvest },
  })
  return drafts
}

type Locks = { request<T>(name: string, fn: () => Promise<T>): Promise<T> }

export class Outbox {
  private db: Promise<IDBPDatabase>
  private listeners = new Set<() => void>()

  private readonly locks: Locks

  // Web Locks where the browser has them; Session's per-tab fallback where it
  // does not (old WebViews), rather than a silent TypeError (review).
  constructor(name = 'apichain-outbox', locks: Locks = browserLocks()) {
    this.locks = locks
    this.db = openDB(name, 1, {
      upgrade(db) {
        const store = db.createObjectStore('actions', { keyPath: 'id' })
        store.createIndex('by_user', ['user_id', 'seq'])
      },
    })
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Commit a user action locally, in one transaction. Works offline. */
  async enqueue(userId: number, drafts: Draft[], now: number): Promise<ActionRecord[]> {
    const rows: ActionRecord[] = drafts.map((d) => ({
      ...d,
      id: uuid(),
      user_id: userId,
      seq: nextSeq(now),
      depends_on: refsIn(d.body),
      idempotency_key: uuid(),
      status: 'queued',
      attempts: 0,
      next_attempt_at: now,
      created_at: now,
      resolved: refsIn(d.body).length === 0,
      server_result: null,
      last_error: null,
    }))
    const tx = (await this.db).transaction('actions', 'readwrite')
    await Promise.all([...rows.map((r) => tx.store.put(r)), tx.done])
    this.emit()
    return rows
  }

  async list(userId: number): Promise<ActionRecord[]> {
    const db = await this.db
    const range = IDBKeyRange.bound([userId, -Infinity], [userId, Infinity])
    return (await db.getAllFromIndex('actions', 'by_user', range)) as ActionRecord[]
  }

  async waiting(userId: number): Promise<number> {
    return (await this.list(userId)).filter((r) => r.status !== 'sent').length
  }

  /** What the sync chip counts: harvests, not the actions inside them. */
  async waitingHarvests(userId: number): Promise<number> {
    return (await this.list(userId)).filter(
      (r) => r.kind === 'batch.harvest' && r.status !== 'sent',
    ).length
  }

  /** "Fix and send": the corrected action is a new action with a new key. */
  async fixAndResend(id: string, body: Json, now: number): Promise<ActionRecord> {
    const db = await this.db
    const old = (await db.get('actions', id)) as ActionRecord | undefined
    if (!old) throw new Error(`no outbox action ${id}`)
    const fixed: ActionRecord = {
      ...old,
      id: uuid(),
      body,
      idempotency_key: uuid(),
      status: 'queued',
      attempts: 0,
      next_attempt_at: now,
      resolved: refsIn(body).length === 0,
      last_error: null,
      server_result: null,
    }
    const tx = db.transaction('actions', 'readwrite')
    await Promise.all([tx.store.delete(id), tx.store.put(fixed), tx.done])
    this.emit()
    return fixed
  }

  /** "Remove": only ever by the farmer's own choice. */
  async remove(id: string): Promise<void> {
    await (await this.db).delete('actions', id)
    this.emit()
  }

  /**
   * Send everything ready for `userId`, in capture order, through `session`.
   * One replayer per user across tabs (Web Lock). Stops at the first sign of
   * no network or no session; returns what it did.
   */
  async replay(
    userId: number,
    session: Session,
    now: () => number,
    opts: { ignoreBackoff?: boolean } = {},
  ): Promise<ReplayResult> {
    if (session.userId !== userId) {
      throw new Error('this outbox queue belongs to another user; sign in as them to send it')
    }
    return this.locks.request(`apichain-outbox-${userId}`, async () => {
      const rows = (await this.list(userId)).sort((a, b) => a.seq - b.seq)
      const byRef = new Map(rows.map((r) => [r.local_ref, r]))
      let sent = 0
      for (const row of rows) {
        if (row.status !== 'queued') continue
        // A real change (back online, app opened, signed in) retries at once;
        // backoff only spaces out retries while nothing has changed.
        if (!opts.ignoreBackoff && row.next_attempt_at > now()) continue
        if (row.depends_on.some((ref) => byRef.get(ref)?.status !== 'sent')) continue

        if (!row.resolved) {
          row.body = resolve(row.body, byRef)
          row.resolved = true
          await this.put(row) // before the first send: retries are identical
        }
        const { path, json } = KINDS[row.kind].request(row.body)
        // Re-checked before every send: a refresh mid-replay can renew the
        // session as someone else, and this queue is only ever theirs (D6).
        if (session.userId !== userId) return { sent, paused: 'signed_out' }
        let res: Response
        try {
          res = await session.authFetch(
            path,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': row.idempotency_key,
              },
              body: JSON.stringify(json),
            },
            { asUser: userId },
          )
        } catch (e) {
          if (!(e instanceof OfflineError)) throw e
          await this.backoff(row, now())
          return { sent, paused: 'offline' }
        }

        if (res.ok) {
          row.status = 'sent'
          row.server_result = (await res.json()) as Json
          row.last_error = null
          await this.put(row)
          sent++
          continue
        }
        if (res.status === 401) return { sent, paused: 'signed_out' }

        const err = (await res.json().catch(() => ({}))) as { code?: string; message?: string }
        const conflict = res.status === 409 && err.code === 'idempotency_conflict'
        if (res.status >= 500 || res.status === 429) {
          await this.backoff(row, now())
          return { sent, paused: 'offline' }
        }
        if (conflict && (row.conflicts ?? 0) + 1 < MAX_CONFLICT_RETRIES) {
          // Most likely the previous attempt is still running server-side.
          row.conflicts = (row.conflicts ?? 0) + 1
          await this.backoff(row, now())
          continue
        }
        row.status = 'needs_attention'
        row.last_error = { status: res.status, code: err.code, message: err.message }
        await this.put(row)
      }
      return { sent, paused: null }
    })
  }

  private async backoff(row: ActionRecord, now: number) {
    row.attempts++
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (row.attempts - 1))
    row.next_attempt_at = now + Math.round(base * (1 + Math.random() * 0.2))
    await this.put(row)
  }

  private async put(row: ActionRecord) {
    await (await this.db).put('actions', row)
    this.emit()
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }
}

function resolve(body: Json, byRef: Map<string, ActionRecord>): Json {
  const out: Json = {}
  for (const [k, v] of Object.entries(body)) {
    if (isRef(v)) {
      const id = byRef.get(v.$ref)?.server_result?.id
      if (typeof id !== 'number') throw new Error(`unresolved reference ${v.$ref}`)
      out[k] = id
    } else {
      out[k] = v
    }
  }
  return out
}
