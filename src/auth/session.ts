// The session (12 §8, D3/D5).
//
// - The access token lives in this object's memory and nowhere else: not in
//   localStorage, not in IndexedDB. A reload loses it on purpose.
// - The refresh token lives only in the HttpOnly `__Secure-apichain_rt`
//   cookie, which no script can read. `restore()` turns that cookie back into
//   a session after a reload.
// - Refresh is single-flight across tabs. One Web Lock serialises refreshes,
//   so a second tab's refresh goes out after the first tab's new cookie has
//   landed and never presents a just-spent token (which the server would treat
//   as theft and revoke every session). A BroadcastChannel shares the new
//   access token so other tabs usually skip their refresh entirely.
// - Offline is not signed out. A failed network call leaves the session as
//   it was; only a 401 from the server ends it.

import type { Me, SessionState } from './SessionContext'

export class OfflineError extends Error {
  constructor() {
    super('offline: the server could not be reached')
  }
}

type LockManagerLike = {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>
}
type ChannelLike = {
  postMessage(data: unknown): void
  subscribe(fn: (data: unknown) => void): void
}
type Message = { type: 'token'; token: string; me: Me } | { type: 'signed_out' }

export type SessionDeps = {
  fetch?: typeof fetch
  baseUrl?: string
  locks?: LockManagerLike
  channel?: ChannelLike
}

const CLIENT_HEADER = { 'X-ApiChain-Client': 'pwa' }

export class Session {
  state: SessionState = { status: 'restoring', me: null }
  private token: string | null = null
  private version = 0
  private inflight: Promise<boolean> | null = null
  private listeners = new Set<(s: SessionState) => void>()
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly locks: LockManagerLike
  private readonly channel: ChannelLike | null

  constructor(deps: SessionDeps = {}) {
    this.fetchImpl = deps.fetch ?? ((...a) => fetch(...a))
    this.baseUrl = deps.baseUrl ?? ''
    this.locks = deps.locks ?? browserLocks()
    this.channel = deps.channel ?? browserChannel()
    this.channel?.subscribe((data) => this.onMessage(data as Message))
  }

  subscribe(fn: (s: SessionState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get userId(): number | null {
    return this.state.status === 'signed_in' ? this.state.me.user_id : null
  }

  /** Page load: turn the refresh cookie back into a session, silently. */
  async restore(): Promise<void> {
    try {
      const ok = await this.refreshOnce()
      if (!ok) this.set({ status: 'anonymous', me: null })
    } catch {
      // Offline at startup with no token in memory: we cannot prove who this
      // is yet. Anonymous for now; the outbox keeps everything, locked.
      if (this.state.status === 'restoring') this.set({ status: 'anonymous', me: null })
    }
  }

  async signIn(identifier: string, password: string): Promise<'ok' | 'invalid' | 'offline'> {
    let res: Response
    try {
      res = await this.raw('/v2/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      })
    } catch {
      return 'offline'
    }
    if (res.status === 401) return 'invalid'
    if (!res.ok) return 'offline'
    const { access_token } = (await res.json()) as { access_token: string }
    const me = await this.loadMe(access_token)
    if (!me) return 'offline'
    this.adopt(access_token, me, true)
    return 'ok'
  }

  async signOut(): Promise<void> {
    try {
      await this.raw('/v2/auth/logout', { method: 'POST', headers: CLIENT_HEADER })
    } catch {
      // Offline sign-out still forgets the session on this device; the
      // cookie is revoked server-side the next time anything reaches it.
    }
    this.token = null
    this.set({ status: 'anonymous', me: null })
    this.channel?.postMessage({ type: 'signed_out' } satisfies Message)
  }

  /**
   * An authenticated request. On a 401 it refreshes once and retries once.
   * Throws OfflineError when the server cannot be reached.
   */
  async authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const attempt = async () => {
      const headers = new Headers(init.headers)
      if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
      try {
        return await this.raw(path, { ...init, headers })
      } catch {
        throw new OfflineError()
      }
    }
    const first = await attempt()
    if (first.status !== 401) return first
    const renewed = await this.refreshOnce()
    if (!renewed) return first
    return attempt()
  }

  /** True if a fresh access token is now in memory. Single-flight per tab. */
  refreshOnce(): Promise<boolean> {
    if (!this.inflight) {
      const seen = this.version
      this.inflight = this.locks
        .request('apichain-refresh', async () => {
          // Another tab refreshed while this one waited for the lock, and
          // shared the token: nothing to do.
          if (this.version !== seen && this.token) return true
          let res: Response
          try {
            res = await this.raw('/v2/auth/refresh', { method: 'POST', headers: CLIENT_HEADER })
          } catch {
            throw new OfflineError()
          }
          // Only the server saying "no session" ends it. A 5xx is the server
          // failing, which must not sign a farmer out.
          if (!res.ok && res.status !== 401) throw new OfflineError()
          if (!res.ok) {
            this.token = null
            this.set({ status: 'anonymous', me: null })
            return false
          }
          const { access_token } = (await res.json()) as { access_token: string }
          const me = await this.loadMe(access_token)
          if (!me) throw new OfflineError()
          this.adopt(access_token, me, true)
          return true
        })
        .finally(() => {
          this.inflight = null
        })
    }
    return this.inflight
  }

  private async loadMe(token: string): Promise<Me | null> {
    try {
      const res = await this.raw('/v2/me', { headers: { Authorization: `Bearer ${token}` } })
      return res.ok ? ((await res.json()) as Me) : null
    } catch {
      return null
    }
  }

  private adopt(token: string, me: Me, broadcast: boolean) {
    this.token = token
    this.version++
    this.set({ status: 'signed_in', me })
    if (broadcast) this.channel?.postMessage({ type: 'token', token, me } satisfies Message)
  }

  private onMessage(msg: Message) {
    if (msg.type === 'token') this.adopt(msg.token, msg.me, false)
    if (msg.type === 'signed_out') {
      this.token = null
      this.set({ status: 'anonymous', me: null })
    }
  }

  private raw(path: string, init: RequestInit): Promise<Response> {
    // Same origin (12 D4): the cookie is SameSite=Strict and scoped to
    // /v2/auth, and `credentials: 'include'` lets it ride.
    return this.fetchImpl(this.baseUrl + path, { ...init, credentials: 'include' })
  }

  private set(next: SessionState) {
    this.state = next
    for (const fn of this.listeners) fn(next)
  }
}

function browserLocks(): LockManagerLike {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return {
      request: <T>(name: string, fn: () => Promise<T>) =>
        navigator.locks.request(name, fn) as unknown as Promise<T>,
    }
  }
  // Fallback: a per-tab mutex (very old browsers have no Web Locks).
  let tail: Promise<unknown> = Promise.resolve()
  return {
    request<T>(_name: string, fn: () => Promise<T>) {
      const run = tail.then(fn, fn)
      tail = run.catch(() => undefined)
      return run
    },
  }
}

function browserChannel(): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const ch = new BroadcastChannel('apichain-auth')
  return {
    postMessage: (data) => ch.postMessage(data),
    subscribe: (fn) => ch.addEventListener('message', (e) => fn(e.data)),
  }
}
