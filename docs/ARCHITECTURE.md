# Architecture

StarGuidance is a modular pnpm monorepo. Next.js owns product orchestration, FastAPI owns deterministic profile calculations, and independent packages own draw, state-machine, persistence, UI, and narration boundaries.

## Request flow

1. An authenticated user submits birth facts to the web server; no sensitive field enters a URL.
2. The web server calls the profile engine over a server-to-server boundary. A shared bearer secret can be required.
3. The engine returns versioned numerology, Dreamspell, Nine Star Ki, typed capability results for Western astrology, BaZi, and planetary angularity, stable/uncertain traits, and explicit tensions. Inactive in-scope systems remain explicit unavailable components rather than fabricating output; proprietary systems that forbid the intended use are omitted.
4. The web server encrypts raw inputs and calculation payloads and creates an immutable snapshot.
5. A reading request is safety-classified. Crisis or compulsive-redraw language is interrupted before any draw.
6. The tarot domain receives only versioned deck and spread data. It uses CSPRNG Fisher–Yates and independent reversal bits; it accepts no profile, question, or AI data.
7. The complete draw is persisted before interpretation. The reading record separately references its immutable profile snapshot.
8. A deterministic selector sends at most three stable, question-relevant plain-language traits to the interpretation boundary. Raw birth and calculation data stay out.
9. Schema-validated structured output passes a deterministic prohibited-claim scan before persistence and is rendered as components, never arbitrary provider HTML. Unsafe or failed live output falls back deterministically. Retries and follow-ups reuse the same draw.

The current route performs step 8 inside the reading-creation request after step 7 commits. That preserves draw integrity and idempotency but delays navigation on a slow live provider. Moving generation to a durable idempotent background boundary is a public-MVP gate documented in [Known gaps](KNOWN-GAPS.md).

The profile engine never calls consumer chart websites. Geographic planetary angularity will reuse the approved Western ephemeris and normalized UTC/coordinate context. Nine Star Ki is calculated locally from an explicit versioned civil-date and Lo Shu convention; no third-party guide, calculator, prose, or artwork is ingested. Paid-report synthesis consumes only persisted versioned component output and original StarGuidance editorial rules.

## Immersive reading presentation

The reading route keeps one `MysticSanctuaryScene` mounted across shuffle, cut, deal, reveal, interpretation, retry, and follow-up. `AtmosphericLayers` adds CSS-only mist, light, particles, and parallax over responsive AVIF/WebP art. `TarotSpreadStage` and `PhysicalTarotCard` render only dealt cards with a true front/back transform and card-specific SVG face. `OracleTranscript` and `QuestionComposer` form the bottom oracle console, while `ReadingDetailsDrawer` keeps report-style content secondary. The safe-beta choreography automatically skips the cut and reveals dealt cards in sequence; intentional keyboard/tap reveal and an immediate animation-skip control remain explicit experience gates.

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

The repository contract exposes users, settings, versioned consent, profiles, snapshots, components, traits, sessions, draws, outputs, follow-ups, history, feedback, reports, orders, entitlements, webhook events, audit, export, and deletion. Supabase requests use a pooled server-only SQL connection inside a transaction that assumes the non-login `starguidance_app` database role and sets the verified JWT subject. The browser's `authenticated` role has no private-table privileges. Service operations are constructed separately and are limited to explicit webhook/operator boundaries and Auth identity deletion. Profile-report purchase and webhook entry points have a default-off server kill switch; the corresponding public UI flag never grants authorization.

Profile updates append a snapshot and change only the active pointer. Reading rows retain their original snapshot foreign key. Reading creation commits the session and full draw atomically before any provider runs; retry appends output without writing the draw.
