# Deployment — apichain-client

## Status: staging deployment is DEFERRED (not yet live)

DigitalOcean staging (plan `apichain-v2/07` §9) is **intentionally not activated.**
Cost is deferred and deployment is not the current focus; **`npm run dev` against the
local `docker compose` backend on `localhost:8000` is the dev target.** What lives in
this repo today is the *shape* of the deploy so turning it on later is a checklist,
not a design exercise:

| File | What it is | State |
|------|-----------|-------|
| `.do/app.yaml` | DigitalOcean App Platform static-site spec | Template — backend URL placeholder, untested |
| `.github/workflows/deploy.yml` | CD workflow, push-to-`main` → DO deploy | Inert — deploy job gated on `vars.DEPLOY_ENABLED == 'true'` (unset) |

Both are safe to have committed: CI stays green with no secret set, and nothing
deploys. **Do not treat either file as working infrastructure** until the steps
below are done and verified.

## Why this is already deploy-ready (no rework needed to go live)

- **The build is proven.** CI runs `npm run build` and `docker build` on every push
  (`.github/workflows/ci.yml`), so the static bundle and the nginx image both build.
- **The backend URL is a build-time input, not hardcoded.** `VITE_API_BASE_URL` is
  read by Vite at build and defaulted (overridably) to `localhost:8000` in the
  Dockerfile — the correct pattern. Staging just supplies the real URL.
- **Two deploy paths exist.** Default: DO App Platform static site (free tier, builds
  `dist/`). Alternative: the nginx `Dockerfile` as a container service for full
  staging/prod parity. `app.yaml` uses the static-site path; switch if needed.

## Activation checklist (run when funded + deployment is in scope)

The client is **free tier** on App Platform. Do this together with the backend
(`apichain-backend/DEPLOYMENT.md`) — the client needs the backend's staging URL.

1. **Deploy the backend first** and note its staging URL (`https://…/health` responds).
2. **GitHub secret + variable** (this repo):
   ```bash
   gh secret set DIGITALOCEAN_ACCESS_TOKEN --repo Apichain-Kenya/apichain-client
   gh variable set DEPLOY_ENABLED --body true --repo Apichain-Kenya/apichain-client
   ```
   The variable is the master switch: with it unset, `deploy.yml` skips.
3. **Set the backend URL in `.do/app.yaml`.** Replace
   `https://REPLACE-with-staging-backend-url` with the live backend URL from step 1.
4. **Verify the CD action.** `deploy.yml` uses `digitalocean/app_action/deploy@v2`;
   confirm its current input names (`token`, `app_spec_location`) against the action's
   README before the first run — this workflow has never executed.
5. **First deploy.** Merge a trivial change to `main` (or run via `workflow_dispatch`).
   Watch the Actions run build and publish the static site.
6. **Verify.** Open the App Platform site URL; confirm it loads and reaches the backend
   (the consumer QR verify path is the natural smoke test once Phase 4 ships the PWA).

## Rollback / teardown

- **Pause deploys without deleting anything:** `gh variable set DEPLOY_ENABLED --body false`.
- **Tear down:** delete the static site in the DO console; unset the secret/variable.
  The repo files stay inert, ready to re-activate.
