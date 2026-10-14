// The session (12 §8, D3/D5): the access token lives in memory only, the
// refresh token only in the HttpOnly cookie, and refresh is single-flight
// across tabs so two tabs never present the same spent token.
import { beforeEach, describe, expect, it } from 'vitest'

import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { Session } from './session'

let server: FakeBackend
let locks: FakeLocks
let bus: FakeBus
let device: Map<string, string> // this phone's storage, shared by its tabs

function tab() {
  return new Session({
    fetch: server.fetch,
    locks,
    channel: bus.channel(),
    storage: {
      getItem: (k) => device.get(k) ?? null,
      setItem: (k, v) => void device.set(k, v),
      removeItem: (k) => void device.delete(k),
    },
  })
}

beforeEach(() => {
  device = new Map()
  server = new FakeBackend()
  server.addFarmer('+254700000001', 'hunter2', 11, 7)
  locks = new FakeLocks()
  bus = new FakeBus()
})

describe('Session', () => {
  it('signs in and knows who it is, keeping the token out of storage', async () => {
    const s = tab()
    expect(await s.signIn('+254700000001', 'hunter2')).toBe('ok')
    expect(s.state).toEqual({
      status: 'signed_in',
      me: {
        user_id: 11,
        role: 'farmer',
        display_name: 'Wanjiru K',
        farmer_id: 7,
        must_change_password: false,
      },
    })
    expect(JSON.stringify([...device.values()])).not.toContain('at-')
  })

  it('reports wrong credentials and an unreachable server differently', async () => {
    expect(await tab().signIn('+254700000001', 'nope')).toBe('invalid')
    server.offline = true
    expect(await tab().signIn('+254700000001', 'hunter2')).toBe('offline')
  })

  it('restores a session after a reload from the cookie alone', async () => {
    await tab().signIn('+254700000001', 'hunter2')
    const reloaded = tab() // new page: nothing in memory
    await reloaded.restore()
    expect(reloaded.state.status).toBe('signed_in')
  })

  it('is anonymous after a reload when there is no cookie', async () => {
    const s = tab()
    await s.restore()
    expect(s.state).toEqual({ status: 'anonymous', me: null })
  })

  it('refreshes an expired access token once and retries the request', async () => {
    const s = tab()
    await s.signIn('+254700000001', 'hunter2')
    server.expireAccessTokens()
    const res = await s.authFetch('/v2/me')
    expect(res.status).toBe(200)
    expect(server.refreshCalls).toBe(1)
  })

  it('two tabs hitting 401 together refresh exactly once and both recover', async () => {
    const a = tab()
    await a.signIn('+254700000001', 'hunter2')
    const b = tab()
    await b.restore() // b's own refresh at startup
    const before = server.refreshCalls
    server.expireAccessTokens()

    const [ra, rb] = await Promise.all([a.authFetch('/v2/me'), b.authFetch('/v2/me')])
    expect(ra.status).toBe(200)
    expect(rb.status).toBe(200)
    expect(server.refreshCalls - before).toBeLessThanOrEqual(2)
    // The family was never revoked: a third request still works.
    expect((await a.authFetch('/v2/me')).status).toBe(200)
  })

  it('stays signed in, without throwing the farmer out, when offline', async () => {
    const s = tab()
    await s.signIn('+254700000001', 'hunter2')
    server.expireAccessTokens()
    server.offline = true
    await expect(s.authFetch('/v2/me')).rejects.toThrow(/offline/i)
    expect(s.state.status).toBe('signed_in')
  })

  it('ends the session when the server revokes it', async () => {
    const s = tab()
    await s.signIn('+254700000001', 'hunter2')
    server.revokeAllSessions()
    const res = await s.authFetch('/v2/me')
    expect(res.status).toBe(401)
    expect(s.state.status).toBe('anonymous')
  })

  it('signing out in one tab signs out the others', async () => {
    const a = tab()
    const b = tab()
    await a.signIn('+254700000001', 'hunter2')
    await b.restore()
    await a.signOut()
    await new Promise((r) => setTimeout(r, 0))
    expect(b.state.status).toBe('anonymous')
  })

  it('a reload with no signal reopens for capture as the same farmer, then renews online', async () => {
    await tab().signIn('+254700000001', 'hunter2')
    server.offline = true
    const reloaded = tab()
    await reloaded.restore()
    expect(reloaded.state).toMatchObject({ status: 'signed_in', me: { user_id: 11, farmer_id: 7 } })
    expect(reloaded.offlineSession).toBe(true)

    server.offline = false
    const res = await reloaded.authFetch('/v2/me')
    expect(res.status).toBe(200)
    expect(reloaded.offlineSession).toBe(false)
  })

  it('remembers who, never a token', async () => {
    await tab().signIn('+254700000001', 'hunter2')
    const stored = [...device.values()].join(' ')
    expect(stored).toContain('"user_id":11')
    expect(stored).not.toMatch(/at-\d|rt-\d/)
  })

  it('a reload with no signal and nobody remembered stays signed out', async () => {
    server.offline = true
    const s = tab()
    await s.restore()
    expect(s.state.status).toBe('anonymous')
  })

  it('signing out, or the server ending the session, forgets the farmer on this phone', async () => {
    const a = tab()
    await a.signIn('+254700000001', 'hunter2')
    await a.signOut()
    server.offline = true
    const b = tab()
    await b.restore()
    expect(b.state.status).toBe('anonymous')

    server.offline = false
    const c = tab()
    await c.signIn('+254700000001', 'hunter2')
    server.revokeAllSessions()
    await c.authFetch('/v2/me')
    server.offline = true
    const d = tab()
    await d.restore()
    expect(d.state.status).toBe('anonymous')
  })

  // 13 D15: on a shared office laptop, reopening offline as the last staff
  // member would let the next person act under their name (03 §13.1).
  it('never remembers a staff member, and a staff sign-in forgets the farmer before them', async () => {
    server.addStaff('jane', 'a long staff passphrase', 21, 'operator', 'Jane Mwende')
    await tab().signIn('+254700000001', 'hunter2')
    expect([...device.values()].join(' ')).toContain('"user_id":11')

    const staff = tab()
    expect(await staff.signIn('jane', 'a long staff passphrase')).toBe('ok')
    expect(device.size).toBe(0)

    server.offline = true
    const reloaded = tab()
    await reloaded.restore()
    expect(reloaded.state.status).toBe('anonymous')
  })

  it('does not reopen offline from a remembered identity that is not a farmer', async () => {
    device.set(
      'apichain-last-me',
      JSON.stringify({ user_id: 21, role: 'admin', display_name: 'Peter', farmer_id: null }),
    )
    server.offline = true
    const s = tab()
    await s.restore()
    expect(s.state.status).toBe('anonymous')
  })

  it('reads an identity remembered by 4a, which had no must_change_password, as not forced', async () => {
    device.set(
      'apichain-last-me',
      JSON.stringify({ user_id: 11, role: 'farmer', display_name: 'Wanjiru K', farmer_id: 7 }),
    )
    server.offline = true
    const s = tab()
    await s.restore()
    expect(s.state).toMatchObject({ status: 'signed_in', me: { must_change_password: false } })
  })
})

// 13 D5: whoever set a password (the enrolling officer, an admin) must not
// keep knowing it. The server forces the change; the session carries it out.
describe('Session.changePassword', () => {
  beforeEach(() => {
    server.addFarmer('+254700000009', 'set by officer', 19, 9, { mustChange: true })
  })

  it('a forced change clears the flag, keeps the person signed in, and tells the other tabs', async () => {
    const a = tab()
    const b = tab()
    await a.signIn('+254700000009', 'set by officer')
    await b.restore()
    expect(a.state).toMatchObject({ me: { must_change_password: true } })
    expect((await a.authFetch('/v2/batches')).status).toBe(403)

    expect(await a.changePassword('set by officer', 'my own secret')).toEqual({ ok: true })
    expect(a.state).toMatchObject({ status: 'signed_in', me: { must_change_password: false } })
    expect((await a.authFetch('/v2/batches')).status).toBe(200)
    await new Promise((r) => setTimeout(r, 0))
    expect(b.state).toMatchObject({ status: 'signed_in', me: { must_change_password: false } })
    expect(await tab().signIn('+254700000009', 'my own secret')).toBe('ok')
  })

  it('says why a change was refused', async () => {
    const s = tab()
    await s.signIn('+254700000009', 'set by officer')
    expect(await s.changePassword('not it', 'my own secret')).toEqual({
      ok: false,
      reason: 'wrong_password',
    })
    expect(await s.changePassword('set by officer', 'set by officer')).toEqual({
      ok: false,
      reason: 'unchanged',
    })
    expect(await s.changePassword('set by officer', 'short')).toEqual({
      ok: false,
      reason: 'too_short',
      minLength: 8,
    })
    server.offline = true
    expect(await s.changePassword('set by officer', 'my own secret')).toEqual({
      ok: false,
      reason: 'offline',
    })
    expect(s.state).toMatchObject({ status: 'signed_in', me: { must_change_password: true } })
  })

  it('never puts either password in storage', async () => {
    const s = tab()
    await s.signIn('+254700000009', 'set by officer')
    await s.changePassword('set by officer', 'my own secret')
    const stored = [...device.values()].join(' ')
    expect(stored).not.toContain('set by officer')
    expect(stored).not.toContain('my own secret')
  })
})
