# Architecture

StarGuidance is a modular pnpm monorepo. Next.js owns product orchestration, FastAPI owns deterministic profile calculations, and independent packages own draw, state-machine, persistence, UI, and narration boundaries.

## Request flow

1. An authenticated user submits birth facts to the web server; no sensitive field enters a URL.
2. The web server calls the profile engine over a server-to-server boundary. A shared bearer secret can be required.
3. The engine returns versioned numerology, Dreamspell, typed unavailable systems, stable/uncertain traits, and explicit tensions.
4. The web server encrypts raw inputs and calculation payloads and creates an immutable snapshot.
5. A reading request is safety-classified. Crisis or compulsive-redraw language is interrupted before any draw.
6. The tarot domain receives only versioned deck and spread data. It uses CSPRNG Fisher–Yates and independent reversal bits; it accepts no profile, question, or AI data.
7. The complete draw is persisted before interpretation. The reading record separately references its immutable profile snapshot.
8. A deterministic selector sends at most three stable, question-relevant plain-language traits to the interpretation boundary. Raw birth and calculation data stay out.
9. Schema-validated structured output is rendered as components, never arbitrary provider HTML. Retries and follow-ups reuse the same draw.

## Package ownership

- `contracts`: boundary schemas and shared trait ontology.
- `database`: 27-table relational model, migration metadata, RLS policy SQL, and encryption primitives.
- `tarot-domain`: selection, reversal, locking, and follow-up lineage invariants.
- `tarot-content`: original content, attribution, versions, and four spreads.
- `reading-machine`: valid ritual transitions, failure, expiry, and high-stakes states.
- `ai`: safety rules, reading-lens selection, provider interface, validation, and fallback.
- `design-system`: reusable accessible UI primitives.
- `config`: feature/environment parsing.

## Runtime adapters

The current credential-free runtime is intentionally development-only: in-process users, encrypted snapshots, readings, reports, orders, entitlements, audit events, and idempotency keys. It is exercised by the browser suite but is not durable across server restarts.

The production data model, migration, and RLS policies are implemented, but the Next.js repository layer and Supabase Auth adapter still require a real project and cross-user verification. Production must fail closed until that adapter, managed encryption key, durable jobs, and external services are configured.
