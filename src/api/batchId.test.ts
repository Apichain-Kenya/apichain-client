// Locks jar-code extraction for the QR scan flow (12 D10). v2 jars carry
// `https://<origin>/v/<public_id>`, where public_id is 32 lowercase hex (128
// random bits, backend models/batch.py). v1's `0x` + 64-hex on-chain ids do
// not resolve against v2, so they are rejected rather than half-supported.
import { describe, it, expect } from 'vitest'
import { extractPublicId } from './batchId'

const ID = '9f2c4e7a1b6d8053c2e94fa710bd3e68'

describe('extractPublicId', () => {
  it('accepts a bare 32-hex public id', () => {
    expect(extractPublicId(ID)).toBe(ID)
  })
  it('normalizes case to lowercase', () => {
    expect(extractPublicId(ID.toUpperCase())).toBe(ID)
  })
  it('extracts from the jar URL a QR decodes to', () => {
    expect(extractPublicId(`https://apichain.example/v/${ID}`)).toBe(ID)
    expect(extractPublicId(`https://apichain.example/v/${ID}/`)).toBe(ID)
    expect(extractPublicId(`https://apichain.example/v/${ID}?utm=x`)).toBe(ID)
  })
  it('extracts from a relative /v/ path', () => {
    expect(extractPublicId(`/v/${ID}`)).toBe(ID)
  })
  it('trims surrounding whitespace', () => {
    expect(extractPublicId(`  ${ID}\n`)).toBe(ID)
  })
  it('rejects v1 on-chain ids and ?b= links', () => {
    const v1 = '0x' + 'ab'.repeat(32)
    expect(extractPublicId(v1)).toBeNull()
    expect(extractPublicId(`https://apichain.example/scan?b=${v1}`)).toBeNull()
  })
  it('rejects junk, wrong lengths, and empty input', () => {
    expect(extractPublicId('')).toBeNull()
    expect(extractPublicId(null)).toBeNull()
    expect(extractPublicId(undefined)).toBeNull()
    expect(extractPublicId('not-a-jar')).toBeNull()
    expect(extractPublicId(ID.slice(1))).toBeNull()
    expect(extractPublicId(ID + 'a')).toBeNull()
    expect(extractPublicId(`https://apichain.example/v/${ID}a`)).toBeNull()
  })
})
