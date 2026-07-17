// Consumer-safe interpretation of the /verify `consumer` block. Maps the band
// to a display key + tone + i18n key. NEVER surfaces the raw score or scary
// words. Ported from v1 Apichain-Frontend/apichain-website/src/api/authenticity.js
// (typed; logic unchanged). Locked by authenticity.test.ts.

export interface ConsumerBlock {
  authenticity_band?: string
  [key: string]: unknown
}

export interface AuthenticityDisplay {
  key: 'consistent' | 'under_review' | 'unknown'
  tone: 'positive' | 'neutral'
  i18n: string
}

export function interpretAuthenticity(
  consumer: ConsumerBlock | null | undefined,
): AuthenticityDisplay {
  const band = consumer?.authenticity_band
  if (band === 'consistent')
    return { key: 'consistent', tone: 'positive', i18n: 'scan.authConsistent' }
  if (band === 'under_review')
    return { key: 'under_review', tone: 'neutral', i18n: 'scan.authUnderReview' }
  return { key: 'unknown', tone: 'neutral', i18n: 'scan.authUnknown' }
}
