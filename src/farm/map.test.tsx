// Map polish (13 §11 item 5): the accuracy circle is drawn in the honey
// token, not Leaflet's default blue (#3388ff), and follows the theme.
import { afterEach, describe, expect, it } from 'vitest'
import { render, waitFor } from '@testing-library/react'

import MapPicker from './MapPicker'

const fix = { lat: -0.428713, lon: 36.951247, accuracy: 12 }

afterEach(() => {
  document.documentElement.style.removeProperty('--comb-strong')
})

describe('the accuracy circle', () => {
  it('takes its colour from --comb-strong', async () => {
    document.documentElement.style.setProperty('--comb-strong', '#b87d08')
    const { container } = render(<MapPicker fix={fix} onMove={() => {}} label="Drag the pin" />)
    const ring = await waitFor(() => {
      const p = container.querySelector('path.leaflet-interactive')
      expect(p).not.toBeNull()
      return p!
    })
    expect(ring.getAttribute('stroke')).toBe('#b87d08')
    expect(ring.getAttribute('fill')).toBe('#b87d08')
    expect(container.innerHTML).not.toContain('#3388ff')
  })

  it('reads the token again when the fix moves (a theme change between fixes)', async () => {
    document.documentElement.style.setProperty('--comb-strong', '#b87d08')
    const { container, rerender } = render(
      <MapPicker fix={fix} onMove={() => {}} label="Drag the pin" />,
    )
    await waitFor(() => expect(container.querySelector('path.leaflet-interactive')).not.toBeNull())
    document.documentElement.style.setProperty('--comb-strong', '#f0b53a')
    rerender(<MapPicker fix={{ ...fix, accuracy: 20 }} onMove={() => {}} label="Drag the pin" />)
    await waitFor(() =>
      expect(container.querySelector('path.leaflet-interactive')?.getAttribute('stroke')).toBe(
        '#f0b53a',
      ),
    )
  })
})
