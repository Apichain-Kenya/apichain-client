import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Switch } from 'wouter'
import { Home, Hexagon, Plus, UserRound } from 'lucide-react'

import { Providers } from '../app/Providers'
import { RequireRole } from '../app/RequireRole'
import { outbox, session, sync } from '../app/services'
import { useSync } from '../app/useSync'
import { useSession, type Me } from '../auth/SessionContext'
import { Snapshots } from '../offline/snapshots'
import { AppShell } from '../ui/AppShell'
import { OfflineBanner } from '../ui/OfflineBanner'
import { SyncChip } from '../ui/Sync'
import { FarmServicesContext, type FarmServices, type Fix } from './FarmServices'
import { HarvestsPage } from './HarvestsPage'
import { RegisterHarvest } from './RegisterHarvest'
import { SavedPage } from './SavedPage'
import { SignInPage } from './SignInPage'
import { ApiariesPage, MePage } from './SimplePages'

// The farmer capture app (12 §11): its own lazy chunk, holding the session,
// the outbox and every farmer screen, so a shopper scanning a jar never
// downloads any of it (12 D13).

function locate(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject({ code: 2 })
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    )
  })
}

let snapshots: Snapshots | null = null

export default function FarmApp({ mode }: { mode: 'sign-in' | 'farm' }) {
  const services = useMemo<FarmServices>(
    () => ({
      session,
      outbox,
      sync,
      snapshots: (snapshots ??= new Snapshots()),
      // The farmer's local calendar day, as YYYY-MM-DD.
      today: () => new Date().toLocaleDateString('en-CA'),
      now: Date.now,
      locate,
      online: () => navigator.onLine,
    }),
    [],
  )
  return (
    <FarmServicesContext.Provider value={services}>
      <Providers session={session} outbox={outbox} sync={sync}>
        {mode === 'sign-in' ? <SignInPage /> : <FarmGate />}
      </Providers>
    </FarmServicesContext.Provider>
  )
}

function FarmGate() {
  const state = useSession()
  return (
    <RequireRole roles={['farmer']}>
      {state.status === 'signed_in' ? <FarmRoutes signedInAs={state.me} /> : null}
    </RequireRole>
  )
}

export function FarmRoutes({ signedInAs: me }: { signedInAs: Me }) {
  const { t } = useTranslation()
  const { waiting, paused } = useSync()

  // Fetch the map chunk while online, so the service worker has it for later
  // (it is not in the precache; 12 §9).
  useEffect(() => {
    if (navigator.onLine) void import('./MapPicker').catch(() => undefined)
  }, [])

  return (
    <AppShell
      nav={[
        { to: '/', label: t('farm.nav.harvests'), icon: Home },
        { to: '/register', label: t('farm.nav.register'), icon: Plus },
        { to: '/apiaries', label: t('farm.nav.apiaries'), icon: Hexagon },
        { to: '/me', label: t('farm.nav.me'), icon: UserRound },
      ]}
      status={<SyncChip waiting={waiting} />}
    >
      <div className="farm-banner">
        <OfflineBanner unreachable={paused === 'offline'} />
      </div>
      <Switch>
        <Route path="/">
          <HarvestsPage me={me} />
        </Route>
        <Route path="/register">
          <RegisterHarvest me={me} />
        </Route>
        <Route path="/saved">
          <SavedPage me={me} />
        </Route>
        <Route path="/apiaries">
          <ApiariesPage me={me} />
        </Route>
        <Route path="/me">
          <MePage me={me} />
        </Route>
      </Switch>
    </AppShell>
  )
}
