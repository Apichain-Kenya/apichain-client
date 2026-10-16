// Bundle budget gate (12 D13). Kenya-first: metered data on low-end Android,
// so budgets are CI gates, not goals. Reads dist/.vite/manifest.json, follows
// static imports from the app entry plus each route's lazy chunk, and sums
// gzip sizes. Fails (exit 1) past a budget. No dependencies: Node zlib only.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST = 'dist'
const KB = 1024
const manifest = JSON.parse(readFileSync(join(DIST, '.vite', 'manifest.json'), 'utf8'))

// Route name -> the source module of its lazy chunk. A route whose module is
// not built yet is reported as "not built", not failed.
const ROUTES = {
  consumer: { module: 'src/consumer/VerifyPage.tsx', budget: 110 * KB },
  farmer: { module: 'src/farm/FarmApp.tsx', budget: 150 * KB },
  console: { module: 'src/console/ConsoleApp.tsx', budget: 160 * KB }, // 13 D14
}
const FONT_BUDGET = 70 * KB

const gz = (file) => gzipSync(readFileSync(join(DIST, file))).length
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry)

function staticClosure(key, seen = new Set()) {
  if (!key || seen.has(key)) return seen
  seen.add(key)
  for (const dep of manifest[key].imports ?? []) staticClosure(dep, seen)
  return seen
}

const entryFiles = staticClosure(entryKey)
const sizeOf = (keys) =>
  [...keys].reduce(
    (sum, k) => sum + (manifest[k].file.endsWith('.js') ? gz(manifest[k].file) : 0),
    0,
  )

const rows = []
let failed = false
const entrySize = sizeOf(entryFiles)
rows.push(['app entry (shared)', entrySize, null])
for (const [name, { module, budget }] of Object.entries(ROUTES)) {
  if (!manifest[module]) {
    rows.push([`${name} route`, null, budget])
    continue
  }
  const keys = staticClosure(module, new Set(entryFiles))
  const total = sizeOf(keys)
  rows.push([`${name} route (initial JS)`, total, budget])
  if (total > budget) failed = true
}

// The shared session chunk (13 §7 step 2): reported on its own, and never in
// the jar page's closure, since a shopper never signs in (12 D13).
const sessionKey = Object.keys(manifest).find((k) => /^assets\/session-/.test(manifest[k].file))
const consumerClosure = staticClosure(ROUTES.consumer.module, new Set(entryFiles))
const sessionChecks = [
  ['session chunk is built', Boolean(sessionKey)],
  ['the app entry does not load the session', !entryFiles.has(sessionKey)],
  ['the jar page does not load the session', !consumerClosure.has(sessionKey)],
]
if (sessionKey) rows.push(['session chunk (farmer and console)', sizeOf([sessionKey]), null])
for (const [, ok] of sessionChecks) if (!ok) failed = true

const assets = join(DIST, 'assets')
const fonts = readdirSync(assets)
  .filter((f) => f.endsWith('.woff2'))
  .reduce((sum, f) => sum + statSync(join(assets, f)).size, 0)
rows.push(['fonts (woff2, all)', fonts, FONT_BUDGET])
if (fonts > FONT_BUDGET) failed = true

// The service worker precache (12 §9): offline capture needs the farmer app
// chunk after an update; the online-only map must not be downloaded up front.
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8')
const precached = (re) => re.test(sw)
const precacheChecks = [
  ['precache holds the farmer app', precached(/assets\/farm-FarmApp-[^"]+\.js/)],
  ['precache leaves out the map', !precached(/assets\/farm-MapPicker-/)],
  ['precache leaves out the QR fallback', !precached(/assets\/qr-scanner/)],
  ['precache holds the session', precached(/assets\/session-[^"]+\.js/)],
  ['precache holds the console', precached(/assets\/console-ConsoleApp-[^"]+\.js/)],
]
for (const [, ok] of precacheChecks) if (!ok) failed = true

const fmt = (n) => (n === null ? 'not built' : `${(n / KB).toFixed(1)} KB`)
console.log('| Budget item | Size (gzip) | Budget |\n|---|---:|---:|')
for (const [label, size, budget] of rows) {
  const over = size !== null && budget !== null && size > budget ? ' **OVER**' : ''
  console.log(`| ${label} | ${fmt(size)}${over} | ${budget === null ? '-' : fmt(budget)} |`)
}
for (const [label, ok] of [...sessionChecks, ...precacheChecks])
  console.log(`| ${label} | ${ok ? 'yes' : '**NO**'} | required |`)
if (failed) {
  console.error('\nBundle budget exceeded (12 D13).')
  process.exit(1)
}
