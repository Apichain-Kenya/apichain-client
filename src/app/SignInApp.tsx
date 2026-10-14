import { SignInPage } from '../auth/SignInPage'
import { Providers } from './Providers'
import { outbox, session, sync } from './services'

// `/sign-in`, in the shared session chunk (13 §7 step 2): it no longer loads
// the capture app, so staff never download farmer screens to sign in.
export default function SignInApp() {
  return (
    <Providers session={session} outbox={outbox} sync={sync}>
      <SignInPage />
    </Providers>
  )
}
