import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import './design/tokens.css'
import './design/base.css'
import './i18n/i18n'
import { Providers } from './app/Providers'
import { AppRoutes } from './app/routes'
import { UpdatePrompt } from './app/UpdatePrompt'
import { outbox, session, sync } from './app/services'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers session={session} outbox={outbox} sync={sync}>
      <AppRoutes />
      <UpdatePrompt register={registerSW} />
    </Providers>
  </StrictMode>,
)
