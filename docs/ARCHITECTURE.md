# Architecture

StarGuidance is a modular pnpm monorepo. Next.js owns product orchestration, FastAPI owns deterministic profile calculations, and independent packages own draw, state-machine, persistence, UI, and narration boundaries.

## Request flow

1. An authenticated user submits birth facts to the web server; no sensitive field enters a URL.
2. The web server calls the profile engine over a server-to-server boundary. A shared bearer secret can be required.
3. The engine returns versioned numerology, Dreamspell, Nine Star Ki, typed capability results for Western astrology, BaZi, and planetary angularity, stable/uncertain traits, and explicit tensions. Inactive in-scope systems remain explicit unavailable components rather than fabricating output; proprietary systems that forbid the intended use are omitted.
4. The web server encrypts raw inputs and calculation payloads and creates an immutable snapshot.
5. A reading request is safety-classified. Crisis language is interrupted before any draw; a normalized same-question check returns the recent locked reading during the configured cooldown instead of drawing again.
6. The server verifies that the selected versioned deck and spread are operator-active, then the tarot domain uses CSPRNG Fisher–Yates and independent reversal bits. The domain accepts no profile, question, or AI data.
7. The complete draw is persisted before interpretation. The reading record separately references its immutable profile snapshot.
8. A deterministic selector sends at most three stable, question-relevant plain-language traits to the interpretation boundary. Raw birth and calculation data stay out.
9. Schema-validated structured output passes a deterministic prohibited-claim scan before persistence and is rendered as components, never arbitrary provider HTML. Unsafe or failed live output falls back deterministically. Retries and follow-ups reuse the same draw.

Step 8 now runs through a durable, idempotent job (migration `0007_interpretation_jobs`): the reading-creation request enqueues the job in the same transaction as step 7's draw, then makes one best-effort inline attempt so the common case still resolves before navigation. An interrupted or transiently failed attempt leaves the job durably claimable; a Netlify-scheduled function drains it within about a minute, and the client polls rather than assuming its first fetch is current. See [Deployment](DEPLOYMENT.md) and [Known gaps](KNOWN-GAPS.md) for the worker's authorization and remaining manual-review gates.

The profile engine never calls consumer chart websites. Geographic planetary angularity will reuse the approved Western ephemeris and normalized UTC/coordinate context. Nine Star Ki is calculated locally from an explicit versioned civil-date and Lo Shu convention; no third-party guide, calculator, prose, or artwork is ingested. Paid-report synthesis consumes only persisted versioned component output and original StarGuidance editorial rules.

## Immersive reading presentation

The ritual route keeps one `MysticSanctuaryScene` mounted across shuffle, cut, deal, reveal, interpretation, retry, and follow-up. `AtmosphericLayers` adds CSS-only mist, light, particles, and parallax over responsive AVIF/WebP art. `TarotSpreadStage` and `PhysicalTarotCard` render only dealt cards with a true front/back transform, card-specific SVG face, and the orientation-appropriate baseline themes. `OracleTranscript` and `QuestionComposer` form the bottom oracle console. Cut/skip-cut and exact revealed-card indexes are stored per reading in session storage, so interruption returns to the same ritual progress without changing the locked draw. Motion and sound choices persist in local storage; the in-app motion switch remains reversible even when seeded from the OS preference.

Completed history entries open `/reading/[id]`, a pre-revealed result scene that does not replay shuffle, cut, or reveal. It uses the validated `result.title` for the opening-theme heading, retains the same transcript and card-focus navigation, exposes the configured remaining follow-ups, and submits private feedback through a separate authenticated resource.

`PersistedResultStreamAdapter` converts only a validated, persisted `readingResultSchema` object into eight provider-neutral oracle phases. The authenticated Next.js route emits NDJSON through `ReadableStream` with `no-store` and buffering disabled. It never receives or emits the private question. A transport failure preserves already rendered chunks; retry reads the same persisted result and draw.

The noindex `/visual-preview` route uses synthetic, non-personal fixtures for deploy-preview screenshots. A Netlify context-specific environment flag enables it for deploy previews; the flag defaults off and public production returns 404.

## Package ownership

- `contracts`: boundary schemas and shared trait ontology.
- `database`: 30-table relational model, migration metadata, RLS policy SQL, and encryption primitives.
- `tarot-domain`: selection, reversal, locking, and follow-up lineage invariants.
- `tarot-content`: original content, attribution, versions, and four spreads.
- `reading-machine`: valid ritual transitions, failure, expiry, and high-stakes states.
- `ai`: safety rules, reading-lens selection, provider interface, validation, and fallback.
- `design-system`: reusable accessible UI primitives.
- `config`: feature/environment parsing.

## Runtime adapters

The selector has no default. `supabase` activates hosted Auth and Postgres repositories; `local` activates the in-process test adapter only after a second explicit allow flag and only in development/test. Deploy previews select `supabase`, so missing credentials produce a closed authentication/persistence boundary instead of silently creating volatile sessions.

The repository contract exposes users, settings, versioned consent, profiles, snapshots, components, traits, sessions, draws, outputs, configurable follow-ups, history, feedback, reports, orders, entitlements, webhook events, audit, export, and deletion. Supabase requests use a pooled server-only SQL connection inside a transaction that assumes the non-login `starguidance_app` database role and sets the verified JWT subject. Follow-up count-and-insert is serialized by locking the owned reading row, so concurrent requests cannot exceed the configured limit. Supabase requests consult the seeded deck/spread `active` flags at creation time. The browser's `authenticated` role has no private-table privileges. Service operations are constructed separately and are limited to explicit webhook/operator boundaries and Auth identity deletion. Profile-report purchase and webhook entry points have a default-off server kill switch; the corresponding public UI flag never grants authorization.

Profile updates append a snapshot and change only the active pointer. Reading rows retain their original snapshot foreign key. Reading creation commits the session and full draw atomically before any provider runs; retry appends output without writing the draw.
