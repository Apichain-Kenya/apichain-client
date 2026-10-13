import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './design/tokens.css'
import './design/base.css'
import './i18n/i18n'
import { AppRoutes } from './app/routes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoutes />
  </StrictMode>,
)
