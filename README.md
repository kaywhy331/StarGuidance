# StarGuidance

StarGuidance is a private, immersive tarot-reading application personalized by deterministic birth-profile traits. Profile data shapes interpretation only; a cryptographically secure tarot service chooses and locks cards independently before any AI generation.

## Workspace

- `apps/web` — Next.js App Router product experience and server boundary.
- `apps/profile-engine` — FastAPI calculation service.
- `packages/contracts` — versioned Zod contracts shared across boundaries.
- `packages/database` — Drizzle schema, migrations, encryption, and persistence adapters.
- `packages/tarot-domain` — secure draw and reading-session rules.
- `packages/tarot-content` — original, versioned 78-card and spread content.
- `packages/reading-machine` — explicit XState reading workflow.
- `packages/design-system` — accessible visual primitives.
- `packages/ai` — provider-agnostic structured interpretation and deterministic fallback.
- `packages/config` — shared build and feature configuration.

## Requirements

- Node.js 24+
- Corepack with pnpm 11.16.0
- Python 3.10+

## Start locally

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

Run the profile service separately using the commands in `docs/LOCAL-DEVELOPMENT.md`.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Profile engine:

```bash
pytest
ruff check .
mypy .
```

## Production gates

Western astrology and BaZi remain typed, feature-flagged unavailable integrations until licensing, conventions, and golden-reference datasets are approved. AI, Supabase, observability, and Stripe require environment credentials. Development adapters never imply that those production paths have been verified. See `docs/KNOWN-GAPS.md` as implementation progresses.
