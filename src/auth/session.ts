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
// - A reload with no signal reopens as the last farmer (an "offline session"),
//   so capture still works at the apiary. Only who they are is remembered on
//   the device (ids, role, name), never a token: the first request back online
//   gets a 401 and renews from the cookie as usual. Signing out, or the server
//   ending the session, forgets them.
// - Only a farmer is remembered (13 D15). A console is often a shared office
//   laptop, and reopening offline as the last staff member would let the next
//   person act under their name. A staff sign-in also forgets any farmer
//   remembered before it, so an offline reload never reopens as someone else.
// - A password someone else set is changed at first sign-in (13 D5):
//   `changePassword` sends it, and the fresh session that comes back clears
//   `me.must_change_password` in every tab.

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

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type SessionDeps = {
  fetch?: typeof fetch
  baseUrl?: string
  locks?: LockManagerLike
  channel?: ChannelLike
  storage?: StorageLike | null
}

const LAST_ME = 'apichain-last-me'

const CLIENT_HEADER = { 'X-ApiChain-Client': 'pwa' }

export type ChangeResult =
  | { ok: true }
  | {
      ok: false
      reason: 'wrong_password' | 'unchanged' | 'too_short' | 'too_long' | 'offline' | 'signed_out'
      minLength?: number
    }

export class Session {
  state: SessionState = { status: 'restoring', me: null }
  /** Signed in from the remembered identity, with no token yet (offline reload). */
  offlineSession = false
  private token: string | null = null
  private version = 0
  private inflight: Promise<boolean> | null = null
  private listeners = new Set<(s: SessionState) => void>()
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string
  private readonly locks: LockManagerLike
  private readonly channel: ChannelLike | null
  private readonly storage: StorageLike | null

  constructor(deps: SessionDeps = {}) {
    this.fetchImpl = deps.fetch ?? ((...a) => fetch(...a))
    this.baseUrl = deps.baseUrl ?? ''
    this.locks = deps.locks ?? browserLocks()
    this.channel = deps.channel ?? browserChannel()
    this.storage = deps.storage === undefined ? browserStorage() : deps.storage
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
      // Offline at startup: reopen as the last farmer on this phone, if any,
      // so capture works. Nothing can be sent until a token is renewed.
      if (this.state.status !== 'restoring') return
      const me = this.remembered()
      if (me?.role === 'farmer') {
        this.offlineSession = true
        this.set({ status: 'signed_in', me })
      } else {
        this.set({ status: 'anonymous', me: null })
      }
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
    this.forget()
    this.channel?.postMessage({ type: 'signed_out' } satisfies Message)
  }

  /**
   * Choose a new password (`POST /v2/auth/password`). The server ends every
   * session of this person and returns a fresh one, adopted here. Neither
   * password is kept anywhere after this call returns.
   */
  async changePassword(current: string, next: string): Promise<ChangeResult> {
    let res: Response
    try {
      res = await this.authFetch('/v2/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...CLIENT_HEADER },
        body: JSON.stringify({ current_password: current, new_password: next }),
      })
    } catch {
      return { ok: false, reason: 'offline' }
    }
    if (res.ok) {
      const { access_token } = (await res.json()) as { access_token: string }
      const me = await this.loadMe(access_token)
      if (!me) return { ok: false, reason: 'offline' }
      this.adopt(access_token, me, true)
      return { ok: true }
    }
    if (res.status === 401) return { ok: false, reason: 'signed_out' }
    const err = (await res.json().catch(() => ({}))) as {
      code?: string
      details?: { min_length?: number }
    }
    if (err.code === 'wrong_password') return { ok: false, reason: 'wrong_password' }
    if (err.code === 'password_unchanged') return { ok: false, reason: 'unchanged' }
    if (err.code === 'password_too_long') return { ok: false, reason: 'too_long' }
    if (err.code === 'password_too_short') {
      return { ok: false, reason: 'too_short', minLength: err.details?.min_length }
    }
    return { ok: false, reason: 'offline' }
  }

  /**
   * An authenticated request. On a 401 it refreshes once and retries once.
   * Throws OfflineError when the server cannot be reached.
   *
   * `asUser`: the person this request is on behalf of. If renewing the
   * session turns it into someone else (the cookie in the jar belongs to
   * another farmer than the one this phone reopened as), the request is not
   * retried: it would put one person's work under another's name (03 §13.1).
   */
  async authFetch(
    path: string,
    init: RequestInit = {},
    opts: { asUser?: number } = {},
  ): Promise<Response> {
    const attempt = async () => {
      const headers = new Headers(init.headers)
      if (this.token) headers.set('Authorization', `Bearer ${this.token}`)
      try {
        return await this.raw(path, { ...init, headers })
      } catch {
        throw new OfflineError()
      }
    }
    if (opts.asUser !== undefined && this.userId !== opts.asUser) return unauthorized()
    const first = await attempt()
    if (first.status !== 401) return first
    const renewed = await this.refreshOnce()
    if (!renewed) return first
    if (opts.asUser !== undefined && this.userId !== opts.asUser) return first
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
            this.forget()
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
    this.offlineSession = false
    this.version++
    try {
      if (me.role === 'farmer') this.storage?.setItem(LAST_ME, JSON.stringify(me))
      else this.storage?.removeItem(LAST_ME)
    } catch {
      // Storage refused (private mode, quota): offline reloads just won't
      // reopen signed in. Never fatal.
    }
    this.set({ status: 'signed_in', me })
    if (broadcast) this.channel?.postMessage({ type: 'token', token, me } satisfies Message)
  }

  private onMessage(msg: Message) {
    if (msg.type === 'token') this.adopt(msg.token, msg.me, false)
    if (msg.type === 'signed_out') this.forget()
  }

  private remembered(): Me | null {
    try {
      const raw = this.storage?.getItem(LAST_ME)
      if (!raw) return null
      // Remembered by 4a, before /me said whether a change is forced.
      const me = JSON.parse(raw) as Partial<Me> & Omit<Me, 'must_change_password'>
      return { ...me, must_change_password: me.must_change_password ?? false }
    } catch {
      return null
    }
  }

  private forget() {
    this.token = null
    this.offlineSession = false
    try {
      this.storage?.removeItem(LAST_ME)
    } catch {
      // see adopt()
    }
    this.set({ status: 'anonymous', me: null })
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

export function browserLocks(): LockManagerLike {
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

function unauthorized(): Response {
  return new Response(JSON.stringify({ code: 'identity_changed' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
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
