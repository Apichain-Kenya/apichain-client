// Jar-code extraction for the QR scan flow (12 D10). A v2 jar QR encodes
// `https://<origin>/v/<public_id>`; a shopper may also type the bare code.
// public_id is 32 lowercase hex: 128 random bits (backend models/batch.py),
// so it cannot be guessed or walked.
//
// Adapted from v1 Apichain-Frontend/apichain-website/src/api/verifyService.js
// extractBatchId: the single trim-then-match shape is kept; the id format and
// the link form changed with v2, and v1's `0x` + 64-hex ids are rejected
// because they do not exist in v2.

const PUBLIC_ID = /^[0-9a-f]{32}$/
const JAR_PATH = /(?:^|\/)v\/([0-9a-f]{32})(?:[/?#]|$)/

export function extractPublicId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim().toLowerCase()
  if (PUBLIC_ID.test(trimmed)) return trimmed
  const match = trimmed.match(JAR_PATH)
  return match ? match[1] : null
}
