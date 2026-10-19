import { describe, expect, it } from 'vitest'

import { localPhone, signInIdentifier, toE164Ke } from './phone'

// The backend's own cases (`phone.to_e164_ke`), so enrolment stores the form
// a send will accept, and sign-in finds it however the farmer types it.
describe('toE164Ke', () => {
  it.each([
    ['+254712345678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['0712345678', '+254712345678'],
    ['0712 345 678', '+254712345678'],
    ['0712-345-678', '+254712345678'],
    ['(0712) 345.678', '+254712345678'],
    ['0112345678', '+254112345678'],
  ])('%s is %s', (raw, e164) => {
    expect(toE164Ke(raw)).toBe(e164)
  })

  it.each([
    '',
    '0812345678',
    '071234567',
    '07123456789',
    '+255712345678',
    'jmwende',
    '0712_345678',
  ])('%j is not a Kenyan mobile', (raw) => {
    expect(toE164Ke(raw)).toBeNull()
  })
})

describe('signInIdentifier', () => {
  it('turns a Kenyan mobile into the stored form, and leaves a username alone', () => {
    expect(signInIdentifier(' 0745 220 961 ')).toBe('+254745220961')
    expect(signInIdentifier('mkamau')).toBe('mkamau')
    expect(signInIdentifier(' jane ')).toBe('jane')
  })
})

describe('localPhone', () => {
  it('shows a stored number the way a Kenyan writes it, and anything else as it is', () => {
    expect(localPhone('+254722908114')).toBe('0722 908 114')
    expect(localPhone('0722908114')).toBe('0722 908 114')
    expect(localPhone('+255712345678')).toBe('+255712345678')
  })
})
