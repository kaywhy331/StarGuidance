# Local development

## Prerequisites

- Node.js 24+
- Corepack and pnpm 11.16.0
- Python 3.10+

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
python -m pip install -e ".[dev]"
```

On PowerShell, use `./.venv/Scripts/python.exe -m pip install -e ".[dev]"` if the environment is not activated.

## Run

Terminal one, from `apps/profile-engine`:

```bash
python -m uvicorn profile_engine.main:app --reload --port 8000
```

Terminal two, from the repository root:

```bash
corepack pnpm dev
```

Open `http://localhost:3000`. The example configuration explicitly sets `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, and `APP_ENV=development`. All three policy conditions are required; profiles/readings/reports remain encrypted in process memory and disappear on restart. Never carry `ALLOW_LOCAL_RUNTIME_ADAPTER` into a hosted context.

To exercise the durable adapter locally, change only `RUNTIME_ADAPTER` to `supabase` and configure the Supabase variables through an uncommitted `.env.local`. The app will fail closed if any required database, Auth, or encryption setting is absent.

If `PROFILE_ENGINE_SHARED_SECRET` is set for FastAPI, configure the identical value for Next.js. Health remains public at `http://127.0.0.1:8000/health`; calculation requires the bearer secret.

## Verify

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm db:check
corepack pnpm build
corepack pnpm test:e2e
```

From `apps/profile-engine`:

```bash
pytest
ruff check .
mypy .
```

Playwright starts both FastAPI and Next.js, runs desktop and Pixel-sized Chromium projects, and leaves external AI/Stripe/Supabase disabled. To refresh review screenshots:

```powershell
$env:CAPTURE_SCREENSHOTS="1"
corepack pnpm --filter @starguidance/web exec playwright test tests/e2e/visual.spec.ts
```

The credential-free adapters are test aids, not proof of production integrations.

For an isolated Postgres integration database that has already received the migrations and seed:

```bash
DATABASE_INTEGRATION_URL=postgresql://... \
corepack pnpm --filter @starguidance/database test:integration
```

The suite creates synthetic users, forces the `authenticated` role/JWT subject, proves two-user RLS isolation and same-draw recovery, tests snapshot history/export scope/deletion, and removes its fixtures. Use only a disposable database.

## Deploy-preview screenshots

The synthetic `/visual-preview` route is available outside public production. The committed Netlify configuration enables it only for the `deploy-preview` context; `ENABLE_VISUAL_PREVIEW` defaults to false. It is no-indexed and contains no account, profile, question, or reading data. Capture screenshots from an actual Netlify preview with:

```bash
DEPLOY_PREVIEW_URL=https://deploy-preview-N--example.netlify.app \
PREVIEW_SCREENSHOTS=1 \
corepack pnpm --filter @starguidance/web exec playwright test \
  --config playwright.preview.config.ts
```

The route contains no user profile, question, session, or production provider data.
