// The jar check request, through the generated client so the response shape
// is the backend's contract (05 §6.2). Same origin (12 D4).
import createClient from 'openapi-fetch'

import type { paths } from '../api/client/schema'
import type { VerifyResponse } from './trustState'

export type VerifyResult =
  | { kind: 'ok'; verify: VerifyResponse; cachedAt: string | null }
  | { kind: 'not_found' }
  | { kind: 'offline' }
  | { kind: 'error' }

export async function loadVerify(
  publicId: string,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
): Promise<VerifyResult> {
  // The page's own origin: same-origin by construction (12 D4).
  const client = createClient<paths>({ baseUrl: window.location.origin, fetch: fetchImpl })
  try {
    const { data, response } = await client.GET('/v2/public/batches/{public_id}/verify', {
      params: { path: { public_id: publicId } },
    })
    if (data) {
      // Set by the service worker only when the network failed and the cache
      // answered (src/sw/rules.ts), so the page can date the answer (D15).
      return { kind: 'ok', verify: data, cachedAt: response.headers.get('X-ApiChain-Cached-At') }
    }
    if (response.status === 404 || response.status === 422) return { kind: 'not_found' }
    return { kind: 'error' }
  } catch {
    return { kind: 'offline' }
  }
}
