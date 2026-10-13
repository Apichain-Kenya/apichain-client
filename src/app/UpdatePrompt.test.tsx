// A new version never reloads on its own in the middle of a form (12 §9): it
// waits behind a toast until the person chooses Reload.
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import '../i18n/i18n'
import { UpdatePrompt } from './UpdatePrompt'

describe('UpdatePrompt', () => {
  it('shows nothing until a new version is waiting, then reloads only on request', async () => {
    let needRefresh: () => void = () => {}
    const update = vi.fn()
    const register = (opts: { onNeedRefresh: () => void }) => {
      needRefresh = opts.onNeedRefresh
      return update
    }
    render(<UpdatePrompt register={register} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => needRefresh())
    expect(screen.getByRole('status')).toHaveTextContent('A newer version is ready')
    expect(update).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(update).toHaveBeenCalledWith(true)
  })
})
