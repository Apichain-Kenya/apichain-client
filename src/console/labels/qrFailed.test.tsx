// The QR encoder is a lazy chunk outside the precache. After a deploy, a page
// on the old version can ask for a chunk the server no longer has (P4b-H
// browser walk): the label sheet then says so, and Print stays off, instead
// of "Making the code" for ever.
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'

import inProgress from '../../consumer/__fixtures__/in_progress.json'
import { renderConsole, staff } from '../../test/consoleHarness'

vi.mock('./qr', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})

describe('the label sheet when the encoder will not load', () => {
  it('says the code did not load, and does not offer to print', async () => {
    const env = await staff('operator')
    env.server.verifies = { p3: { ...inProgress, public_id: 'p3' } }
    renderConsole(env, '/batches/4183/labels')
    expect(
      await screen.findByText(
        "The code didn't load. If the app offers an update, take it; otherwise reload the page.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText('Making the code')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /print/i })).toBeDisabled()
  })
})
