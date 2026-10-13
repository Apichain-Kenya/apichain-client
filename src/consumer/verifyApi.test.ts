import { describe, expect, it } from 'vitest'

import sealed from './__fixtures__/sealed.json'
import { loadVerify } from './verifyApi'

const ID = '9f2c4e7a1b6d8053c2e94fa710bd3e68'
const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })) as typeof fetch

describe('loadVerify', () => {
  it('a live answer is not marked as cached', async () => {
    const r = await loadVerify(ID, respond(200, sealed))
    expect(r).toMatchObject({ kind: 'ok', cachedAt: null })
  })
  it('a fallback from the service worker cache carries its date (D15)', async () => {
    const r = await loadVerify(
      ID,
      respond(200, sealed, { 'X-ApiChain-Cached-At': '2026-10-12T09:00:00.000Z' }),
    )
    expect(r).toMatchObject({ kind: 'ok', cachedAt: '2026-10-12T09:00:00.000Z' })
  })
  it.each([404, 422])('%s is "not found"', async (status) => {
    expect((await loadVerify(ID, respond(status, {}))).kind).toBe('not_found')
  })
  it('a server failure is an error, not "not found"', async () => {
    expect((await loadVerify(ID, respond(500, {}))).kind).toBe('error')
  })
  it('no network and no cache is "offline"', async () => {
    const down = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect((await loadVerify(ID, down)).kind).toBe('offline')
  })
})
