# Local development

## Prerequisites

- Node.js 24 (see `.node-version`)
- Corepack and pnpm 11.16.0
- Python 3.12

## Install

From the repository root:

```bash
corepack pnpm install --frozen-lockfile
cp .env.example apps/web/.env.local
```

Create the Python environment:

```bash
cd apps/profile-engine
python -m venv .venv
python -m pip install --require-hashes -r requirements-dev.lock
python -m pip install --no-deps -e .
```

On PowerShell, use the corresponding `./.venv/Scripts/python.exe -m pip ...` commands if the environment is not activated. Regenerate either lock only in a reviewed dependency-update change; ordinary installs must keep hash verification enabled.

After changing a direct Python pin, regenerate both lock files and run `python scripts/check_dependency_locks.py`. CI rejects a pyproject/lock mismatch before installing anything.

## Run

Terminal one, from `apps/profile-engine`:

```bash
python3 -m uvicorn profile_engine.main:app --reload --port 8000
```

Terminal two, from the repository root:

```bash
corepack pnpm dev
```

Open `http://localhost:3000`. The example configuration explicitly sets `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, and `APP_ENV=development`. All three policy conditions are required; profiles/readings/reports remain encrypted in process memory and disappear on restart. Never carry `ALLOW_LOCAL_RUNTIME_ADAPTER` into a hosted context.

To exercise **Free Reading**, generate a distinct local guest key and place it in the uncommitted `apps/web/.env.local` as `GUEST_TRIAL_SECRET`:

```bash
openssl rand -base64 32
```

The value must be canonical base64 for exactly 32 random bytes. Do not reuse `DATA_ENCRYPTION_KEY` or commit the generated value. The domain-separated fallback used by genuine Netlify preview and production builds is build-bound to those contexts and deliberately unavailable to ordinary local development; do not imitate it by copying the data key into `GUEST_TRIAL_SECRET`. Missing or malformed local configuration leaves the landing page available while the guest eligibility endpoint returns `503`; account signup and authenticated flows remain independent.

The local-only adapter accepts any valid email and 12–72 character password through the production-shaped forms, but deliberately does not persist or validate the password. It exists for deterministic development and E2E flows only. Supabase mode performs the real credential verification.

`READING_FOLLOW_UP_LIMIT` defaults to `1` and is bounded to 0–10. `READING_REREAD_COOLDOWN_MINUTES` defaults to `30` and is bounded to 0–1440; `0` disables only the same-question cooldown. `READING_ACCESS_MODE=unlimited` preserves the local fallback; `free-window` uses the bounded allowance/window values in `.env.example`. In Supabase mode, the seeded published runtime configuration supersedes these fallbacks and can be changed only through the governed operator workflow. `READING_SESSION_TTL_MINUTES` controls explicit locked-session expiry. The repeat check normalizes Unicode, case, whitespace, and punctuation, then links to the retained reading without drawing new cards. Motion/sound preferences use account settings with local fallback; durable adapters persist monotonic cut/reveal progress on the reading, with per-reading session storage only as a fallback.

Detailed report generation is outside the safe-beta surface. To exercise the credential-free local adapter, set `ENABLE_PROFILE_REPORTS=true`; the server returns the effective capability to the UI, so there is no separate public authorization flag. `PAYMENTS_PROVIDER=local` fulfills synchronously only when `APP_ENV`, `RUNTIME_ADAPTER`, and `ALLOW_LOCAL_RUNTIME_ADAPTER` also authorize the non-hosted local development/test runtime. Missing, invalid, or hosted-local payment selections fail closed. The adapter renders the same title-only preview, 17 structured sections, unavailable-system labels, provenance, report history, and authenticated tagged PDF as the durable path. It is a test aid, not payment evidence or independent PDF-accessibility evidence. Keep the flag false in staging unless running the separately approved commerce rehearsal.

To exercise the durable adapter locally, change only `RUNTIME_ADAPTER` to `supabase` and configure the Supabase variables through an uncommitted `.env.local`. The app will fail closed if any required database, Auth, or encryption setting is absent. In Stripe test mode, Checkout stages an encrypted minimized report source on the pending order; a verified paid webhook atomically creates the entitlement, pending report, and `report_jobs` row. Run the authenticated internal drain (normally the every-minute Netlify function) to generate sections. Refreshing the return route resumes or polls the same purchase; it does not create a second order or require the profile snapshot to still exist.

If `PROFILE_ENGINE_SHARED_SECRET` is set for FastAPI, configure the identical value for Next.js. Health remains public at `http://127.0.0.1:8000/health`; calculation requires the bearer secret.

Web `/api/health` is liveness only. Deep `/api/health?readiness=1` probes protected configuration and dependencies and requires a domain-separated HMAC bearer derived from the dedicated `READINESS_PROBE_SECRET` as documented in [Deployment](DEPLOYMENT.md). Keep it distinct from `PROFILE_ENGINE_SHARED_SECRET` and `INTERPRETATION_WORKER_SECRET`; do not expose deep readiness through a public uptime monitor.

Reading audio remains unavailable by default. To exercise it locally, set `READING_AUDIO_PROVIDER=fish-audio` plus a server-only `FISH_AUDIO_API_KEY`, an explicit supported `FISH_AUDIO_MODEL`, and a `FISH_AUDIO_REFERENCE_ID` for a voice you have permission to use. Sign in and open a fully revealed reading. Turn on **Audio reading** in Sound layers; this only reveals **Play audio**. The first Fish request must not appear until Play is pressed. Inspect the network panel to confirm each later `/audio` request begins only after the prior passage finishes and that the compact reading window advances to that passage. The timestamp stream should reveal words in step with playback and add an aura only to the card positions referenced by the active passage. Reload and replay the generated reading to confirm its sections come from origin-scoped Cache Storage entries without repeat `/audio` requests. Browser eviction, a failed decode retry, or clearing site data legitimately causes regeneration. Never use production credentials in `.env.local` screenshots, fixtures, or test output.

## Verify

```bash
corepack pnpm format:check
corepack pnpm requirements:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm db:check
corepack pnpm build
corepack pnpm test:e2e
corepack pnpm audit --prod --audit-level high
```

From `apps/profile-engine`:

```bash
pytest
ruff check .
mypy .
```

Playwright starts both FastAPI and Next.js and leaves external AI/Stripe/Supabase disabled. `pnpm test:e2e` runs desktop and Pixel-sized Chromium. The full local cross-browser command also runs desktop Firefox, then three fresh-process serial WebKit shards so long-lived WebKit contexts cannot accumulate in one worker. CI runs the same project coverage as one Chromium/Firefox lane plus three parallel one-worker WebKit shards and requires them all through the `e2e` aggregate check. Install those additional browser binaries locally before using `pnpm --filter @starguidance/web test:e2e:cross-browser`. To refresh review screenshots:

```powershell
$env:CAPTURE_SCREENSHOTS="1"
corepack pnpm --filter @starguidance/web exec playwright test tests/e2e/visual.spec.ts
```

The credential-free adapters are test aids, not proof of production integrations.

For an isolated Postgres integration database that has already received the migrations and seed:

```bash
DATABASE_INTEGRATION_URL=postgresql://... \
corepack pnpm --filter @starguidance/database test:integration

DATABASE_INTEGRATION_URL=postgresql://... \
corepack pnpm --filter @starguidance/web test:integration
```

The suite creates synthetic users, assumes the non-login `starguidance_app` role with a verified subject, proves the browser `authenticated` role cannot reach private tables, verifies two-user RLS isolation and same-draw recovery, exercises the leased interpretation/report queues plus profile-deletion commerce retention, tests snapshot history/export scope/account deletion, and removes its fixtures. Use only a disposable database.

## Deploy-preview screenshots

The synthetic `/visual-preview` route is available outside public production. The committed Netlify configuration enables it only for the `deploy-preview` context; `ENABLE_VISUAL_PREVIEW` defaults to false. It is no-indexed and contains no account, profile, question, or reading data. Capture screenshots from an actual Netlify preview with:

```bash
DEPLOY_PREVIEW_URL=https://deploy-preview-N--example.netlify.app \
PREVIEW_SCREENSHOTS=1 \
corepack pnpm --filter @starguidance/web exec playwright test \
  --config playwright.preview.config.ts
```

The route contains no user profile, question, session, or production provider data.
