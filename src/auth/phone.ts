// Kenyan mobile numbers, the backend's way (`phone.to_e164_ke`): `7XXXXXXXX`
// or `1XXXXXXXX` after +254, written with or without the country code or the
// leading 0, and with spaces, dashes, dots or brackets anywhere.
//
// Enrolment stores this form, and the stored phone is the farmer's sign-in
// identifier, matched exactly. So sign-in turns a typed number into the same
// form (ledger, P4b-E). A username starts with a letter, so the two never meet.

const SEPARATORS = /[\s\-().]/g
const FORMS = [/^\+254([17]\d{8})$/, /^254([17]\d{8})$/, /^0([17]\d{8})$/]

/** `+2547XXXXXXXX` / `+2541XXXXXXXX`, or null if it is not a Kenyan mobile. */
export function toE164Ke(raw: string): string | null {
  const compact = raw.replace(SEPARATORS, '')
  for (const form of FORMS) {
    const match = form.exec(compact)
    if (match) return `+254${match[1]}`
  }
  return null
}

/** What sign-in sends: a phone in its stored form, anything else trimmed. */
export function signInIdentifier(typed: string): string {
  const trimmed = typed.trim()
  return toE164Ke(trimmed) ?? trimmed
}

/** "0722 908 114": a Kenyan mobile as people write it, anything else as is. */
export function localPhone(stored: string): string {
  const e164 = toE164Ke(stored)
  if (!e164) return stored
  const n = `0${e164.slice(4)}`
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`
}
