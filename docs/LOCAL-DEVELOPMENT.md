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

Open `http://localhost:3000`. With `APP_ENV=development`, the local sign-in adapter creates an HttpOnly session. Profiles/readings/reports are encrypted but in process memory and disappear on restart.

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
