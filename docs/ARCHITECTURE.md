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

## Immersive reading presentation

The reading route keeps one `MysticSanctuaryScene` mounted across shuffle, cut, deal, reveal, interpretation, retry, and follow-up. `AtmosphericLayers` adds CSS-only mist, light, particles, and parallax over responsive AVIF/WebP art. `TarotSpreadStage` and `PhysicalTarotCard` render only dealt cards with a true front/back transform and card-specific SVG face. `OracleTranscript` and `QuestionComposer` form the bottom oracle console, while `ReadingDetailsDrawer` keeps report-style content secondary.

`PersistedResultStreamAdapter` converts only a validated, persisted `readingResultSchema` object into eight provider-neutral oracle phases. The authenticated Next.js route emits NDJSON through `ReadableStream` with `no-store` and buffering disabled. It never receives or emits the private question. A transport failure preserves already rendered chunks; retry reads the same persisted result and draw.

The noindex `/visual-preview` route uses synthetic, non-personal fixtures for deploy-preview screenshots. A Netlify context-specific environment flag enables it for deploy previews; the flag defaults off and public production returns 404.

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

The selector has no default. `supabase` activates hosted Auth and Postgres repositories; `local` activates the in-process test adapter only after a second explicit allow flag and only in development/test. Deploy previews select `supabase`, so missing credentials produce a closed authentication/persistence boundary instead of silently creating volatile sessions.

The repository contract exposes users, settings, consent, profiles, snapshots, components, traits, sessions, draws, outputs, follow-ups, history, feedback, reports, orders, entitlements, webhook events, audit, export, and deletion. Supabase requests use a pooled server-only SQL connection inside a transaction that assumes the `authenticated` database role and sets the verified JWT subject. Service operations are constructed separately and are limited to webhook idempotency/order completion and Auth identity deletion.

Profile updates append a snapshot and change only the active pointer. Reading rows retain their original snapshot foreign key. Reading creation commits the session and full draw atomically before any provider runs; retry appends output without writing the draw.
