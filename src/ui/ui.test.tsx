// Behaviour of the design-system primitives (12 §4.7): labels wired to
// controls, keyboard operation, and state shown by shape + word, never by
// colour alone (WCAG 1.4.1).
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import '../i18n/i18n'
import { Button } from './Button'
import { ChoiceTiles } from './ChoiceTiles'
import { DateChips } from './DateChips'
import { Disclosure } from './Disclosure'
import { Field } from './Field'
import { Journey } from './Journey'
import { Stepper } from './Stepper'
import { SyncBadge, SyncChip } from './Sync'
import { TrustSeal } from './TrustSeal'

describe('Button', () => {
  it('is a real button that reports its busy state', () => {
    render(<Button loading>Save harvest</Button>)
    const b = screen.getByRole('button', { name: 'Save harvest' })
    expect(b).toHaveAttribute('aria-busy', 'true')
    expect(b).toBeDisabled()
  })
})

describe('Field', () => {
  it('labels the control and describes it with hint and error', () => {
    render(
      <Field
        label="Name this apiary"
        hint="Any name you will recognise"
        error="Name it to continue"
      >
        {(p) => <input {...p} />}
      </Field>,
    )
    const input = screen.getByLabelText('Name this apiary')
    expect(input).toHaveAccessibleDescription('Any name you will recognise Name it to continue')
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('Stepper', () => {
  it('steps within bounds and names its buttons', async () => {
    const onChange = vi.fn()
    render(<Stepper label="Number of hives" value={1} min={1} max={3} onChange={onChange} />)
    expect(screen.getByRole('button', { name: /fewer/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /more/i }))
    expect(onChange).toHaveBeenCalledWith(2)
    expect(screen.getByRole('spinbutton', { name: 'Number of hives' })).toHaveValue(1)
  })
})

describe('ChoiceTiles', () => {
  it('is a radio group operable by keyboard', async () => {
    const onChange = vi.fn()
    render(
      <ChoiceTiles
        legend="What honey is it mostly?"
        name="honey"
        value="acacia"
        onChange={onChange}
        options={[
          { value: 'acacia', label: 'Acacia' },
          { value: 'wildflower', label: 'Wildflower' },
        ]}
      />,
    )
    expect(screen.getByRole('group', { name: 'What honey is it mostly?' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Acacia' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Wildflower' }))
    expect(onChange).toHaveBeenCalledWith('wildflower')
  })
})

describe('DateChips', () => {
  it('offers today, yesterday and a date picker', async () => {
    const onChange = vi.fn()
    render(<DateChips legend="When" value="2026-10-13" today="2026-10-13" onChange={onChange} />)
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Yesterday' }))
    expect(onChange).toHaveBeenCalledWith('2026-10-12')
    fireEvent.change(screen.getByLabelText('Pick a date'), { target: { value: '2026-10-01' } })
    expect(onChange).toHaveBeenCalledWith('2026-10-01')
  })
})

describe('TrustSeal', () => {
  it.each([
    ['sealed', 'Checked and publicly sealed'],
    ['sealing', 'Checked. Public seal on its way'],
    ['in_progress', 'Still on its journey'],
    ['mismatch', "This record doesn't match"],
  ] as const)('%s states itself in words, not colour', (state, headline) => {
    render(<TrustSeal state={state} stepsDone={5} />)
    expect(screen.getByRole('heading', { name: headline })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName()
  })

  it('never uses scary words in any state', () => {
    const { container } = render(
      <>
        <TrustSeal state="sealed" stepsDone={6} />
        <TrustSeal state="sealing" stepsDone={6} />
        <TrustSeal state="in_progress" stepsDone={3} />
        <TrustSeal state="mismatch" stepsDone={6} />
      </>,
    )
    expect(container.textContent?.toLowerCase()).not.toMatch(/flagged|suspicious|fake/)
  })
})

describe('Journey', () => {
  it('lists six steps and marks the ones not reached in words', () => {
    render(
      <Journey
        steps={[
          { key: 'CREATED', date: '2026-03-02', word: 'recorded' },
          { key: 'HARVESTED', date: '2026-03-09', word: 'harvested' },
          { key: 'PROCESSED', date: null, word: 'recorded' },
          { key: 'LAB_VERIFIED', date: null, word: 'recorded' },
          { key: 'PACKAGED', date: null, word: 'recorded' },
          { key: 'DISTRIBUTED', date: null, word: 'recorded' },
        ]}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(items[0]).toHaveTextContent('Recorded 2 Mar')
    expect(items[1]).toHaveTextContent('Harvested 9 Mar')
    expect(items[2]).toHaveTextContent('Not yet')
  })
})

describe('Disclosure', () => {
  it('is a native details element, collapsed by default', () => {
    render(<Disclosure summary="How this was checked">body</Disclosure>)
    const details = screen.getByText('How this was checked').closest('details')
    expect(details).not.toHaveAttribute('open')
  })
})

describe('Sync', () => {
  it.each([
    ['local', 'Saved on this phone'],
    ['sending', 'Sending'],
    ['sent', 'Sent'],
    ['attention', 'Needs your attention'],
  ] as const)('badge %s says where the record is', (status, text) => {
    render(<SyncBadge status={status} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('chip counts what is waiting, or says all sent', () => {
    const { rerender } = render(<SyncChip waiting={2} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 waiting to send')
    rerender(<SyncChip waiting={0} />)
    expect(screen.getByRole('status')).toHaveTextContent('All sent')
  })
})

describe('OfflineBanner', () => {
  it('also shows when the network is unreachable though the browser says online', async () => {
    const { OfflineBanner } = await import('./OfflineBanner')
    render(<OfflineBanner unreachable />)
    expect(screen.getByRole('status')).toHaveTextContent("You're offline")
  })
})
