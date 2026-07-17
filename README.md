# apichain-client

ApiChain v2 client: offline-first PWA on React 19 + Vite + TypeScript.
Consumer QR verification, farmer capture app, and the unified staff/admin
console for the honey provenance platform (JKUAT FYP, Ian Ndolo Mwau).

Design docs: `../apichain-v2/` (03 owns the client design). v1 reference:
`../_v1-archive/Apichain-Frontend` (see `PORTING.md` for lineage).

## Dev quickstart

```bash
npm install
npm run dev     # http://localhost:5173, expects the backend compose stack on :8000
```

Backend dev stack: `docker compose up` from `../apichain-backend/`.

## Tests and gates

```bash
npm test              # vitest
npm run lint          # oxlint
npm run format:check  # prettier
npm run typecheck     # tsc
npm run build
```

CI runs all of the above plus dependency audit and secret scan on every PR.
The generated OpenAPI client (`src/api/client/`) is pinned to a backend
contract version; regenerating it is an explicit, reviewed bump.
