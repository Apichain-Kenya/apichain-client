// Phase 5a acceptance (14 §1, P5-F), client side: the phase's evidence in one
// file. The detailed cases live next to their code:
// - the consent date reads "Turned on 13 Oct" (D6): src/farm/choices.test.tsx;
// - a 429 says how long to wait on sign-in, password change and upload, and
//   invalid_phone has its own message: src/console/{console,farmers}.test.tsx;
// - a list that raced a harvest is read once more: src/farm/register.test.tsx;
// - the CSP is in the built page with no inline exception: the bundle-report
//   gate in CI (it needs the build, which these tests do not run).
import { describe, expect, it } from 'vitest'

import { Session } from '../auth/session'
import en from '../i18n/en.json'
import openapiJson from '../../openapi.json'
import pkgJson from '../../package.json'
import { FakeBackend, FakeBus, FakeLocks } from '../test/fakeBackend'

const pkg = pkgJson as { apichainBackendContract: { commit: string } }
const openapi = openapiJson as unknown as {
  paths: Record<string, Record<string, { responses: Record<string, unknown> }>>
}

describe('Phase 5a acceptance', () => {
  it('the contract is repinned to the 5a backend: 429s on the limited routes, and /health/ops', () => {
    expect(pkg.apichainBackendContract.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(pkg.apichainBackendContract.commit).not.toBe('d089f0c96ef96258a30c132c23676e88dd45ff5f')
    for (const path of ['/v2/auth/login', '/v2/auth/password'])
      expect(Object.keys(openapi.paths[path].post.responses)).toContain('429')
    expect(
      Object.keys(openapi.paths['/v2/farmers/{farmer_id}/documents'].post.responses),
    ).toContain('429')
    expect(openapi.paths['/health/ops']).toBeDefined()
  })

  it('a limited sign-in is told to wait, never that the phone is offline', async () => {
    const server = new FakeBackend()
    server.addFarmer('+254700000001', 'hunter2', 11, 7)
    const session = new Session({
      fetch: server.fetch,
      locks: new FakeLocks(),
      channel: new FakeBus().channel(),
    })
    server.answerNext = {
      path: /\/v2\/auth\/login$/,
      status: 429,
      body: { code: 'rate_limited', message: 'Too many', details: { retry_after_seconds: 900 } },
      headers: { 'Retry-After': '900' },
    }
    expect(await session.signIn('+254700000001', 'hunter2')).toEqual({ rateLimited: 900 })
    expect(await session.signIn('+254700000001', 'hunter2')).toBe('ok') // the window passed
  })

  it('no consent date reads "turned this on on" any more (D6)', () => {
    expect(JSON.stringify(en)).not.toMatch(/turned this (on|off) on/)
  })
})
