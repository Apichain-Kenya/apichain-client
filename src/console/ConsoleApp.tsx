import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Redirect, Route, Switch, useLocation, useParams } from 'wouter'
import { Layers, Sprout, UserRound, UsersRound } from 'lucide-react'

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
import { FarmersPage, type FarmerNotice, type FarmersView } from './FarmersPage'
import { PeoplePage } from './PeoplePage'
import styles from './ConsoleApp.module.css'

// The staff and admin console (13 §7 step 6): its own lazy chunk, one shell
// for every staff role, with sections by role (03 §5.2). It shares the
// session chunk with the capture app. Precached, so an old shell still finds
// its own console after a deploy; staff still never reopen offline (D15).

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
  // What the People list says after an account is added; kept here because
  // adding and listing are different routes.
  const [notice, setNotice] = useState<string | null>(null)
  // "… is enrolled", shown on that farmer's page after enrolment.
  const [farmerNotice, setFarmerNotice] = useState<FarmerNotice>(null)
  const [location] = useLocation()
  useEffect(() => {
    if (!location.startsWith('/people')) setNotice(null)
    if (!location.startsWith('/farmers')) setFarmerNotice(null)
  }, [location])
  const admin = me.role === 'admin'
  // Farmers belong to field officers and admins (D7); operators and lab
  // officers see a farmer's name on a batch, nothing more.
  const farmers = me.role === 'field_officer' || admin
  // Sections appear by role (13 §4.2): Farmers (P4b-E), People (P4b-D).
  const nav: NavItem[] = [
    { to: '/batches', label: t('console.nav.batches'), icon: Layers },
    ...(farmers ? [{ to: '/farmers', label: t('console.nav.farmers'), icon: Sprout }] : []),
    ...(admin ? [{ to: '/people', label: t('console.nav.people'), icon: UsersRound }] : []),
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
        {farmers ? (
          <Route path="/farmers/*?">
            <FarmersRoute me={me} notice={farmerNotice} setNotice={setFarmerNotice} />
          </Route>
        ) : null}
        {admin ? (
          <Route path="/people">
            <PeoplePage me={me} id={null} notice={notice} setNotice={setNotice} />
          </Route>
        ) : null}
        {admin ? (
          <Route path="/people/:id">
            <PersonRoute me={me} notice={notice} setNotice={setNotice} />
          </Route>
        ) : null}
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

function PersonRoute(props: {
  me: Me
  notice: string | null
  setNotice: (n: string | null) => void
}) {
  const { id } = useParams<{ id: string }>()
  return <PeoplePage {...props} id={id === 'new' ? 'new' : Number(id) || null} />
}

// /farmers, /farmers/new, /farmers/:id, /farmers/:id/verify/:channel and
// /farmers/:id/apiary; anything else goes back to the list.
function FarmersRoute(props: {
  me: Me
  notice: FarmerNotice
  setNotice: (n: FarmerNotice) => void
}) {
  const params = useParams<{ '*'?: string }>()
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const id = Number(parts[0])
  let view: FarmersView | null = null
  if (parts.length === 0) view = { kind: 'list' }
  else if (parts[0] === 'new' && parts.length === 1) view = { kind: 'new' }
  else if (Number.isInteger(id) && id > 0) {
    if (parts.length === 1) view = { kind: 'farmer', id }
    else if (parts[1] === 'apiary' && parts.length === 2) view = { kind: 'apiary', id }
    else if (
      parts[1] === 'verify' &&
      (parts[2] === 'sms' || parts[2] === 'email') &&
      parts.length === 3
    )
      view = { kind: 'verify', id, channel: parts[2] }
  }
  if (!view) return <Redirect to="/farmers" replace />
  return <FarmersPage {...props} view={view} />
}

function BatchRoute({ me }: { me: Me }) {
  const { id } = useParams<{ id: string }>()
  return <BatchesPage me={me} id={Number(id) || null} />
}
