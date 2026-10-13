// Guards sit at the route boundary (03 §5.2, client CLAUDE.md principle 5),
// not inside screens. The server still enforces every permission; this only
// keeps people out of screens they cannot use.
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import { SessionContext, type SessionState } from '../auth/SessionContext'
import { RequireRole } from './RequireRole'

function renderAt(path: string, session: SessionState) {
  const memory = memoryLocation({ path, record: true })
  render(
    <SessionContext.Provider value={session}>
      <Router hook={memory.hook} searchHook={memory.searchHook}>
        <Switch>
          <Route path="/farm">
            <RequireRole roles={['farmer']}>
              <p>farmer home</p>
            </RequireRole>
          </Route>
          <Route path="/sign-in">
            <p>sign in page</p>
          </Route>
        </Switch>
      </Router>
    </SessionContext.Provider>,
  )
  return memory
}

const farmer = {
  status: 'signed_in' as const,
  me: { user_id: 1, role: 'farmer' as const, display_name: 'A B', farmer_id: 7 },
}

describe('RequireRole', () => {
  it('sends an anonymous visitor to sign in, remembering where they were going', () => {
    const memory = renderAt('/farm', { status: 'anonymous', me: null })
    expect(screen.getByText('sign in page')).toBeInTheDocument()
    expect(memory.history.at(-1)).toBe('/sign-in?next=%2Ffarm')
  })

  it('lets an allowed role through', () => {
    renderAt('/farm', farmer)
    expect(screen.getByText('farmer home')).toBeInTheDocument()
  })

  it('refuses a signed-in user with the wrong role, saying so', () => {
    renderAt('/farm', {
      status: 'signed_in',
      me: { user_id: 2, role: 'operator', display_name: 'op', farmer_id: null },
    })
    expect(screen.queryByText('farmer home')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /not for your account/i })).toBeInTheDocument()
  })

  it('waits, without flashing the sign-in page, while the session is restoring', () => {
    renderAt('/farm', { status: 'restoring', me: null })
    expect(screen.queryByText('sign in page')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
