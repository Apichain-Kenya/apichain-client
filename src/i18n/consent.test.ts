// D17: the recorded `text_version` must always name the wording the farmer
// actually heard. A literal table, not a snapshot, so `vitest -u` cannot
// quietly bless new words under an old version.
import { describe, expect, it } from 'vitest'

import { CONSENT_TEXT_VERSION } from './consent'
import en from './en.json'

// One row per wording ever used. To change the words: add a version here
// with the new hash, and set CONSENT_TEXT_VERSION to it. Never edit a row.
const WORDING: Record<string, string> = {
  'en-2026-10': '84f7e54dacf011300645d852a4299ba5c1c111f3502574f1ea17d88aee90e9a9',
}

describe('CONSENT_TEXT_VERSION', () => {
  it('names the consent wording in en.json', async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(en.consent)),
    )
    const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
    expect(
      WORDING[CONSENT_TEXT_VERSION],
      'The consent wording changed: give it a new CONSENT_TEXT_VERSION and add a row here',
    ).toBe(hash)
  })

  it('holds every sentence a farmer is asked to agree to', () => {
    expect(Object.keys(en.consent.purposes).sort()).toEqual([
      'data_processing',
      'document_upload',
      'email_notifications',
      'sms_notifications',
    ])
  })
})
