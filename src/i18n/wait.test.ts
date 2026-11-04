import { describe, expect, it } from 'vitest'

import i18n from './i18n'
import { retryAfterSeconds, waitWords } from './wait'

const t = i18n.t.bind(i18n)

describe('waitWords (P5-B 429s)', () => {
  it('says seconds under a minute and whole minutes, rounded up, above', () => {
    expect(waitWords(t, 1)).toBe('1 second')
    expect(waitWords(t, 45)).toBe('45 seconds')
    expect(waitWords(t, 60)).toBe('1 minute')
    expect(waitWords(t, 61)).toBe('2 minutes')
    expect(waitWords(t, 900)).toBe('15 minutes')
  })

  it('reads a missing or nonsense wait as one minute, never "0 seconds"', () => {
    expect(waitWords(t, undefined)).toBe('1 minute')
    expect(waitWords(t, 0)).toBe('1 minute')
    expect(waitWords(t, Number.NaN)).toBe('1 minute')
  })
})

describe('retryAfterSeconds', () => {
  it('takes the header first, then the body detail', async () => {
    const both = new Response(JSON.stringify({ details: { retry_after_seconds: 9 } }), {
      headers: { 'Retry-After': '30' },
    })
    expect(await retryAfterSeconds(both)).toBe(30)
    const body = new Response(JSON.stringify({ details: { retry_after_seconds: 9 } }))
    expect(await retryAfterSeconds(body)).toBe(9)
    expect(await retryAfterSeconds(new Response('not json'))).toBeUndefined()
  })
})
