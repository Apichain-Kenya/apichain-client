// axe over every primitive in every state (12 §7, acceptance: no violations).
// jsdom cannot compute colour, so contrast is locked separately by
// design/tokens.test.ts; every other rule runs here.
import axe from 'axe-core'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import '../i18n/i18n'
import DesignPage from './DesignPage'

describe('design review page', () => {
  it.each(['light', 'dark'])('has no axe violations (%s)', async (theme) => {
    document.documentElement.dataset.theme = theme
    const { container } = render(<DesignPage />)
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})
