// Locks the v1 extractBatchId behaviors (ported from
// Apichain-Frontend/apichain-website/src/api/verifyService.js). New tests in
// v2; v1 shipped this logic without direct unit coverage.
import { describe, it, expect } from 'vitest'
import { extractBatchId } from './batchId'

const HEX = '0x' + 'ab'.repeat(32)

describe('extractBatchId', () => {
  it('accepts a bare 64-hex batch id', () => {
    expect(extractBatchId(HEX)).toBe(HEX)
  })
  it('normalizes case to lowercase', () => {
    expect(extractBatchId(HEX.toUpperCase().replace('0X', '0x'))).toBe(HEX)
  })
  it('extracts from a ?b= URL as decoded from a jar QR', () => {
    expect(extractBatchId(`https://apichain.example/scan?b=${HEX}`)).toBe(HEX)
    expect(extractBatchId(`https://apichain.example/scan?x=1&b=${HEX}`)).toBe(HEX)
  })
  it('trims surrounding whitespace', () => {
    expect(extractBatchId(`  ${HEX}\n`)).toBe(HEX)
  })
  it('rejects junk, short hex, and empty input', () => {
    expect(extractBatchId('')).toBeNull()
    expect(extractBatchId(null)).toBeNull()
    expect(extractBatchId(undefined)).toBeNull()
    expect(extractBatchId('not-a-batch')).toBeNull()
    expect(extractBatchId('0x1234')).toBeNull()
  })
})
