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

`RUNTIME_ADAPTER` must explicitly select `supabase` or `local`; there is no implicit fallback. The Supabase adapter uses conventional email/password Auth, user-scoped Postgres repositories, application-level AES-256-GCM encryption, immutable profile snapshots, durable locked readings, export, deletion, orders, entitlements, webhook idempotency, and audit records. Each user-scoped database transaction assumes the server-only `starguidance_app` role and sets the verified Auth subject so RLS remains active; browser JWTs have no private-table privileges. Routine login sends no email. Email delivery is reserved for optional signup confirmation and password recovery.

The credential-free adapter remains available only when `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, and the environment is local development/test. It is rejected in Netlify deploy previews and production. Owner-credentialed staging migration and Auth-backed two-user verification have passed; the reproducible procedure remains in [Supabase staging](docs/SUPABASE-STAGING.md).

Western astrology, BaZi, and planetary-angularity mapping return typed unavailable results. Dreamspell is deterministic but remains uncertified pending an approved reference dataset and rights review. Nine Star Ki deterministically returns versioned Principal, Character, and Lo Shu-derived Energy numbers with original interpretation copy; its independent convention review remains pending. No placeholder chart facts are returned, and proprietary systems that forbid the intended use are omitted.

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

See [architecture](docs/ARCHITECTURE.md), [security](docs/SECURITY.md), [operations and recovery](docs/OPERATIONS.md), [commerce verification](docs/COMMERCE.md), [calculation status](docs/PROFILE-CALCULATIONS.md), [draw integrity](docs/TAROT-INTEGRITY.md), and [known production gates](docs/KNOWN-GAPS.md).
