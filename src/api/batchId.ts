// Batch-id extraction for the QR scan flow: accepts a bare 64-hex id or a
// `?b=` URL as decoded from a jar QR. Ported from v1
// Apichain-Frontend/apichain-website/src/api/verifyService.js extractBatchId
// (logic unchanged); the axios verify call is rebuilt on the generated
// OpenAPI client in Phase 4.

const HEX_BATCH_ID = /^0x[0-9a-fA-F]{64}$/
const QUERY_BATCH_ID = /[?&]b=(0x[0-9a-fA-F]{64})/i

export function extractBatchId(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (HEX_BATCH_ID.test(trimmed)) return trimmed.toLowerCase()
  const match = trimmed.match(QUERY_BATCH_ID)
  return match ? match[1].toLowerCase() : null
}
