# v1-to-v2 porting ledger

One row per ported unit. "Verbatim" means byte-equivalent logic; "adapted"
names what changed and why. Parity evidence is the test that locks the port.
Never reinvent a keeper without reading its v1 original first.

| v1 source (Apichain-Frontend/apichain-website) | v2 destination                 | Verbatim/adapted                                                                                                                                      | Parity evidence                                                          |
| ---------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/api/authenticity.js`                      | `src/api/authenticity.ts`      | Adapted: typed; mapping logic unchanged; consumer-safety contract intact                                                                              | `src/api/authenticity.test.ts` (ported from `authenticity.test.js`)      |
| `src/api/authenticity.test.js`                 | `src/api/authenticity.test.ts` | Verbatim (TS imports)                                                                                                                                 | self                                                                     |
| `src/api/verifyService.js` `extractBatchId`    | `src/api/batchId.ts`           | Adapted: typed, extracted from the axios service; regex logic unchanged. The verify call itself is rebuilt on the generated OpenAPI client in Phase 4 | `src/api/batchId.test.ts` (new; v1 shipped without direct unit coverage) |
| `src/i18n/en.json` (scan + states subset)      | `src/i18n/en.json`             | Adapted: seeded the keeper-consumed keys; Phase 4 grows it. `sw.json` deliberately not ported (English-only v2, plumbing kept)                        | keys referenced by `authenticity.ts`                                     |

Pending Phase 4 ports (read v1 first): `runVerify` scan pattern (camera +
`?b=` paths), jar QR generation (`PackageJarQRs.jsx` pattern), the
place-led consumer hero layout, `isThreeWayVerified` (redesigned for the
Merkle-proof trust model per 03 §6: three states, not two).
