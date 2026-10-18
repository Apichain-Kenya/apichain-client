// An in-memory stand-in for the parts of apichain-backend the session and the
// outbox talk to, with the server's real semantics: idempotency keyed by
// (key, actor) with fingerprint checks, refresh rotation through one cookie
// jar shared by every "tab", and switches for the failure modes that matter
// offline — no network, and a response lost after the server committed.

type Json = Record<string, unknown>
type Role = 'farmer' | 'field_officer' | 'operator' | 'lab_officer' | 'admin'
type FakeUser = {
  id: number
  username: string
  password: string
  farmerId: number | null
  role: Role
  displayName: string
  mustChange: boolean
  isRoot: boolean
  active: boolean
  createdAt: string
}

// The backend's lifecycle and who may take each step (`transitions.LEGAL`,
// `ACTION_ROLES`), so the fake can answer `next_action` per caller. A copy for
// tests only: the console itself keeps none (13 D10).
const NEXT: Record<string, { target: string; action: string; route: string | null }> = {
  CREATED: { target: 'HARVESTED', action: 'batch.harvest_record', route: null },
  HARVESTED: { target: 'PROCESSED', action: 'batch.process_record', route: 'process' },
  PROCESSED: { target: 'LAB_VERIFIED', action: 'batch.lab_verify', route: 'lab-verify' },
  LAB_VERIFIED: { target: 'PACKAGED', action: 'batch.package', route: 'package' },
  PACKAGED: { target: 'DISTRIBUTED', action: 'batch.distribute', route: 'distribute' },
}
const MAY: Record<string, Role[]> = {
  'batch.harvest_record': ['farmer', 'operator', 'admin'],
  'batch.process_record': ['operator', 'admin'],
  'batch.lab_verify': ['lab_officer', 'admin'],
  'batch.package': ['operator', 'admin'],
  'batch.distribute': ['operator', 'admin'],
}
const RECORDED: Record<string, string> = {
  PROCESSED: 'batch.process_recorded',
  LAB_VERIFIED: 'batch.lab_verified',
  PACKAGED: 'batch.packaged',
  DISTRIBUTED: 'batch.distributed',
}

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
  /** Answer the next write to a matching path with this, doing nothing: for
   *  refusals no single request can reach (the last-admin race). */
  answerNext: { path: RegExp; status: number; body: Json } | null = null
  refreshCalls = 0
  cookieJar: string | null = null // the browser's cookie, shared by all tabs
  apiaries: Json[] = []
  batches: Json[] = []
  harvests: Json[] = []
  requests: { path: string; key: string | null; body: Json }[] = []
  /** Batch details as the console reads them (the backend's console fixtures). */
  batchDetails: Json[] = []
  /** Every GET, in order, for tests of what a screen asked for. */
  reads: string[] = []
  /** Every staff step the server accepted, in order. */
  stageWrites: { route: string; batchId: number; body: Json }[] = []

  private users = new Map<string, FakeUser>()
  private tokens = new Map<string, number>() // access token -> user id
  private refresh = new Map<string, { userId: number; rotatedTo: string | null }>()
  private idem = new Map<string, { fingerprint: string; status: number; body: Json }>()
  private seq = { token: 0, refresh: 0, apiary: 100, batch: 500, user: 900 }

  addFarmer(
    identifier: string,
    password: string,
    id: number,
    farmerId: number,
    opts: { mustChange?: boolean } = {},
  ) {
    this.users.set(identifier, {
      id,
      username: identifier,
      password,
      farmerId,
      role: 'farmer',
      displayName: 'Wanjiru K',
      mustChange: opts.mustChange ?? false,
      isRoot: false,
      active: true,
      createdAt: '2026-10-01T08:00:00',
    })
  }

  addStaff(
    identifier: string,
    password: string,
    id: number,
    role: Exclude<Role, 'farmer'>,
    displayName: string,
    opts: { mustChange?: boolean; isRoot?: boolean; active?: boolean } = {},
  ) {
    this.users.set(identifier, {
      id,
      username: identifier,
      password,
      farmerId: null,
      role,
      displayName,
      mustChange: opts.mustChange ?? false,
      isRoot: opts.isRoot ?? false,
      active: opts.active ?? true,
      createdAt: '2026-10-01T08:00:00',
    })
  }

  /** An account as `/v2/users` shows it, or undefined. */
  account(identifier: string) {
    const u = this.users.get(identifier)
    return u ? userOut(u) : undefined
  }

  /** As an admin reset does: a new password someone else knows, to be changed. */
  resetPassword(identifier: string, password: string) {
    const user = this.users.get(identifier)!
    user.password = password
    user.mustChange = true
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
        role: user.role,
        display_name: user.displayName,
        farmer_id: user.farmerId,
        must_change_password: user.mustChange,
      })
    }
    if (path === '/v2/auth/password' && method === 'POST')
      return this.changePassword(user, headers, body)
    // The server's forced change (13 D5): everything but /me and the change
    // itself is refused until the person has chosen their own password.
    if (user.mustChange) {
      return json(403, { code: 'password_change_required', message: 'Choose a new password' })
    }
    if (method === 'GET') {
      this.reads.push(path)
      return this.read(path, user)
    }

    const key = headers.get('Idempotency-Key')
    this.requests.push({ path, key, body })
    if (this.conflictNext) {
      this.conflictNext = false
      return json(409, { code: 'idempotency_conflict', message: 'Idempotency-Key is in use' })
    }
    if (this.answerNext?.path.test(path)) {
      const { status, body: reply } = this.answerNext
      this.answerNext = null
      return json(status, reply)
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
    const stage = path.match(/^\/v2\/batches\/(\d+)\/(process|lab-verify|package|distribute)$/)
    const account = path.match(/^\/v2\/users(?:\/(\d+)\/(deactivate|reset-password))?$/)
    if (stage) {
      result = this.stage(user, Number(stage[1]), stage[2], body)
    } else if (account) {
      result = this.manage(user, account[1] ? Number(account[1]) : null, account[2] ?? null, body)
    } else if (path === '/v2/apiaries') {
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

    // As the server does: a refusal rolls back, key and all, so only a
    // success is ever replayed under its key.
    if (result[0] < 300) this.idem.set(idemKey, { fingerprint, status: result[0], body: result[1] })
    if (this.loseNextResponse || this.loseResponseFor === path) {
      this.loseNextResponse = false
      this.loseResponseFor = null
      throw new TypeError('Failed to fetch')
    }
    return json(result[0], result[1])
  }

  private read(path: string, user: FakeUser): Response {
    const url = new URL(path, 'http://fake')
    const detail = url.pathname.match(/^\/v2\/batches\/(\d+)$/)
    if (detail) {
      const row = this.batchDetails.find((b) => b.id === Number(detail[1]))
      if (!row) return json(404, { code: 'batch_not_found' })
      const next = NEXT[String(row.state)]
      return json(200, {
        ...row,
        stages: [...(row.stages as Json[])],
        next_action: next
          ? {
              action: next.action,
              target_state: next.target,
              allowed: MAY[next.action].includes(user.role),
            }
          : null,
      })
    }
    if (url.pathname === '/v2/users') {
      if (user.role !== 'admin') return json(403, { code: 'forbidden', message: 'Forbidden' })
      const role = url.searchParams.get('role')
      const active = url.searchParams.get('active')
      const items = [...this.users.values()]
        .filter((u) => u.role !== 'farmer')
        .filter((u) => !role || u.role === role)
        .filter((u) => active === null || String(u.active) === active)
        .sort((a, b) => a.id - b.id)
        .map(userOut)
      return json(200, { items, next_cursor: null })
    }
    if (url.pathname === '/v2/batches') {
      const states = url.searchParams.getAll('state')
      const q = url.searchParams.get('q')?.toLowerCase()
      const items = this.batchDetails
        .filter((b) => states.length === 0 || states.includes(String(b.state)))
        .filter((b) => !q || String(b.batch_code).toLowerCase().startsWith(q))
        .sort((a, b) => Number(b.id) - Number(a.id))
        .map((b) => ({
          id: b.id,
          public_id: b.public_id,
          batch_code: b.batch_code,
          state: b.state,
          state_updated_at: b.state_updated_at,
          created_at: b.created_at,
          honey_type: (b.metadata as Json | null)?.honey_type ?? null,
          apiary_name: (b.apiary as Json | null)?.name ?? null,
          farmer_display_name: b.farmer_display_name,
        }))
      return json(200, { items, next_cursor: null })
    }
    return json(404, { code: 'not_found' })
  }

  /** A staff step: the role, then the state, then the body, as the server checks. */
  private stage(user: FakeUser, batchId: number, route: string, body: Json): [number, Json] {
    const row = this.batchDetails.find((b) => b.id === batchId)
    if (!row) return [404, { code: 'batch_not_found', message: 'No such batch' }]
    const step = Object.values(NEXT).find((n) => n.route === route)!
    if (!MAY[step.action].includes(user.role)) {
      return [403, { code: 'forbidden', message: 'Your role may not do this' }]
    }
    if (NEXT[String(row.state)]?.route !== route) {
      return [409, { code: 'invalid_transition', message: `Batch is ${String(row.state)}` }]
    }
    const s = body.sucrose_g_100g
    const fg = body.fructose_glucose_g_100g
    if (route === 'lab-verify' && s != null && fg != null && Number(s) > Number(fg)) {
      const msg =
        'Value error, sucrose_g_100g exceeds fructose_glucose_g_100g; the two are likely transposed'
      return [422, { detail: [{ type: 'value_error', loc: ['body'], msg }] }]
    }
    // A new array: the seeded rows share their fixtures' arrays.
    const stages = row.stages as Json[]
    const now = '2026-10-15T09:30:00'
    row.stages = [
      ...stages,
      {
        action: RECORDED[step.target],
        actor_display_name: user.displayName,
        actor_id: user.id,
        actor_role: user.role,
        anchor_status: 'pending',
        audit_id: Math.max(0, ...stages.map((x) => Number(x.audit_id))) + 1,
        payload_hash: 'f'.repeat(64),
        recorded_at: now,
      },
    ]
    row.state = step.target
    row.state_updated_at = now
    this.stageWrites.push({ route, batchId, body })
    return [201, { batch_id: batchId, state: step.target }]
  }

  /** Staff accounts (`/v2/users`), with the server's refusals. */
  private manage(
    user: FakeUser,
    id: number | null,
    verb: string | null,
    body: Json,
  ): [number, Json] {
    if (user.role !== 'admin') return [403, { code: 'forbidden', message: 'Forbidden' }]
    const short = (min: number): [number, Json] => [
      422,
      { code: 'password_too_short', message: 'Too short', details: { min_length: min } },
    ]
    if (id === null) {
      const role = String(body.role) as Role
      if (role === 'admin' && !user.isRoot) {
        return [403, { code: 'root_required', message: 'Only the first admin' }]
      }
      const password = String(body.password ?? '')
      if (password.length < 15) return short(15)
      const username = String(body.username)
      if (this.users.has(username)) return [409, { code: 'username_taken', message: 'Taken' }]
      const made: FakeUser = {
        id: ++this.seq.user,
        username,
        password,
        farmerId: null,
        role,
        displayName: String(body.full_name),
        mustChange: true,
        isRoot: false,
        active: true,
        createdAt: '2026-10-15T09:30:00',
      }
      this.users.set(username, made)
      return [201, userOut(made)]
    }
    const target = [...this.users.values()].find((u) => u.id === id)
    if (!target) return [404, { code: 'user_not_found', message: 'No such user' }]
    const endSessions = () => {
      for (const [raw, r] of this.refresh) if (r.userId === target.id) this.refresh.delete(raw)
      for (const [token, uid] of this.tokens) if (uid === target.id) this.tokens.delete(token)
    }
    if (verb === 'deactivate') {
      if (target.id === user.id) return [409, { code: 'cannot_deactivate_self', message: 'Self' }]
      if (target.isRoot) return [409, { code: 'root_protected', message: 'Root' }]
      const admins = [...this.users.values()].filter((u) => u.role === 'admin' && u.active)
      if (target.role === 'admin' && target.active && admins.length <= 1) {
        return [409, { code: 'last_admin', message: 'Last admin' }]
      }
      target.active = false
      endSessions()
      return [200, userOut(target)]
    }
    if (target.id === user.id) return [409, { code: 'reset_own_password', message: 'Own' }]
    if (target.isRoot) return [409, { code: 'root_protected', message: 'Root' }]
    if (target.role === 'admin' && !user.isRoot) {
      return [403, { code: 'root_required', message: 'Only the first admin' }]
    }
    const min = target.role === 'farmer' ? 8 : 15
    if (String(body.password ?? '').length < min) return short(min)
    target.password = String(body.password)
    target.mustChange = true
    endSessions()
    return [200, userOut(target)]
  }

  private changePassword(user: FakeUser, headers: Headers, body: Json): Response {
    if (headers.get('X-ApiChain-Client') !== 'pwa')
      return json(403, { code: 'client_header_required' })
    if (body.current_password !== user.password) {
      return json(403, { code: 'wrong_password', message: 'The current password is not right' })
    }
    const next = String(body.new_password ?? '')
    if (next === user.password) return json(422, { code: 'password_unchanged', message: 'Same' })
    const min = user.role === 'farmer' ? 8 : 15
    if (next.length < min) {
      return json(422, {
        code: 'password_too_short',
        message: 'Too short',
        details: { min_length: min },
      })
    }
    user.password = next
    user.mustChange = false
    // As the server does: every session of this person ends, and this one
    // gets a fresh pair.
    for (const [raw, row] of this.refresh) if (row.userId === user.id) this.refresh.delete(raw)
    for (const [token, id] of this.tokens) if (id === user.id) this.tokens.delete(token)
    this.cookieJar = this.issueRefresh(user.id)
    return json(200, {
      access_token: this.issueAccess(user.id),
      token_type: 'bearer',
      expires_in: 900,
    })
  }

  private login(body: Json) {
    const user = this.users.get(String(body.identifier))
    if (!user || !user.active || user.password !== body.password) {
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

function userOut(u: FakeUser): Json {
  return {
    id: u.id,
    username: u.username,
    full_name: u.displayName,
    role: u.role,
    is_active: u.active,
    is_root: u.isRoot,
    must_change_password: u.mustChange,
    created_at: u.createdAt,
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
