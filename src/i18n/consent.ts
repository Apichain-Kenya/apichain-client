// The version of the consent wording (13 D17, 03 §7). Every consent and every
// enrolment records it, so an audit can say which sentences the farmer heard.
// The words live under `consent` in en.json. Change them and this must change
// too: `consent.test.ts` holds the hash of each version's wording.
export const CONSENT_TEXT_VERSION = 'en-2026-10'
