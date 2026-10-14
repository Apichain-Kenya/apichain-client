// When the outbox replays (12 §8): on start, on the `online` event, when the
// app comes back to the foreground, after a sign-in, and on a slow tick while
// anything is waiting (so a backoff that expires while the app sits open is
// honoured). Background Sync is deliberately not used in 4a: a service worker
// woken by `sync` has no signed-in user in memory, and replaying from there
// could send one person's work under another's cookie (12 D6).
//
// Nothing replays while `/me.must_change_password` is true (13 §7 step 3):
// every write would be refused until the change, and a refusal must not turn
// a farmer's saved harvests into "needs your attention". The change adopts a
// fresh session, whose sign-in event starts the replay.

import type { Session } from '../auth/session'
import type { Outbox, ReplayResult } from './outbox'

const TICK_MS = 30_000

export type SyncState = { running: boolean; paused: ReplayResult['paused']; lastSent: number }

export class SyncRunner {
  state: SyncState = { running: false, paused: null, lastSent: 0 }
  private timer: ReturnType<typeof setInterval> | null = null
  private unsubs: (() => void)[] = []
  private listeners = new Set<(s: SyncState) => void>()
  private queued = false
  private queuedForce = false

  private readonly outbox: Outbox
  private readonly session: Session
  private readonly now: () => number

  constructor(outbox: Outbox, session: Session, now: () => number = Date.now) {
    this.outbox = outbox
    this.session = session
    this.now = now
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  start() {
    // These three are real changes, so they skip any backoff; the tick does not.
    const kick = () => void this.kick({ force: true })
    const onVisible = () => document.visibilityState === 'visible' && kick()
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', onVisible)
    this.unsubs.push(
      () => window.removeEventListener('online', kick),
      () => document.removeEventListener('visibilitychange', onVisible),
      this.session.subscribe((s) => s.status === 'signed_in' && kick()),
      this.outbox.subscribe(() => this.armTick()),
    )
    kick()
  }

  stop() {
    for (const u of this.unsubs.splice(0)) u()
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Replay now for whoever is signed in. Coalesces overlapping triggers. */
  async kick(opts: { force?: boolean } = {}): Promise<void> {
    const userId = this.session.userId
    if (userId === null) return
    if (this.session.state.me?.must_change_password) {
      this.set({ ...this.state, paused: 'password_change' })
      return
    }
    if (this.state.running) {
      this.queued = true
      this.queuedForce ||= !!opts.force
      return
    }
    this.set({ ...this.state, running: true })
    try {
      const result = await this.outbox.replay(userId, this.session, this.now, {
        ignoreBackoff: opts.force,
      })
      this.set({ running: false, paused: result.paused, lastSent: result.sent })
    } catch {
      this.set({ ...this.state, running: false })
    }
    if (this.queued) {
      const force = this.queuedForce
      this.queued = false
      this.queuedForce = false
      await this.kick({ force })
    }
  }

  private armTick() {
    if (this.timer) return
    this.timer = setInterval(() => void this.kick(), TICK_MS)
  }

  private set(next: SyncState) {
    this.state = next
    for (const fn of this.listeners) fn(next)
  }
}
