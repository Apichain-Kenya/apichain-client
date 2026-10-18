// The console against the in-memory backend, serving the backend's own console
// fixtures: one batch per state after CREATED, ids 4180-4184, codes
// B-000000 to B-000004 (harvested, processed, lab tested, packed, sent).
import 'fake-indexeddb/auto'
import { render } from '@testing-library/react'
import { expect, vi } from 'vitest'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { Providers } from '../app/Providers'
import { Session } from '../auth/session'
import distributed from '../console/__fixtures__/distributed.json'
import harvested from '../console/__fixtures__/harvested.json'
import labVerified from '../console/__fixtures__/lab_verified.json'
import packaged from '../console/__fixtures__/packaged.json'
import processed from '../console/__fixtures__/processed.json'
import { ConsoleGate } from '../console/ConsoleApp'
import { Outbox } from '../offline/outbox'
import { SyncRunner } from '../offline/runner'
import { FakeBackend, FakeBus, FakeLocks } from './fakeBackend'

type Json = Record<string, unknown>
export type StaffRole = 'operator' | 'lab_officer' | 'admin' | 'field_officer'
export const STAFF_PW = 'a long staff passphrase'
let n = 0

export function seed(server: FakeBackend) {
  server.batchDetails = [harvested, processed, labVerified, packaged, distributed].map((b, i) => ({
    ...(b as Json),
    id: 4180 + i,
    batch_code: `B-00000${i}`,
    public_id: `p${i}`,
  }))
}

export async function staff(
  role: StaffRole,
  opts: { mustChange?: boolean; isRoot?: boolean; name?: string } = {},
) {
  const server = new FakeBackend()
  server.addStaff('jane', STAFF_PW, 21, role, opts.name ?? 'Jane Mwende', opts)
  seed(server)
  const locks = new FakeLocks()
  const session = new Session({
    fetch: server.fetch,
    locks,
    channel: new FakeBus().channel(),
    storage: null,
  })
  expect(await session.signIn('jane', STAFF_PW)).toBe('ok')
  const outbox = new Outbox(`console-test-${++n}-${Math.random()}`, locks)
  return { server, session, outbox, sync: new SyncRunner(outbox, session) }
}

export type Env = Awaited<ReturnType<typeof staff>>

export function renderConsole(env: Env, path: string) {
  const memory = memoryLocation({ path, record: true })
  const utils = render(
    <Providers session={env.session} outbox={env.outbox} sync={env.sync}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <ConsoleGate />
      </Router>
    </Providers>,
  )
  return { memory, ...utils }
}

export function wide(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('min-width: 1024px'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}
