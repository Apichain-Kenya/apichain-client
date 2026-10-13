import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Switch } from 'wouter'

// Kebab-case routes (client CLAUDE.md principle 5). Every surface is its own
// lazy chunk, so the consumer bundle never carries farmer code (12 D13).
const Landing = lazy(() => import('../pages/Landing'))
const NotFound = lazy(() => import('../pages/NotFound'))
const ScanPage = lazy(() => import('../consumer/ScanPage'))
const VerifyPage = lazy(() => import('../consumer/VerifyPage'))
const FarmApp = lazy(() => import('../farm/FarmApp'))
const DesignPage = import.meta.env.DEV ? lazy(() => import('../pages/DesignPage')) : null

function Loading() {
  const { t } = useTranslation()
  return (
    <p role="status" className="page-status">
      {t('app.loading')}
    </p>
  )
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/scan">
          <ScanPage />
        </Route>
        <Route path="/sign-in">
          <FarmApp mode="sign-in" />
        </Route>
        <Route path="/farm" nest>
          <FarmApp mode="farm" />
        </Route>
        <Route path="/v/:publicId">
          <VerifyPage />
        </Route>
        {DesignPage ? <Route path="/design" component={DesignPage} /> : null}
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  )
}
