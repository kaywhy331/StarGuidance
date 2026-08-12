# Architecture

StarGuidance is a modular pnpm monorepo. Next.js owns product orchestration, FastAPI owns deterministic profile calculations, and independent packages own draw, state-machine, persistence, UI, and narration boundaries.

## Request flow

1. An authenticated user submits birth facts to the web server; no sensitive field enters a URL.
2. The web server calls the profile engine over a server-to-server boundary. A shared bearer secret can be required.
3. The engine returns versioned numerology, Dreamspell, Nine Star Ki, typed discriminated capability results for Western astrology, BaZi, and planetary angularity, stable/uncertain traits, explicit tensions, and explicit cross-system convergence records. Inactive in-scope systems remain explicit unavailable components rather than fabricating output; their activation contracts require engine/data/convention evidence, uncertainty, and resolved context before an `available` result can cross the boundary. Proprietary systems that forbid the intended use are omitted.
4. The web server encrypts raw inputs and calculation payloads and creates an immutable snapshot.
5. Reading intake records topic, intent, horizon, and whether the approved general-reading path was selected. Safety classification happens before creation: crisis language interrupts the flow, guarded high-stakes questions require a separate reflective-scope confirmation, and neither path creates a reading, draw, or generation job prematurely. A normalized same-question check returns the recent locked reading during the configured cooldown instead of drawing again.
6. The server evaluates the versioned reading-access policy and verifies that the selected versioned deck and spread are operator-active, then the tarot domain uses CSPRNG Fisher–Yates and independent reversal bits. The domain accepts no profile, question, or AI data.
7. The complete draw is persisted before interpretation. The reading record separately references its immutable profile snapshot.
8. `question-trait-lens-v2` deterministically sends only relevant plain-language traits and preserved tensions to the interpretation boundary; it does not pad the lens with irrelevant traits. Raw birth facts and calculation payloads stay out.
9. Schema-validated `reading-result-v2` output stores ordered conversational passages plus non-rendered locked-card references, conditional trajectory, agency, disconfirming evidence, uncertainty, and safety metadata. It passes a deterministic prohibited-claim scan before persistence and is rendered as components, never arbitrary provider HTML. Persisted v1 report-shaped results normalize to v2 at the repository boundary; new UI renders only natural spoken passages. Unsafe or failed live output falls back deterministically. Retries and follow-ups reuse the same draw.

Step 8 now runs through a durable, idempotent job (migration `0007_interpretation_jobs`): the reading-creation request enqueues the job in the same transaction as step 7's draw, then makes one best-effort inline attempt so the common case still resolves before navigation. An interrupted or transiently failed attempt leaves the job durably claimable; a Netlify-scheduled function drains it within about a minute, and the client polls rather than assuming its first fetch is current. See [Deployment](DEPLOYMENT.md) and [Known gaps](KNOWN-GAPS.md) for the worker's authorization and remaining manual-review gates.

Report Checkout is a separate stateful path. Before redirecting, the server stores the pending order with a context-bound encrypted, name-stripped copy of only the derived profile data required by the report. Stripe receives the opaque order ID, not that source. A verified paid event atomically marks the order paid, grants its single entitlement, creates one pending report, moves the encrypted source into one `report_jobs` row, and clears the order copy. The webhook acknowledges without generating prose. The same scheduled drain claims report jobs with leases and capped backoff; successful generation writes all structured sections and clears the temporary source, while terminal failure remains user-retryable. Purchased reports have a standalone authenticated history and an authenticated, tagged PDF generated from the same presentation model as the web view. Profile deletion nulls commerce snapshot pointers but leaves paid reconciliation and generated report content intact; account deletion still cascades the subject's rows.

Support and operations use a separate server-only authorization boundary. `SUPPORT_USER_IDS` may inspect aggregate queue health and exact opaque trace IDs; trace results contain only entity kind, status, and timestamp. `OPERATOR_USER_IDS` inherits that visibility and may rate-limitedly retry only retained failed jobs, with an audit event. Effective model, report, and reading-policy configuration is read-only in the console; mutation and rollback stay in the reviewed deployment path.

The profile engine never calls consumer chart websites. Geographic planetary angularity will reuse the approved Western ephemeris and normalized UTC/coordinate context. Nine Star Ki is calculated locally from an explicit versioned civil-date and Lo Shu convention; no third-party guide, calculator, prose, or artwork is ingested. Paid-report synthesis consumes only persisted versioned component output and original StarGuidance editorial rules.

## Immersive reading presentation

The ritual route keeps one `MysticSanctuaryScene` mounted across shuffle, cut, deal, reveal, interpretation, retry, and follow-up. `AtmosphericLayers` adds CSS-only mist, light, particles, and parallax over responsive AVIF/WebP art. `TarotSpreadStage` and `PhysicalTarotCard` render only dealt cards with a true front/back transform, card-specific SVG face, and the orientation-appropriate baseline themes. `OracleTranscript` and `QuestionComposer` form the bottom oracle console. Cut/skip-cut and exact revealed-card indexes are persisted monotonically on the reading; browser session storage is only a fallback. Interruption therefore returns to the same server-backed ritual progress without changing the locked draw, while an expired TTL enters the explicit recovery state. Motion and sound choices persist in account settings with local/OS fallback; the in-app motion switch remains reversible even when seeded from the OS preference.

Completed history entries open `/reading/[id]`, a pre-revealed result scene that does not replay shuffle, cut, or reveal. It uses the validated `result.title` for the opening-theme heading, retains the same transcript and card-focus navigation, exposes the configured remaining follow-ups, and submits private feedback through a separate authenticated resource.

`PersistedResultStreamAdapter` converts only a validated, persisted `readingResultSchema` object into eight provider-neutral oracle phases. The authenticated Next.js route emits NDJSON through `ReadableStream` with `no-store` and buffering disabled. It never receives or emits the private question. A transport failure preserves already rendered chunks; retry reads the same persisted result and draw.

The noindex `/visual-preview` route uses synthetic, non-personal fixtures for deploy-preview screenshots. A Netlify context-specific environment flag enables it for deploy previews; the flag defaults off and public production returns 404.

## Package ownership

- `contracts`: boundary schemas and shared trait ontology.
- `database`: 31-table relational model, migration metadata, RLS policy SQL, durable queues, and encryption primitives.
- `tarot-domain`: selection, reversal, locking, and follow-up lineage invariants.
- `tarot-content`: original content, attribution, versions, six selectable spreads, spatial layout metadata, deterministic one-/three-card context templates, and retired definitions used only to resolve historical locked draws.
- `reading-machine`: valid ritual transitions, failure, expiry, and high-stakes states.
- `ai`: safety rules, reading-lens selection, provider interface, validation, and fallback.
- `design-system`: reusable accessible UI primitives.
- `config`: feature/environment parsing.

## Runtime adapters

The selector has no default. `supabase` activates hosted Auth and Postgres repositories; `local` activates the in-process test adapter only after a second explicit allow flag and only in development/test. Deploy previews select `supabase`, so missing credentials produce a closed authentication/persistence boundary instead of silently creating volatile sessions.

The repository contract exposes users, settings, versioned consent, profiles, snapshots, components, traits, sessions, draws, outputs, configurable follow-ups, history, feedback, reports, atomic report fulfillment, orders, entitlements, webhook events, audit, export, and deletion. Supabase requests use a pooled server-only SQL connection inside a transaction that assumes the non-login `starguidance_app` database role and sets the verified JWT subject. Follow-up count-and-insert is serialized by locking the owned reading row, so concurrent requests cannot exceed the configured limit. Supabase requests consult the seeded deck/spread `active` flags at creation time. The browser's `authenticated` role has no private-table privileges. Cross-user queue claims have explicit connection-role policies; user retries remain subject-bound. Service operations are constructed separately and are limited to explicit webhook/operator boundaries and Auth identity deletion. Profile-report purchase and webhook entry points have a default-off server kill switch; the corresponding public UI flag never grants authorization.

Profile updates append a snapshot and change only the active pointer. Reading rows retain their original snapshot foreign key. Reading creation commits the session and full draw atomically before any provider runs; retry appends output without writing the draw.
