// Locks WCAG 2.1 AA contrast for every text/ground pair the design system
// uses (12 §4.3), in both themes, computed from tokens.css itself. A later
// edit to a token that quietly breaks AA fails here, not in a user's hand.
import { describe, expect, it } from 'vitest'

import css from './tokens.css?raw'

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`missing block ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const body = css.slice(open + 1, end)
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]] = m[2]
  return out
}

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, ground, minimum ratio]. 4.5 for text; 3 for graphics.
const PAIRS: [string, string, number][] = [
  ['ink', 'paper', 4.5],
  ['ink', 'surface', 4.5],
  ['ink-2', 'paper', 4.5],
  ['ink-2', 'surface', 4.5],
  ['comb-ink', 'paper', 4.5],
  ['comb-ink', 'surface', 4.5],
  ['on-ink', 'ink', 4.5],
  ['sealed', 'tint-sealed', 4.5],
  ['sealing', 'tint-sealing', 4.5],
  ['open', 'tint-open', 4.5],
  ['alert', 'tint-alert', 4.5],
  ['ink-2', 'tint-sealed', 4.5],
  ['ink-2', 'tint-sealing', 4.5],
  ['ink-2', 'tint-open', 4.5],
  ['ink-2', 'tint-alert', 4.5],
  ['ink', 'tint-sealing', 4.5],
  ['sealed', 'surface', 4.5],
  ['sealing', 'surface', 4.5],
  ['sealing', 'paper', 4.5],
  ['alert', 'surface', 4.5],
  // Honey that carries meaning (journey markers, progress, selection). The
  // bright --comb is decorative only (brand mark, wax) and is exempt.
  ['comb-strong', 'paper', 3],
  ['comb-strong', 'surface', 3],
]

const light = block(':root {')
const dark = block(":root[data-theme='dark']")

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, tokens) => {
  it.each(PAIRS)('%s on %s meets %s:1', (fg, bg, min) => {
    expect(tokens[fg], `--${fg}`).toBeDefined()
    expect(tokens[bg], `--${bg}`).toBeDefined()
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min)
  })
})

it('the system-dark block matches the explicit dark block', () => {
  expect(block('@media (prefers-color-scheme: dark)')).toEqual(dark)
})
