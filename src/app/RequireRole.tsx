import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Redirect, useLocation, useRouter, useSearch } from 'wouter'

import { ChangePasswordPage } from '../auth/ChangePasswordPage'
import { useSession, type Me } from '../auth/SessionContext'
import { surfaceFor } from '../auth/surface'

// The route-boundary guard (03 §5.2). It hides screens a role cannot use; the
// server's `requires(action)` table is still the enforcement point.
// A person whose password someone else set sees only the change screen, on
// every route, until it is done (13 D5); the server refuses the rest anyway.
export function RequireRole({ roles, children }: { roles: Me['role'][]; children: ReactNode }) {
  const { t } = useTranslation()
  const session = useSession()
  const [location] = useLocation()
  const search = useSearch()
  const { base } = useRouter() // inside the nested /farm router, paths are relative

  if (session.status === 'restoring') {
    return (
      <p role="status" className="page-status">
        {t('app.restoring')}
      </p>
    )
  }
  if (session.status === 'anonymous') {
    const next = encodeURIComponent(base + location + (search ? `?${search}` : ''))
    // `~` makes the path absolute even from inside a nested router.
    return <Redirect to={`~/sign-in?next=${next}`} replace />
  }
  if (!roles.includes(session.me.role)) {
    return (
      <main className="page-status">
        <h1>{t('app.wrongRole.title')}</h1>
        <p>{t('app.wrongRole.body')}</p>
        <p>
          <Link href={`~${surfaceFor(session.me.role)}`}>{t('app.wrongRole.yours')}</Link>
        </p>
      </main>
    )
  }
  if (session.me.must_change_password) return <ChangePasswordPage me={session.me} forced />
  return <>{children}</>
}
