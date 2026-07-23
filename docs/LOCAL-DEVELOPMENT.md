# Local development

## Prerequisites

- Node.js 24 or newer
- Corepack
- Python 3.10 or newer
- Docker Desktop for the later local Postgres/Supabase stack

## JavaScript workspace

From the repository root:

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

The web app is available at `http://localhost:3000`.

## Profile engine

PowerShell:

```powershell
cd apps/profile-engine
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn profile_engine.main:app --reload
```

Bash:

```bash
cd apps/profile-engine
python -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
uvicorn profile_engine.main:app --reload
```

The service health endpoint is `http://127.0.0.1:8000/health`. API documentation is intentionally disabled until authenticated service boundaries are implemented.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

From `apps/profile-engine` with the virtual environment active:

```bash
pytest
ruff check .
mypy .
```

## External services

No credential is required for the deterministic local fallback. Supabase, AI, Stripe, and observability integrations remain disabled when their environment settings are absent. Western astrology and BaZi stay explicitly unavailable until validation and licensing gates are satisfied.
