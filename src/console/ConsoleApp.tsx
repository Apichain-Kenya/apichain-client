import { useTranslation } from 'react-i18next'
import { Redirect, Route, Switch, useParams } from 'wouter'
import { Layers, UserRound } from 'lucide-react'

import { Providers } from '../app/Providers'
import { RequireRole } from '../app/RequireRole'
import { outbox, session, sync } from '../app/services'
import { useSync } from '../app/useSync'
import { ChangePasswordPage } from '../auth/ChangePasswordPage'
import { useSession, type Me } from '../auth/SessionContext'
import { AppShell, type NavItem } from '../ui/AppShell'
import { OfflineBanner } from '../ui/OfflineBanner'
import { SyncChip } from '../ui/Sync'
import { BatchesPage } from './BatchesPage'
import { ConsoleMePage } from './ConsoleMePage'
import styles from './ConsoleApp.module.css'

// The staff and admin console (13 §7 step 6): its own lazy chunk, one shell
// for every staff role, with sections by role (03 §5.2). It shares the
// session chunk with the capture app. Not in the service worker precache:
// staff do not reopen offline (D15), and shoppers should not pay for it.

const STAFF: Me['role'][] = ['field_officer', 'operator', 'lab_officer', 'admin']

export default function ConsoleApp() {
  return (
    <Providers session={session} outbox={outbox} sync={sync}>
      <ConsoleGate />
    </Providers>
  )
}

export function ConsoleGate() {
  const state = useSession()
  return (
    <RequireRole roles={STAFF}>
      {state.status === 'signed_in' ? <ConsoleRoutes me={state.me} /> : null}
    </RequireRole>
  )
}

export function ConsoleRoutes({ me }: { me: Me }) {
  const { t } = useTranslation()
  const { waiting, paused } = useSync()
  // Sections appear by role (13 §4.2). Farmers (field officers, admins) and
  // People (admins) arrive with their work packages.
  const nav: NavItem[] = [
    { to: '/batches', label: t('console.nav.batches'), icon: Layers },
    { to: '/me', label: t('console.nav.me'), icon: UserRound },
  ]
  return (
    <AppShell
      desk
      nav={nav}
      account={{ name: me.display_name, role: t(`console.roles.${me.role}`) }}
      status={<SyncChip waiting={waiting} />}
    >
      <div className={styles.banner}>
        <OfflineBanner unreachable={paused === 'offline'} message={t('console.offlineBanner')} />
      </div>
      <Switch>
        <Route path="/">
          <Redirect to="/batches" replace />
        </Route>
        <Route path="/batches">
          <BatchesPage me={me} id={null} />
        </Route>
        <Route path="/batches/:id">
          <BatchRoute me={me} />
        </Route>
        <Route path="/me">
          <ConsoleMePage me={me} />
        </Route>
        <Route path="/password">
          <ChangePasswordPage me={me} forced={false} />
        </Route>
        <Route>
          <Redirect to="/batches" replace />
        </Route>
      </Switch>
    </AppShell>
  )
}

function BatchRoute({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>()
  return <BatchesPage me={me} id={Number(id) || null} />
}
