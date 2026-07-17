// i18n plumbing kept deliberately (03 §10): v2 ships English content only,
// but every user-facing string goes through t() so a later locale (Swahili
// first, per the team decision) is a translation drop-in, not a rebuild.
// Key structure ported from v1 Apichain-Frontend/apichain-website/src/i18n/en.json.
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './en.json'

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
