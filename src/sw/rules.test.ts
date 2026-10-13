// What the service worker may cache (12 §9, D11, D15). Only the anonymous
// jar check is ever cached at runtime; nothing authenticated, and never map
// tiles (OpenStreetMap forbids offline use of its tiles).
import { describe, expect, it } from 'vitest'

import { isAppChunk, isCacheableVerify, markCachedFallback, stampStored } from './rules'

const ORIGIN = 'https://apichain.example'
const ID = '9f2c4e7a1b6d8053c2e94fa710bd3e68'
const req = (path: string, method = 'GET') => ({
  url: new URL(path, ORIGIN),
  method,
  sameOrigin: true,
})

describe('isCacheableVerify', () => {
  it('caches the anonymous jar check', () => {
    expect(isCacheableVerify(req(`/v2/public/batches/${ID}/verify`))).toBe(true)
  })
  it.each([
    '/v2/batches',
    `/v2/batches/12`,
    '/v2/me',
    '/v2/apiaries?farmer_id=7',
    `/v2/public/batches/${ID}/anchor-proof`,
    '/v2/auth/refresh',
  ])('never caches %s', (path) => {
    expect(isCacheableVerify(req(path))).toBe(false)
  })
  it('never caches a write, or another origin', () => {
    expect(isCacheableVerify(req(`/v2/public/batches/${ID}/verify`, 'POST'))).toBe(false)
    expect(
      isCacheableVerify({ ...req(`/v2/public/batches/${ID}/verify`), sameOrigin: false }),
    ).toBe(false)
  })
  it('never caches map tiles', () => {
    expect(
      isCacheableVerify({
        url: new URL('https://tile.openstreetmap.org/12/2400/2000.png'),
        method: 'GET',
        sameOrigin: false,
      }),
    ).toBe(false)
  })
})

describe('cached-result marking', () => {
  it('a stored response carries when it was stored, and a fallback says so', async () => {
    const stored = await stampStored(
      new Response('{"state":"DISTRIBUTED"}'),
      Date.parse('2026-10-12T09:00:00Z'),
    )
    expect(stored.headers.get('X-ApiChain-Stored-At')).toBe('2026-10-12T09:00:00.000Z')

    const served = await markCachedFallback(stored)
    expect(served.headers.get('X-ApiChain-Cached-At')).toBe('2026-10-12T09:00:00.000Z')
    expect(await served.json()).toEqual({ state: 'DISTRIBUTED' })
  })
})

describe('isAppChunk', () => {
  it('runtime-caches our own hashed build files, which never change', () => {
    expect(isAppChunk(req('/assets/farm-RegisterHarvest-Ab12Cd34.js'))).toBe(true)
    expect(isAppChunk(req('/assets/qr-scanner-worker.min-Ab12Cd34.js'))).toBe(true)
  })
  it('never anything else', () => {
    expect(isAppChunk(req('/v2/batches'))).toBe(false)
    expect(isAppChunk(req('/index.html'))).toBe(false)
    expect(isAppChunk({ ...req('/assets/x-Ab12Cd34.js'), sameOrigin: false })).toBe(false)
    expect(isAppChunk(req('/assets/x-Ab12Cd34.js', 'POST'))).toBe(false)
  })
})
