// Contract guardrail (05 §6.2), client side. Consumes the generated /v2/ping
// type through openapi-fetch. The property accesses on `data` below are the
// guardrail: if the backend renames or drops a field, `npm run typecheck`
// stops compiling here, catching API/client drift in the same review.
import { describe, it, expect } from 'vitest'
import createClient from 'openapi-fetch'

import type { paths } from './schema'

describe('typed API client', () => {
  it('binds the generated /v2/ping response type', async () => {
    const stubFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ service: 'apichain-backend', version: '2.0.0' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    const client = createClient<paths>({ baseUrl: 'http://test', fetch: stubFetch })

    const { data } = await client.GET('/v2/ping')

    // `data` is typed as the generated PingResponse; these accesses are the
    // compile-time contract check.
    expect(data?.service).toBe('apichain-backend')
    expect(data?.version).toBe('2.0.0')
  })
})
