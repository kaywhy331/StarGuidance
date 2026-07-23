# Architecture

StarGuidance is a pnpm modular monorepo with a Next.js web application and an isolated FastAPI calculation service.

## Trust boundaries

1. The profile engine calculates only deterministic, versioned profile facts and uncertainty.
2. The tarot domain creates a CSPRNG-based draw without accepting profile or question inputs.
3. Persistence locks the full draw before interpretation generation.
4. The AI adapter receives a minimized trait lens, locked cards, curated meanings, and the private question; it narrates but never calculates or deals.
5. The web application renders validated structured data and never arbitrary provider HTML.

## Packages

- `contracts` owns versioned boundary schemas.
- `database` owns typed persistence, migrations, encryption adapters, and authorization policy artifacts.
- `tarot-domain` owns deck, spread, draw, and session invariants.
- `tarot-content` owns original editorial content and provenance.
- `reading-machine` owns valid reading transitions and recovery states.
- `design-system` owns accessible primitives and celestial visual tokens.
- `ai` owns classification, safety, provider adapters, validation, and fallback.
- `config` owns feature flags and environment parsing.

No package may reverse these dependency directions by importing from `apps/web`.
