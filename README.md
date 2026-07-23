# StarGuidance

StarGuidance is a private tarot experience in which deterministic birth-profile traits personalize interpretation while a cryptographically secure draw chooses cards independently. The MVP supports private onboarding, immutable profile snapshots, four reading types, a locked ritual flow, deterministic interpretation fallback, same-draw follow-ups, history, privacy controls, and a separately entitled profile report.

The reading ritual uses an original responsive cosmic Gothic sanctuary, card-specific illustrated faces, a physical 3D card system, and an authenticated streaming oracle transcript. See [artwork provenance](docs/ARTWORK-PROVENANCE.md) for sources, prompts, rights boundaries, hashes, and performance budgets.

## Workspace

- `apps/web` — Next.js App Router experience and authenticated server boundary.
- `apps/profile-engine` — FastAPI calculation and trait-synthesis service.
- `packages/contracts` — strict shared Zod contracts.
- `packages/database` — Drizzle schema, SQL migration, RLS, and AES-256-GCM helpers.
- `packages/tarot-domain` — CSPRNG shuffle and immutable draw rules.
- `packages/tarot-content` — original, versioned 78-card content and four spreads.
- `packages/reading-machine` — XState ritual workflow.
- `packages/design-system` — accessible celestial primitives.
- `packages/ai` — safety classification, compact trait-lens selection, structured provider boundary, and deterministic fallback.

## Runtime adapters

`RUNTIME_ADAPTER` must explicitly select `supabase` or `local`; there is no implicit fallback. The Supabase adapter uses hosted Auth, user-scoped Postgres repositories, application-level AES-256-GCM encryption, immutable profile snapshots, durable locked readings, export, deletion, orders, entitlements, webhook idempotency, and audit records. Each user-scoped database transaction assumes the `authenticated` role and sets the verified Auth subject so RLS remains active.

The credential-free adapter remains available only when `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, and the environment is local development/test. It is rejected in Netlify deploy previews and production. Hosted staging migration, Auth-backed two-user verification, and the deploy preview still require owner-managed credentials; see [Supabase staging](docs/SUPABASE-STAGING.md).

Western astrology and BaZi return typed unavailable results. Dreamspell is deterministic but remains uncertified pending an approved reference dataset and rights review. No placeholder chart facts are returned.

## Run and verify

Requirements are Node.js 24+, Corepack/pnpm 11.16.0, and Python 3.10+. Follow [local development](docs/LOCAL-DEVELOPMENT.md) to run both applications.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm db:check
corepack pnpm build
corepack pnpm test:e2e
```

Profile engine, from `apps/profile-engine` with its virtual environment active:

```bash
pytest
ruff check .
mypy .
```

## Review evidence

- [Desktop completed reading](docs/screenshots/completed-reading-desktop-chromium.png)
- [Mobile completed reading](docs/screenshots/completed-reading-mobile-chromium.png)

See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [calculation status](docs/PROFILE-CALCULATIONS.md), [draw integrity](docs/TAROT-INTEGRITY.md), and [known production gates](docs/KNOWN-GAPS.md).
