// A lazy part that fails to load (a chunk gone after a deploy) takes only
// itself down, never the screen around it (P4b-H browser walk).
import { lazy, Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ChunkBoundary } from './ChunkBoundary'

describe('ChunkBoundary', () => {
  it('shows its fallback when a lazy chunk fails, and the rest of the page stays', async () => {
    // React logs the caught error; keep the test output clean.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Gone = lazy(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    )
    render(
      <main>
        <label>
          Apiary name <input />
        </label>
        <ChunkBoundary fallback={<p>The map didn't load.</p>}>
          <Suspense fallback={<p>Loading</p>}>
            <Gone />
          </Suspense>
        </ChunkBoundary>
      </main>,
    )
    expect(await screen.findByText("The map didn't load.")).toBeInTheDocument()
    expect(screen.getByLabelText('Apiary name')).toBeInTheDocument()
    quiet.mockRestore()
  })
})
