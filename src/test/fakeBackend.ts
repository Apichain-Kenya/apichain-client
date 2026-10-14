// An in-memory stand-in for the parts of apichain-backend the session and the
// outbox talk to, with the server's real semantics: idempotency keyed by
// (key, actor) with fingerprint checks, refresh rotation through one cookie
// jar shared by every "tab", and switches for the failure modes that matter
// offline — no network, and a response lost after the server committed.

type Json = Record<string, unknown>

export class FakeBackend {
  offline = false
  /** The server commits the next write, then the reply never arrives. */
  loseNextResponse = false
  /** Answer the next write with 409 "in use", as when an earlier attempt
   *  under the same key is still running server-side. */
  conflictNext = false
  /** As `loseNextResponse`, but only for the next write to this path. */
  loseResponseFor: string | null = null
  /** The server rotates the next refresh, then the reply never arrives. */
  loseNextRefresh = false
  refreshCalls = 0
  cookieJar: string | null = null // the browser's cookie, shared by all tabs
  apiaries: Json[] = []
  batches: Json[] = []
  harvests: Json[] = []
  requests: { path: string; key: string | null; body: Json }[] = []

  private users = new Map<string, { id: number; password: string; farmerId: number }>()
  private tokens = new Map<string, number>() // access token -> user id
  private refresh = new Map<string, { userId: number; rotatedTo: string | null }>()
  private idem = new Map<string, { fingerprint: string; status: number; body: Json }>()
  private seq = { token: 0, refresh: 0, apiary: 100, batch: 500 }

  addFarmer(identifier: string, password: string, id: number, farmerId: number) {
    this.users.set(identifier, { id, password, farmerId })
  }

  revokeAllSessions() {
    this.refresh.clear()
    this.tokens.clear()
  }

  expireAccessTokens() {
    this.tokens.clear()
  }

  fetch: typeof fetch = async (input, init) => {
    if (this.offline) throw new TypeError('Failed to fetch')
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '')
    const headers = new Headers(init?.headers)
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {}
    const method = (init?.method ?? 'GET').toUpperCase()

    if (path === '/v2/auth/login' && method === 'POST') return this.login(body)
    if (path === '/v2/auth/refresh' && method === 'POST') return this.doRefresh(headers)
    if (path === '/v2/auth/logout' && method === 'POST') {
      this.cookieJar = null
      return json(200, { status: 'logged_out' })
    }

    const userId = this.tokens.get((headers.get('Authorization') ?? '').replace('Bearer ', ''))
    if (userId === undefined) return json(401, { code: 'invalid_token', message: 'Invalid' })
    const user = [...this.users.values()].find((u) => u.id === userId)!

    if (path === '/v2/me') {
      return json(200, {
        user_id: user.id,
        role: 'farmer',
        display_name: 'Wanjiru K',
        farmer_id: user.farmerId,
        must_change_password: false,
      })
    }

    const key = headers.get('Idempotency-Key')
    this.requests.push({ path, key, body })
    if (this.conflictNext) {
      this.conflictNext = false
      return json(409, { code: 'idempotency_conflict', message: 'Idempotency-Key is in use' })
    }
    if (!key) return json(422, { detail: [{ loc: ['header', 'Idempotency-Key'] }] })
    const idemKey = `${userId}:${key}`
    const fingerprint = JSON.stringify(body)
    const seen = this.idem.get(idemKey)
    if (seen) {
      if (seen.fingerprint !== fingerprint) {
        return json(409, { code: 'idempotency_conflict', message: 'reused with a different body' })
      }
      return json(seen.status, seen.body)
    }

    let result: [number, Json]
    const harvest = path.match(/^\/v2\/batches\/(\d+)\/harvest$/)
    if (path === '/v2/apiaries') {
      if (body.farmer_id !== user.farmerId) result = [403, { code: 'forbidden' }]
      else {
        const row = { id: ++this.seq.apiary, ...body }
        this.apiaries.push(row)
        result = [201, row]
      }
    } else if (path === '/v2/batches') {
      if (!this.apiaries.some((a) => a.id === body.apiary_id)) {
        result = [404, { code: 'apiary_not_found' }]
      } else {
        const row = { id: ++this.seq.batch, state: 'CREATED', ...body }
        this.batches.push(row)
        result = [201, row]
      }
    } else if (harvest) {
      const batchId = Number(harvest[1])
      if (!this.batches.some((b) => b.id === batchId)) result = [404, { code: 'batch_not_found' }]
      else if (Number(body.quantity_kg) <= 0) result = [422, { code: 'invalid_quantity' }]
      else {
        this.harvests.push({ batch_id: batchId, ...body })
        result = [201, { batch_id: batchId, state: 'HARVESTED' }]
      }
    } else {
      return json(404, { code: 'not_found' })
    }

    if (result[0] < 500) this.idem.set(idemKey, { fingerprint, status: result[0], body: result[1] })
    if (this.loseNextResponse || this.loseResponseFor === path) {
      this.loseNextResponse = false
      this.loseResponseFor = null
      throw new TypeError('Failed to fetch')
    }
    return json(result[0], result[1])
  }

  private login(body: Json) {
    const user = this.users.get(String(body.identifier))
    if (!user || user.password !== body.password) {
      return json(401, { code: 'invalid_credentials', message: 'Invalid credentials' })
    }
    this.cookieJar = this.issueRefresh(user.id)
    return json(200, {
      access_token: this.issueAccess(user.id),
      token_type: 'bearer',
      expires_in: 900,
    })
  }

  private doRefresh(headers: Headers) {
    this.refreshCalls++
    if (headers.get('X-ApiChain-Client') !== 'pwa')
      return json(403, { code: 'client_header_required' })
    const presented = this.cookieJar
    const row = presented ? this.refresh.get(presented) : undefined
    if (!row) return json(401, { code: 'invalid_token' })
    if (row.rotatedTo !== null) {
      // The real server's reuse rule, without the 60 s window: these tests
      // assert the client never relies on it.
      this.revokeAllSessions()
      return json(401, { code: 'token_reuse' })
    }
    const next = this.issueRefresh(row.userId)
    row.rotatedTo = next
    if (this.loseNextRefresh) {
      this.loseNextRefresh = false
      throw new TypeError('Failed to fetch') // the Set-Cookie never arrives
    }
    this.cookieJar = next
    return json(200, {
      access_token: this.issueAccess(row.userId),
      token_type: 'bearer',
      expires_in: 900,
    })
  }

  private issueAccess(userId: number) {
    const token = `at-${++this.seq.token}`
    this.tokens.set(token, userId)
    return token
  }

  private issueRefresh(userId: number) {
    const raw = `rt-${++this.seq.refresh}`
    this.refresh.set(raw, { userId, rotatedTo: null })
    return raw
  }
}

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A shared Web Locks stand-in, so two "tabs" in one test contend for real. */
export class FakeLocks {
  private tails = new Map<string, Promise<unknown>>()
  request<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(name) ?? Promise.resolve()
    const run = prev.then(fn, fn)
    this.tails.set(
      name,
      run.catch(() => undefined),
    )
    return run
  }
}

/** A shared BroadcastChannel stand-in with async delivery, like the real one. */
export class FakeBus {
  private listeners = new Set<(data: unknown) => void>()
  channel() {
    const own = new Set<(data: unknown) => void>()
    return {
      postMessage: (data: unknown) => {
        for (const l of this.listeners) if (!own.has(l)) queueMicrotask(() => l(data))
      },
      subscribe: (fn: (data: unknown) => void) => {
        own.add(fn)
        this.listeners.add(fn)
      },
    }
  }
}
