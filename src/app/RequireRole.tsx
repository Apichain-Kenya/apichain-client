import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Redirect, useLocation, useSearch } from 'wouter'

import { useSession, type Me } from '../auth/SessionContext'

// The route-boundary guard (03 §5.2). It hides screens a role cannot use; the
// server's `requires(action)` table is still the enforcement point.
export function RequireRole({ roles, children }: { roles: Me['role'][]; children: ReactNode }) {
  const { t } = useTranslation()
  const session = useSession()
  const [location] = useLocation()
  const search = useSearch()

  if (session.status === 'restoring') {
    return (
      <p role="status" className="page-status">
        {t('app.restoring')}
      </p>
    )
  }
  if (session.status === 'anonymous') {
    const next = encodeURIComponent(location + (search ? `?${search}` : ''))
    return <Redirect to={`/sign-in?next=${next}`} replace />
  }
  if (!roles.includes(session.me.role)) {
    return (
      <main className="page-status">
        <h1>{t('app.wrongRole.title')}</h1>
        <p>{t('app.wrongRole.body')}</p>
      </main>
    )
  }
  return <>{children}</>
}
