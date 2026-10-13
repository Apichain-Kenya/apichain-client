import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'

import './design/tokens.css'
import './design/base.css'
import './i18n/i18n'
import { AppRoutes } from './app/routes'
import { UpdatePrompt } from './app/UpdatePrompt'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* No session here: a shopper scanning a jar never needs one, and must not
        pay for it (12 D13). The farmer routes mount their own (src/farm). */}
    <AppRoutes />
    <UpdatePrompt register={registerSW} />
  </StrictMode>,
)
