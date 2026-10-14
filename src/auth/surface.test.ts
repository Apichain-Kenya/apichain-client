import { describe, expect, it } from 'vitest'

import { landingFor } from './surface'

describe('landingFor', () => {
  it('sends a farmer to the capture app and staff to the console', () => {
    expect(landingFor('farmer', null)).toBe('/farm')
    for (const role of ['field_officer', 'operator', 'lab_officer', 'admin'] as const) {
      expect(landingFor(role, null)).toBe('/console')
    }
  })

  it('honours a next only inside the person’s own app', () => {
    expect(landingFor('farmer', '/farm/register')).toBe('/farm/register')
    expect(landingFor('operator', '/console/batches/4?x=1')).toBe('/console/batches/4?x=1')
    expect(landingFor('operator', '/console?q=B-1')).toBe('/console?q=B-1')
    expect(landingFor('operator', '/farm/register')).toBe('/console')
    expect(landingFor('farmer', '/console/batches/4')).toBe('/farm')
    expect(landingFor('farmer', '/farmfoo')).toBe('/farm')
    expect(landingFor('admin', '//evil.example/console')).toBe('/console')
    expect(landingFor('admin', 'https://evil.example/console')).toBe('/console')
  })
})
