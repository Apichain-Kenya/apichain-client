// The QR encoder (13 §10 item 1): its own lazy chunk, loaded only by the label
// and record sheets, never in the console's first load. uqr was chosen by
// measured size: 3.7 KB gzip against qrcode-generator's 7.3 KB (ledger P4b-F).
import { encode } from 'uqr'

/** The quiet zone around a printed code, in modules (ISO/IEC 18004). */
export const QUIET = 4

/** The code's modules, dark = true, with no border. Error correction M:
 *  a jar label gets scuffed, and M still fits a /v/ link in a small code. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'M', boostEcc: false, border: 0 }).data
}

/** An SVG path of the dark modules, offset by the quiet zone, one run of
 *  modules per subpath; and the side of the whole square, in modules. */
export function qrSvg(text: string): { d: string; size: number } {
  const m = qrMatrix(text)
  let d = ''
  m.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (!row[x]) {
        x++
        continue
      }
      const start = x
      while (x < row.length && row[x]) x++
      d += `M${start + QUIET} ${y + QUIET}h${x - start}v1h${start - x}z`
    }
  })
  return { d, size: m.length + QUIET * 2 }
}
