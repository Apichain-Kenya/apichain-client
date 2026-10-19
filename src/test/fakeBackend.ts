// An in-memory stand-in for the parts of apichain-backend the session and the
// outbox talk to, with the server's real semantics: idempotency keyed by
// (key, actor) with fingerprint checks, refresh rotation through one cookie
// jar shared by every "tab", and switches for the failure modes that matter
// offline — no network, and a response lost after the server committed.

import { toE164Ke } from '../auth/phone'

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

// Farmers (`farmers.py`, `verifications.py`, `documents.py`): who may reach
// them is `deps.py`'s table, which staff are field officers and admins only.
const FARMER_STAFF: Role[] = ['field_officer', 'admin']
const PURPOSES = [
  'data_processing',
  'document_upload',
  'sms_notifications',
  'email_notifications',
  'photo_publish',
]
const MAX_FILE_BYTES = 10 * 1024 * 1024
const SIGNATURES: [number[], string][] = [
  [[0x25, 0x50, 0x44, 0x46, 0x2d], 'application/pdf'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
]
const CODE_TTL_MS = 10 * 60_000
const COOLDOWN_MS = 60_000
const MAX_ATTEMPTS = 5

export type FakeFarmer = {
  id: number
  first_name: string
  last_name: string
  phone: string
  email: string | null
  address: string | null
  number_of_hives: number | null
  user_id: number
  enrolled_by: number | null
  created_at: string
  phone_verified_at: string | null
  email_verified_at: string | null
}
type Consent = {
  id: number
  farmer_id: number
  purpose: string
  granted: boolean
  granted_via: 'onboarder' | 'farmer_self'
  text_version: string
  recorded_at: string
}
type Code = {
  farmer_id: number
  channel: string
  code: string
  attempts: number
  created_at: number
  expires_at: number
  done: boolean
}
type Doc = {
  id: number
  farmer_id: number
  doc_type: string
  content_type: string
  size_bytes: number
  original_filename: string
  content_hash: string
  scan_status: 'clean'
  uploaded_at: string
}
type Reply = [number, Json, Record<string, string>?]

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
  answerNext: {
    path: RegExp
    status: number
    body: Json
    headers?: Record<string, string>
  } | null = null
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
  farmers: FakeFarmer[] = []
  consents: Consent[] = []
  documents: Doc[] = []
  /** Every code the SMS or email fake "delivered", as Mailpit would show it. */
  outbound: { farmerId: number; channel: string; code: string }[] = []
  /** Every signed URL handed out, in order. */
  signedUrls: string[] = []
  /** `GET /v2/public/batches/{public_id}/verify` answers, by public id. */
  verifies: Record<string, Json> = {}
  /** Set to answer /verify as the service worker's saved copy does. */
  verifyCachedAt: string | null = null
  /** `GET /v2/audit/health` and `/v2/audit/anchor-health`. */
  auditHealth: Json = { chain_ok: true, checked_at: null, rows_checked: 0 }
  anchorHealth: Json = { anchor_ok: true, pending_rows: 0, pending_anchors: 0 }
  /** The server's clock, for the verification windows. */
  now: () => number = () => Date.now()

  private users = new Map<string, FakeUser>()
  private tokens = new Map<string, number>() // access token -> user id
  private refresh = new Map<string, { userId: number; rotatedTo: string | null }>()
  private idem = new Map<string, { fingerprint: string; status: number; body: Json }>()
  private codes: Code[] = []
  /** The next ids, one past these. A test may move one to place a record. */
  seq = {
    token: 0,
    refresh: 0,
    apiary: 100,
    batch: 500,
    user: 900,
    farmer: 300,
    consent: 0,
    doc: 0,
  }

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

  /** A farmer already on file, with their account and the required consent,
   *  as an earlier enrolment would have left them. */
  seedFarmer(
    f: Partial<FakeFarmer> & { first_name: string; last_name: string; phone: string },
    opts: { password?: string; by?: string } = {},
  ): FakeFarmer {
    const userId = ++this.seq.user
    const farmer: FakeFarmer = {
      id: ++this.seq.farmer,
      email: null,
      address: null,
      number_of_hives: null,
      enrolled_by: opts.by ? (this.users.get(opts.by)?.id ?? null) : null,
      created_at: '2026-10-03T08:00:00',
      phone_verified_at: null,
      email_verified_at: null,
      ...f,
      user_id: userId,
    }
    this.addFarmer(f.phone, opts.password ?? 'farmer pass', userId, farmer.id)
    this.users.get(f.phone)!.displayName = `${f.first_name} ${f.last_name}`
    this.farmers = [...this.farmers, farmer]
    this.consent(farmer.id, 'data_processing', true, 'onboarder', '2026-10-03T08:00:00')
    return farmer
  }

  /** A consent row, as the ledger would hold it; the newest row decides. */
  consent(
    farmerId: number,
    purpose: string,
    granted: boolean,
    via: Consent['granted_via'],
    at = '2026-10-11T07:00:00',
  ) {
    const row: Consent = {
      id: ++this.seq.consent,
      farmer_id: farmerId,
      purpose,
      granted,
      granted_via: via,
      text_version: 'en-2026-10',
      recorded_at: at,
    }
    this.consents = [...this.consents, row]
    return row
  }

  /** The farmer's own account, as login and `/v2/users/{id}` act on it. */
  farmerAccount(farmerId: number): (Json & { password: string }) | undefined {
    const u = [...this.users.values()].find((x) => x.farmerId === farmerId)
    return u ? { ...userOut(u), password: u.password } : undefined
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
    const form = init?.body instanceof FormData ? init.body : null
    const body = form ? {} : init?.body ? (JSON.parse(String(init.body)) as Json) : {}
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
    const file = form?.get('file')
    this.requests.push({
      path,
      key,
      body: form
        ? { doc_type: form.get('doc_type'), file: file instanceof File ? file.name : null }
        : body,
    })
    if (this.conflictNext) {
      this.conflictNext = false
      return json(409, { code: 'idempotency_conflict', message: 'Idempotency-Key is in use' })
    }
    if (this.answerNext?.path.test(path)) {
      const { status, body: reply, headers: extraHeaders } = this.answerNext
      this.answerNext = null
      return json(status, reply, extraHeaders)
    }
    // No Idempotency-Key on these (11 D6): content addressing dedupes an
    // upload, and a verification send or confirm is not a replayable write.
    const docs = path.match(/^\/v2\/farmers\/(\d+)\/documents$/)
    if (docs) return json(...(await this.upload(user, Number(docs[1]), form)))
    const verify = path.match(/^\/v2\/farmers\/(\d+)\/verifications(\/confirm)?$/)
    if (verify) return json(...this.verification(user, Number(verify[1]), !!verify[2], body))

    if (!key) return json(422, { detail: [{ loc: ['header', 'Idempotency-Key'] }] })
    const idemKey = `${userId}:${key}`
    // The enrol fingerprint leaves the password out, as the server's does (D4).
    const fingerprint = JSON.stringify(
      path === '/v2/farmers' ? { ...body, password: undefined } : body,
    )
    const seen = this.idem.get(idemKey)
    if (seen) {
      if (seen.fingerprint !== fingerprint) {
        return json(409, { code: 'idempotency_conflict', message: 'reused with a different body' })
      }
      return json(seen.status, seen.body)
    }

    let result: Reply
    const harvest = path.match(/^\/v2\/batches\/(\d+)\/harvest$/)
    const stage = path.match(/^\/v2\/batches\/(\d+)\/(process|lab-verify|package|distribute)$/)
    const account = path.match(/^\/v2\/users(?:\/(\d+)\/(deactivate|reset-password))?$/)
    const consents = path.match(/^\/v2\/farmers\/(\d+)\/consents$/)
    if (stage) {
      result = this.stage(user, Number(stage[1]), stage[2], body)
    } else if (account) {
      result = this.manage(user, account[1] ? Number(account[1]) : null, account[2] ?? null, body)
    } else if (path === '/v2/farmers') {
      result = this.enrol(user, body)
    } else if (consents) {
      result = this.recordConsent(user, Number(consents[1]), body)
    } else if (path === '/v2/apiaries') {
      // `apiary.create`: a farmer for themselves, a field officer or an admin
      // for anyone; operators and lab officers not at all.
      const staffMay = FARMER_STAFF.includes(user.role)
      if (!staffMay && (user.role !== 'farmer' || body.farmer_id !== user.farmerId)) {
        result = [403, { code: 'forbidden' }]
      } else if (staffMay && !this.farmers.some((f) => f.id === body.farmer_id)) {
        result = [404, { code: 'farmer_not_found', message: 'Farmer does not exist' }]
      } else if (String(body.name).includes('\u0000')) {
        // `SafeStr`: PostgreSQL text cannot hold U+0000, so the schema refuses it.
        result = [422, { detail: [{ msg: "String should match pattern '^[^\\x00]*$'" }] }]
      } else {
        const row = { id: ++this.seq.apiary, ...body }
        this.apiaries = [...this.apiaries, row]
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
    return json(...result)
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
    const verify = url.pathname.match(/^\/v2\/public\/batches\/([^/]+)\/verify$/)
    if (verify) {
      const row = this.verifies[verify[1]]
      if (!row) return json(404, { code: 'batch_not_found', message: 'No such batch' })
      return json(
        200,
        row,
        this.verifyCachedAt ? { 'X-ApiChain-Cached-At': this.verifyCachedAt } : {},
      )
    }
    if (url.pathname === '/v2/audit/health') return json(200, this.auditHealth)
    if (url.pathname === '/v2/audit/anchor-health') return json(200, this.anchorHealth)
    const farmerPath = url.pathname.match(/^\/v2\/farmers(?:\/(\d+)(\/consents|\/documents)?)?$/)
    if (farmerPath) return json(...this.readFarmers(user, url, farmerPath))
    const download = url.pathname.match(/^\/v2\/documents\/(\d+)\/download-url$/)
    if (download) {
      const doc = this.documents.find((d) => d.id === Number(download[1]))
      if (!doc) return json(404, { code: 'document_not_found', message: 'No such document' })
      const denied = this.mayActFor(user, doc.farmer_id)
      if (denied) return json(...denied)
      if (!this.granted(doc.farmer_id, 'document_upload')) return json(...consentRequired())
      const signed = `https://store.test/sha256/${doc.content_hash}?sig=${this.signedUrls.length + 1}`
      this.signedUrls = [...this.signedUrls, signed]
      return json(200, { url: signed, expires_at: new Date(this.now() + 300_000).toISOString() })
    }
    if (url.pathname === '/v2/apiaries') {
      const farmerId = Number(url.searchParams.get('farmer_id') ?? user.farmerId)
      const denied = this.mayActFor(user, farmerId)
      if (denied) return json(...denied)
      return json(200, this.apiaries.filter((a) => a.farmer_id === farmerId) as unknown as Json)
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

  /** `deps.requires`, then the farmer, then `ownership.assert_acts_for_farmer`. */
  private farmerFor(user: FakeUser, farmerId: number, farmerMay = true): FakeFarmer | Reply {
    if (!FARMER_STAFF.includes(user.role) && !(farmerMay && user.role === 'farmer')) {
      return [403, { code: 'forbidden', message: 'Your role may not do this' }]
    }
    const farmer = this.farmers.find((f) => f.id === farmerId)
    if (!farmer) return [404, { code: 'farmer_not_found', message: 'Farmer does not exist' }]
    if (user.role === 'farmer' && user.farmerId !== farmerId) {
      return [403, { code: 'forbidden', message: 'A farmer may only act on their own records' }]
    }
    return farmer
  }

  private mayActFor(user: FakeUser, farmerId: number): Reply | null {
    // A farmer acts for themselves whether or not a test seeded their profile.
    if (user.role === 'farmer') {
      return user.farmerId === farmerId
        ? null
        : [403, { code: 'forbidden', message: 'A farmer may only act on their own records' }]
    }
    const f = this.farmerFor(user, farmerId)
    return Array.isArray(f) ? f : null
  }

  private latest(farmerId: number, purpose: string, via?: Consent['granted_via']) {
    return this.consents
      .filter((c) => c.farmer_id === farmerId && c.purpose === purpose)
      .filter((c) => !via || c.granted_via === via)
      .at(-1)
  }

  private granted(farmerId: number, purpose: string) {
    return this.latest(farmerId, purpose)?.granted === true
  }

  private summary(f: FakeFarmer): Json {
    const by = [...this.users.values()].find((u) => u.id === f.enrolled_by)
    return {
      id: f.id,
      display_name: `${f.first_name} ${f.last_name}`,
      phone: f.phone,
      number_of_hives: f.number_of_hives,
      phone_verified: f.phone_verified_at !== null,
      email_verified: f.email_verified_at !== null,
      enrolled_at: f.created_at,
      enrolled_by_display_name: by?.displayName ?? null,
    }
  }

  private docOut(d: Doc): Json {
    return { ...d }
  }

  private readFarmers(user: FakeUser, url: URL, m: RegExpMatchArray): Reply {
    if (!m[1]) {
      if (!FARMER_STAFF.includes(user.role)) return [403, { code: 'forbidden', message: 'No' }]
      const q = url.searchParams.get('q')?.trim().toLowerCase()
      const items = this.farmers
        .filter(
          (f) =>
            !q ||
            f.first_name.toLowerCase().startsWith(q) ||
            f.last_name.toLowerCase().startsWith(q) ||
            `${f.first_name} ${f.last_name}`.toLowerCase().startsWith(q) ||
            f.phone.endsWith(q),
        )
        .sort((a, b) => b.id - a.id)
        .map((f) => this.summary(f))
      return [200, { items, next_cursor: null }]
    }
    const farmer = this.farmerFor(user, Number(m[1]))
    if (Array.isArray(farmer)) return farmer
    if (m[2] === '/consents') {
      return [
        200,
        {
          farmer_id: farmer.id,
          consents: PURPOSES.map((purpose) => {
            const row = this.latest(farmer.id, purpose)
            return {
              purpose,
              granted: row?.granted ?? false,
              granted_via: row?.granted_via ?? null,
              text_version: row?.text_version ?? null,
              recorded_at: row?.recorded_at ?? null,
            }
          }),
        },
      ]
    }
    if (m[2] === '/documents') {
      const documents = this.documents.filter((d) => d.farmer_id === farmer.id)
      return [200, { farmer_id: farmer.id, documents: documents.map((d) => this.docOut(d)) }]
    }
    return [
      200,
      {
        ...this.summary(farmer),
        first_name: farmer.first_name,
        last_name: farmer.last_name,
        email: farmer.email,
        address: farmer.address,
        user_id: farmer.user_id,
        has_email: farmer.email !== null,
        phone_verified_at: farmer.phone_verified_at,
        email_verified_at: farmer.email_verified_at,
        documents_count: this.documents.filter((d) => d.farmer_id === farmer.id).length,
        apiaries_count: this.apiaries.filter((a) => a.farmer_id === farmer.id).length,
      },
    ]
  }

  /** `POST /v2/farmers`, in the server's order: role, password, phone, consent. */
  private enrol(user: FakeUser, body: Json): Reply {
    if (!FARMER_STAFF.includes(user.role)) return [403, { code: 'forbidden', message: 'No' }]
    if (String(body.password ?? '').length < 8) {
      return [422, { code: 'password_too_short', message: 'Too short', details: { min_length: 8 } }]
    }
    const phone = String(body.phone)
    if (this.users.has(phone) || this.farmers.some((f) => f.phone === phone)) {
      return [409, { code: 'phone_taken', message: 'A user with this phone already exists' }]
    }
    if (body.consent_granted !== true) return consentRequired()
    const farmer = this.seedFarmer(
      {
        first_name: String(body.first_name),
        last_name: String(body.last_name),
        phone,
        email: (body.email as string | null) ?? null,
        address: (body.address as string | null) ?? null,
        number_of_hives: (body.number_of_hives as number | null) ?? null,
        enrolled_by: user.id,
        created_at: naive(this.now()),
      },
      { password: String(body.password) },
    )
    this.users.get(phone)!.mustChange = true
    // seedFarmer records the required consent; this one names the wording heard.
    this.consents = this.consents.map((c) =>
      c.farmer_id === farmer.id
        ? { ...c, text_version: String(body.consent_text_version), recorded_at: farmer.created_at }
        : c,
    )
    return [
      201,
      {
        id: farmer.id,
        first_name: farmer.first_name,
        last_name: farmer.last_name,
        phone: farmer.phone,
        user_id: farmer.user_id,
      },
    ]
  }

  /** `POST /consents`: the farmer's own withdrawal is theirs alone to undo. */
  private recordConsent(user: FakeUser, farmerId: number, body: Json): Reply {
    const bad = extra(body, ['purpose', 'granted', 'text_version'])
    if (bad) return bad
    const farmer = this.farmerFor(user, farmerId)
    if (Array.isArray(farmer)) return farmer
    const purpose = String(body.purpose)
    if (purpose === 'data_processing' && body.granted !== true) {
      return [422, { code: 'withdrawal_not_supported', message: 'Use the deletion workflow' }]
    }
    const via = user.role === 'farmer' ? 'farmer_self' : 'onboarder'
    // The farmer's own latest choice, not the newest row (`farmers.py`).
    if (body.granted === true && via === 'onboarder') {
      const own = this.latest(farmer.id, purpose, 'farmer_self')
      if (own && !own.granted) {
        return [
          409,
          {
            code: 'withdrawn_by_farmer',
            message: 'The farmer withdrew this consent themselves; only they can grant it again',
            details: { purpose },
          },
        ]
      }
    }
    const row = this.consent(farmer.id, purpose, body.granted === true, via, naive(this.now()))
    row.text_version = String(body.text_version)
    return [
      201,
      {
        id: row.id,
        purpose,
        granted: row.granted,
        granted_via: via,
        text_version: row.text_version,
        recorded_at: row.recorded_at,
      },
    ]
  }

  /** Send or confirm a contact code (`verifications.py`). */
  private verification(user: FakeUser, farmerId: number, confirm: boolean, body: Json): Reply {
    const bad = extra(body, confirm ? ['channel', 'code'] : ['channel'])
    if (bad) return bad
    const farmer = this.farmerFor(user, farmerId)
    if (Array.isArray(farmer)) return farmer
    const channel = String(body.channel)
    const now = this.now()
    const mine = this.codes.filter((c) => c.farmer_id === farmer.id && c.channel === channel)
    if (!confirm) {
      if (!this.granted(farmer.id, 'data_processing')) return consentRequired()
      const reachable =
        channel === 'sms' ? toE164Ke(farmer.phone) !== null : (farmer.email ?? '').includes('@')
      if (!reachable) {
        return [422, { code: 'invalid_recipient', message: 'No reachable contact on file' }]
      }
      const last = mine.at(-1)
      if (last && now - last.created_at < COOLDOWN_MS) {
        const wait = Math.ceil((last.created_at + COOLDOWN_MS - now) / 1000)
        return [
          429,
          {
            code: 'rate_limited',
            message: 'Too many verification codes requested; try again later',
            details: { retry_after_seconds: wait },
          },
          { 'Retry-After': String(wait) },
        ]
      }
      for (const c of mine) c.done = true
      const code = String(482900 + this.outbound.length + 17)
      this.codes = [
        ...this.codes,
        {
          farmer_id: farmer.id,
          channel,
          code,
          attempts: 0,
          created_at: now,
          expires_at: now + CODE_TTL_MS,
          done: false,
        },
      ]
      this.outbound = [...this.outbound, { farmerId: farmer.id, channel, code }]
      return [
        202,
        {
          channel,
          expires_at: new Date(now + CODE_TTL_MS).toISOString(),
          resend_available_at: new Date(now + COOLDOWN_MS).toISOString(),
        },
      ]
    }
    if (!/^[0-9]{6}$/.test(String(body.code))) {
      return [
        422,
        { detail: [{ type: 'string_pattern_mismatch', loc: ['body', 'code'], msg: 'Bad' }] },
      ]
    }
    const active = mine.filter((c) => !c.done).at(-1)
    if (!active || now >= active.expires_at) {
      return [
        422,
        { code: 'no_active_code', message: 'There is no active code; request a new one' },
      ]
    }
    if (active.attempts >= MAX_ATTEMPTS) {
      return [422, { code: 'code_locked', message: 'Too many wrong attempts; request a new code' }]
    }
    if (active.code !== body.code) {
      active.attempts++
      return [
        422,
        {
          code: 'invalid_code',
          message: 'That code is not correct',
          details: { attempts_remaining: MAX_ATTEMPTS - active.attempts },
        },
      ]
    }
    active.done = true
    const at = naive(now)
    if (channel === 'sms') farmer.phone_verified_at = at
    else farmer.email_verified_at = at
    return [200, { channel, verified_at: new Date(now).toISOString() }]
  }

  /** A multipart upload (`documents.py`): consent, size, type, then the hash. */
  private async upload(user: FakeUser, farmerId: number, form: FormData | null): Promise<Reply> {
    const farmer = this.farmerFor(user, farmerId)
    if (Array.isArray(farmer)) return farmer
    if (!this.granted(farmer.id, 'document_upload')) return consentRequired()
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return [422, { detail: [{ type: 'missing', loc: ['body', 'file'], msg: 'Field required' }] }]
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (bytes.length > MAX_FILE_BYTES) {
      return [413, { code: 'file_too_large', message: 'The file exceeds the size limit' }]
    }
    const contentType = sniff(bytes.subarray(0, 8))
    if (!contentType) {
      return [415, { code: 'unsupported_media_type', message: 'Only PDF, JPEG and PNG' }]
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const hash = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
    const same = this.documents.find((d) => d.farmer_id === farmer.id && d.content_hash === hash)
    if (same) return [200, this.docOut(same)]
    const doc: Doc = {
      id: ++this.seq.doc,
      farmer_id: farmer.id,
      doc_type: String(form?.get('doc_type')),
      content_type: contentType,
      size_bytes: bytes.length,
      original_filename: file.name,
      content_hash: hash,
      scan_status: 'clean',
      uploaded_at: new Date(this.now()).toISOString(),
    }
    this.documents = [...this.documents, doc]
    return [201, this.docOut(doc)]
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

function json(status: number, body: Json, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function consentRequired(): Reply {
  return [422, { code: 'consent_required', message: 'Consent has not been granted' }]
}

/** As the server's `extra="forbid"`: an unknown field is a validation 422. */
function extra(body: Json, allowed: string[]): Reply | null {
  const unknown = Object.keys(body).find((k) => !allowed.includes(k))
  return unknown
    ? [
        422,
        {
          detail: [
            {
              type: 'extra_forbidden',
              loc: ['body', unknown],
              msg: 'Extra inputs are not permitted',
            },
          ],
        },
      ]
    : null
}

function naive(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19)
}

function sniff(head: Uint8Array): string | null {
  for (const [sig, mime] of SIGNATURES) if (sig.every((b, i) => head[i] === b)) return mime
  return null
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
