// Consumer-safe interpretation of the lab verdict. Maps it to a display key +
// tone + i18n key, and NEVER surfaces a raw score or scary words. Ported from
// v1 Apichain-Frontend/apichain-website/src/api/authenticity.js: the three
// safe keys and the mapping discipline are unchanged; the input changed in
// P4a-F (12 D9) from v1's ML `authenticity_band` to the rule-based Codex
// verdict v2 actually reports. A `fail` reads "being reviewed": a single
// out-of-limit parameter is a matter for the producer and the lab, not a
// headline for a shopper. The measurements stay in "How this was checked".
// Locked by authenticity.test.ts.

export interface ConformanceLike {
  verdict?: string
  [key: string]: unknown
}

export interface AuthenticityDisplay {
  key: 'consistent' | 'under_review' | 'unknown'
  tone: 'positive' | 'neutral'
  i18n: string
}

export function interpretAuthenticity(
  conformance: ConformanceLike | null | undefined,
): AuthenticityDisplay {
  const verdict = conformance?.verdict
  if (verdict === 'pass')
    return { key: 'consistent', tone: 'positive', i18n: 'scan.authConsistent' }
  if (verdict === 'fail')
    return { key: 'under_review', tone: 'neutral', i18n: 'scan.authUnderReview' }
  return { key: 'unknown', tone: 'neutral', i18n: 'scan.authUnknown' }
}
