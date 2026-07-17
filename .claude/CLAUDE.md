# ApiChain v2 — Client (`apichain-client`)

**Student:** Ian Ndolo Mwau (SCT211-0034/2022, JKUAT) | **Supervisor:** Dr. Agnes Mindila
**Scope:** Offline-first PWA (React 19 + Vite + TypeScript): consumer QR verify, farmer capture app, unified staff/admin console.
**Repository:** `github.com/Apichain-Kenya/apichain-client`

For the workspace-wide map, see `../.claude/CLAUDE.md`. Design authority: `../apichain-v2/` docs (03 owns the client design). Do not re-litigate settled decisions; if one looks wrong, surface it.

## Stack (settled, `03` + `05`)

- React 19, Vite, TypeScript strict. NOT Next.js (05 §6.1). Node 22 LTS (`.nvmrc`).
- Vitest + Testing Library. oxlint + Prettier.
- i18next: **English content only, but every user-facing string goes through `t()`** and lives in `src/i18n/en.json`. Never hardcode display text in JSX (v1's mistake).
- API access through the generated OpenAPI client (`src/api/client/`, pinned to a backend contract version). Never hand-write response shapes.
- Phase 4 adds: service worker + IndexedDB outbox + Idempotency-Key replay (the client NEVER hash-chains; the server assigns audit position), Leaflet/MapLibre map capture, role-gated console.

## Key commands

```bash
npm run dev          # against docker-compose backend on localhost:8000
npm test             # vitest
npm run lint && npm run format:check && npm run typecheck
npm run build
npm run generate:api # regenerate src/api/client from the pinned openapi.json
```

## Design principles (do not deviate)

1. **Consumer safety:** `interpretAuthenticity` never surfaces raw scores or the words "flagged"/"suspicious" (locked by `authenticity.test.ts`). Carry this discipline into every consumer-facing surface.
2. **Trust display is three states** (03 §6): publicly anchored (green), recorded + anchor pending (distinct), lifecycle incomplete (amber). Never over-claim during the anchor window.
3. **Kenya-first:** low-end Android, metered data. Small cached shell, code-splitting, no heavy deps without review. WCAG 2.1 AA basics; never color as the only signal.
4. **Porting discipline:** read the v1 original before porting; record every port in `PORTING.md`; commit trailer `V1-Origin: <path>@<sha>`.
5. **Kebab-case routes** (v1's `/Contact Us` smell does not carry over). Route guards at the route boundary, not inside components.

## Phase status

Phase 0 (foundations): scaffold, ported pure keepers, CI. Phase 4 builds the PWA on this base after the backend contract exists (Phases 1-3).
