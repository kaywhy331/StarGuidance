# StarGuidance

StarGuidance is a private tarot experience in which deterministic birth-profile traits personalize interpretation while a cryptographically secure draw chooses cards independently. Visitors can first complete one birthday-personalized deterministic reading without an account, then sign up or sign in to recover those exact cards and ask a follow-up. The guest lane sends the birthday only to the private calculation service, uses stable date-derived traits, discards the raw date before building the browser-held receipt, and makes no AI-provider request. The safe beta also supports email/password accounts, private onboarding and profile correction, immutable profile snapshots, six selectable spreads (including the four foundational reading types), structured topic/intent/horizon intake, a question-free general-reading path, high-stakes confirmation before any draw, server-recoverable locked rituals, direct finished-reading views, deterministic interpretation fallback, configurable same-draw follow-ups and reading allowances, separate experience/outcome feedback, history, and privacy controls. A 17-section profile report, purchased-report history, test Checkout lifecycle, durable fulfillment, and authenticated tagged PDF are implemented behind a default-off release gate; owner commerce, accessibility-review, and production-provider gates still block public launch.

The reading ritual uses an original responsive cosmic Gothic sanctuary, card-specific illustrated faces, a physical 3D card system, and an authenticated streaming oracle transcript. See [artwork provenance](docs/ARTWORK-PROVENANCE.md) for sources, prompts, rights boundaries, hashes, and performance budgets.

## Workspace

- `apps/web` — Next.js App Router experience and authenticated server boundary.
- `apps/profile-engine` — FastAPI calculation and trait-synthesis service.
- `packages/contracts` — strict shared Zod contracts.
- `packages/database` — Drizzle schema, SQL migration, RLS, and AES-256-GCM helpers.
- `packages/tarot-domain` — CSPRNG shuffle and immutable draw rules.
- `packages/tarot-content` — original, versioned 78-card content and six selectable spreads.
- `packages/reading-machine` — XState ritual workflow.
- `packages/design-system` — accessible celestial primitives.
- `packages/ai` — safety classification, compact trait-lens selection, structured provider boundary, and deterministic fallback.

## Runtime adapters

`RUNTIME_ADAPTER` must explicitly select `supabase` or `local`; there is no implicit fallback. The Supabase adapter uses conventional email/password Auth, user-scoped Postgres repositories, application-level AES-256-GCM encryption, immutable profile snapshots, durable locked readings and report jobs, export, separated profile/commerce deletion, orders, entitlements, webhook idempotency, and audit records. Each user-scoped database transaction assumes the server-only `starguidance_app` role and sets the verified Auth subject so RLS remains active; browser JWTs have no private-table privileges. Routine login sends no email. Email delivery is reserved for optional signup confirmation and password recovery.

The credential-free adapter remains available only when `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, and the environment is local development/test. It is rejected in Netlify deploy previews and production. Every release candidate must pass the owner-credentialed staging migration and Auth-backed two-user workflow at the exact commit being promoted; the reproducible procedure remains in [Supabase staging](docs/SUPABASE-STAGING.md).

Western astrology, BaZi, and planetary-angularity mapping return typed unavailable results. Their service contracts also define the fully evidenced `available` variants an approved adapter must satisfy, so activation cannot bypass validation or substitute placeholder facts. Dreamspell is deterministic but remains uncertified pending an approved reference dataset and rights review. Nine Star Ki deterministically returns versioned Principal, Character, and Lo Shu-derived Energy numbers with original interpretation copy; its independent convention review remains pending. Proprietary systems that forbid the intended use are omitted.

## Configuration

Copy `.env.example` to `.env.local` and keep every secret blank until its local or hosted adapter is intentionally configured. The canonical inventory includes runtime selection, encryption, the preferred dedicated `GUEST_TRIAL_SECRET`, Supabase, readiness/worker authentication, profile-engine guards, AI, Stripe, reading allowance/session TTL, aggregate alert delivery, and server-only support/operator UUID allowlists. Local guest trials fail closed when that key is missing or malformed. Netlify can instead derive a guest subroot from `DATA_ENCRYPTION_KEY`: Deploy Previews are isolated per site and PR, while production is isolated per site. The build must inline the matching non-secret context marker, and runtime must independently identify the expected environment and Netlify site. A malformed dedicated guest key is never bypassed. `READING_ACCESS_MODE=unlimited` is the local fallback; durable environments seed conservative published configuration. Support sees masked diagnostics only. Operators can create validated configuration drafts, while a different operator must approve them before publication; rollback, content activation, and restrictive emergency kill switches are audited.

## Run and verify

Requirements are Node.js 24, Corepack/pnpm 11.16.0, and Python 3.12. `.node-version`, `pnpm-lock.yaml`, and hashed Python lock files pin the verified toolchain and dependencies. Follow [local development](docs/LOCAL-DEVELOPMENT.md) to run both applications.

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm audit --prod --audit-level high
corepack pnpm format:check
corepack pnpm requirements:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm db:check
corepack pnpm build
corepack pnpm test:e2e
```

The default E2E command runs desktop and mobile Chromium. The local cross-browser command (`corepack pnpm --filter @starguidance/web test:e2e:cross-browser`) adds desktop Firefox and fresh-process serial WebKit shards. CI runs the same coverage as one core lane plus three parallel one-worker WebKit shards, then requires every lane through the aggregate `e2e` check.

Profile engine, from `apps/profile-engine` with its virtual environment active:

```bash
pytest
ruff check .
mypy .
```

The deterministic reading provider is the default. Live AI requires credentials and `AI_SAFETY_EVALUATION_APPROVED=true`. The reviewed Groq order is GPT-OSS 120B (strict JSON Schema), Llama 3.3 70B (JSON mode plus full application validation), GPT-OSS 20B (strict JSON Schema), then the provider-independent deterministic reader. Model attempts reuse the same locked draw and share one total latency budget. An optional default-off Cali/TokenPak blueprint requires a pinned gateway host, separate bearer, Cloudflare Access service identity, synthetic pilot, and the [gateway contract](docs/AI-GATEWAY-SECURITY.md) plus [pilot runbook](docs/CALI-TOKENPAK-PILOT.md); raw TokenPak must never be tunneled. It is not a live deployment. New report purchases and Stripe webhooks require both server and UI report flags; both default off. See [known production gates](docs/KNOWN-GAPS.md) before describing a deployment as public-launch ready.

## Review evidence

- [Account-free reading selection, desktop](docs/screenshots/free-reading-selection-desktop-chromium.png)
- [Account-free reading selection, mobile](docs/screenshots/free-reading-selection-mobile-chromium.png)
- [Same-draw account gate, desktop](docs/screenshots/free-reading-result-gate-desktop-chromium.png)
- [Same-draw account gate, mobile](docs/screenshots/free-reading-result-gate-mobile-chromium.png)
- [Desktop completed reading](docs/screenshots/completed-reading-desktop-chromium.png)
- [Mobile completed reading](docs/screenshots/completed-reading-mobile-chromium.png)

See [architecture](docs/ARCHITECTURE.md), [immersive UX review](docs/IMMERSIVE-UX.md), [Must-requirement traceability](docs/REQUIREMENTS-TRACEABILITY.md), [security](docs/SECURITY.md), [AI gateway and tunnel security](docs/AI-GATEWAY-SECURITY.md), [Cali TokenPak pilot](docs/CALI-TOKENPAK-PILOT.md), [operations and recovery](docs/OPERATIONS.md), [commerce verification](docs/COMMERCE.md), [calculation status](docs/PROFILE-CALCULATIONS.md), [draw integrity](docs/TAROT-INTEGRITY.md), and [known production gates](docs/KNOWN-GAPS.md).
