// The two consumer routes (12 §10): /scan and /v/:publicId. One verify path
// for both the camera and a typed code, as in v1's `runVerify` (scan.jsx),
// but the camera opens only after a tap, and the link form is /v/<id>.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import '../i18n/i18n'
import sealed from './__fixtures__/sealed.json'
import ScanPage from './ScanPage'
import VerifyPage from './VerifyPage'
import type { VerifyResult } from './verifyApi'

const ID = '9f2c4e7a1b6d8053c2e94fa710bd3e68'

function at(path: string, ui: React.ReactNode, pattern = '/v/:publicId') {
  const memory = memoryLocation({ path, record: true })
  render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <Route path={pattern}>{ui}</Route>
    </Router>,
  )
  return memory
}

describe('ScanPage', () => {
  it('a typed code goes to its jar page', async () => {
    const memory = at('/scan', <ScanPage startCamera={vi.fn()} />, '/scan')
    await userEvent.type(screen.getByLabelText('Code on the label'), ID.toUpperCase())
    await userEvent.click(screen.getByRole('button', { name: 'Check this jar' }))
    expect(memory.history.at(-1)).toBe(`/v/${ID}`)
  })

  it('a typed jar link works too', async () => {
    const memory = at('/scan', <ScanPage startCamera={vi.fn()} />, '/scan')
    await userEvent.type(screen.getByLabelText('Code on the label'), `https://x.example/v/${ID}`)
    await userEvent.click(screen.getByRole('button', { name: 'Check this jar' }))
    expect(memory.history.at(-1)).toBe(`/v/${ID}`)
  })

  it('says plainly when a code is not a jar code', async () => {
    at('/scan', <ScanPage startCamera={vi.fn()} />, '/scan')
    await userEvent.type(screen.getByLabelText('Code on the label'), 'not-a-jar')
    await userEvent.click(screen.getByRole('button', { name: 'Check this jar' }))
    expect(screen.getByRole('alert')).toHaveTextContent("That isn't a jar code.")
  })

  it('does not touch the camera until asked, then follows what it reads', async () => {
    let onRead: (raw: string) => void = () => {}
    const stop = vi.fn()
    const startCamera = vi.fn(async (_video: HTMLVideoElement, read: (raw: string) => void) => {
      onRead = read
      return stop
    })
    const memory = at('/scan', <ScanPage startCamera={startCamera} />, '/scan')
    expect(startCamera).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Use the camera' }))
    expect(startCamera).toHaveBeenCalledOnce()
    onRead(`https://x.example/v/${ID}`)
    await vi.waitFor(() => expect(memory.history.at(-1)).toBe(`/v/${ID}`))
    expect(stop).toHaveBeenCalled()
  })

  it('falls back to typing when the camera is refused', async () => {
    const startCamera = vi.fn(async () => {
      throw new Error('NotAllowedError')
    })
    at('/scan', <ScanPage startCamera={startCamera} />, '/scan')
    await userEvent.click(screen.getByRole('button', { name: 'Use the camera' }))
    expect(await screen.findByText(/camera isn't available/)).toBeInTheDocument()
  })
})

describe('VerifyPage', () => {
  const page = (result: VerifyResult) => at(`/v/${ID}`, <VerifyPage load={async () => result} />)

  it('shows the jar label', async () => {
    page({ kind: 'ok', verify: sealed as never, cachedAt: null })
    expect(
      await screen.findByRole('heading', { name: 'Checked and publicly sealed' }),
    ).toBeInTheDocument()
  })

  it('a code that does not exist says so, with a way back to scanning', async () => {
    page({ kind: 'not_found' })
    expect(
      await screen.findByText("We couldn't find this jar. Check the code and try again."),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Scan another' })).toHaveAttribute('href', '/scan')
  })

  it('offline with nothing cached asks for a connection and offers a retry', async () => {
    page({ kind: 'offline' })
    expect(
      await screen.findByText('Connect to the internet to check this jar.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('an invalid code in the address is "not found", without a request', async () => {
    const load = vi.fn()
    at('/v/xyz', <VerifyPage load={load} />)
    expect(await screen.findByText(/couldn't find this jar/)).toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })
})
