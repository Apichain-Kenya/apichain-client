// The service worker's caching rules, as pure functions so they are tested
// (12 §9). Precaching covers the app shell, route chunks, fonts and the
// English strings. At runtime the worker caches exactly one thing: the
// anonymous jar check, so a shopper re-opening a jar's page with no signal
// sees the last result, dated (D15). Nothing authenticated is ever cached,
// and map tiles never are (D11): OpenStreetMap forbids offline tile use.

export type RouteRequest = { url: URL; method: string; sameOrigin: boolean }

const VERIFY = /^\/v2\/public\/batches\/[0-9a-f]{32}\/verify$/

export function isCacheableVerify({ url, method, sameOrigin }: RouteRequest): boolean {
  return sameOrigin && method === 'GET' && VERIFY.test(url.pathname)
}

// Vite's hashed build output: immutable, so cache-first is always correct.
// The precache holds the shell, the consumer and farmer app chunks and the
// fonts; only the online-only map (Leaflet) and the QR fallback are left out
// and cached here on first use (12 §9, pre-merge review).
const ASSET = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css|woff2)$/

export function isAppChunk({ url, method, sameOrigin }: RouteRequest): boolean {
  return sameOrigin && method === 'GET' && ASSET.test(url.pathname)
}

const STORED = 'X-ApiChain-Stored-At'
const CACHED = 'X-ApiChain-Cached-At'

/** Before caching: record when this answer was fetched. */
export async function stampStored(res: Response, now: number): Promise<Response> {
  const headers = new Headers(res.headers)
  headers.set(STORED, new Date(now).toISOString())
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/**
 * When the network failed and the cache answers: say so, and when it was
 * stored, so the page can show "Checked on 12 Oct" instead of passing an old
 * answer off as live (D15).
 */
export async function markCachedFallback(res: Response): Promise<Response> {
  const headers = new Headers(res.headers)
  const stored = headers.get(STORED)
  if (stored) headers.set(CACHED, stored)
  return new Response(await res.arrayBuffer(), {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}
