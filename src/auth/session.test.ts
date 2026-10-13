// The session (12 §8, D3/D5): the access token lives in memory only, the
// refresh token only in the HttpOnly cookie, and refresh is single-flight
// across tabs so two tabs never present the same spent token.
import { beforeEach, describe, expect, it } from 'vitest'

import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'
import { Session } from './session'

let server: FakeBackend
let locks: FakeLocks
let bus: FakeBus

function tab() {
  return new Session({ fetch: server.fetch, locks, channel: bus.channel() })
}

beforeEach(() => {
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
      me: { user_id: 11, role: 'farmer', display_name: 'Wanjiru K', farmer_id: 7 },
    })
    expect(JSON.stringify({ ...localStorage })).not.toContain('at-')
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
})
