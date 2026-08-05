# Known gaps and production gates

## Implemented on this stacked branch

- Explicit `local`/`supabase` runtime selection with no fallback; hosted contexts reject local sessions.
- Supabase email/password registration and sign-in, optional signup-confirmation and recovery callbacks, sign-out, and service-role account identity deletion.
- User-scoped Postgres repositories for every private MVP entity plus durable export and deletion.
- AES-256-GCM persistence for raw birth data, calculation payloads, questions, follow-ups, and optional feedback comments.
- Atomic session/locked-draw persistence, append-only outputs, same-draw retry/follow-up, durable recovery, and immutable profile history.
- Durable Stripe order, entitlement, report, leased webhook-replay, full-refund revocation, dispute revocation, and report-access enforcement.
- Forced RLS/public privilege revocation and a two-subject isolated-Postgres test covering cross-user profile, snapshots, readings, draw, question, follow-up, report, order, export source data, and deletion.
- Application users are provisioned only at the `requireUser()` boundary. Migration 0002 removed the `auth.users` synchronisation trigger, which forced RLS made unusable and which made every Supabase Auth signup fail; CI installs an `auth.users` shim so that migration path, the cascade, and the reproduction of the original failure are all exercised without credentials.
- Four-question profile onboarding: required full birth name and date, plus independent optional birth city/country and birth time fields. No timezone, time-confidence mode, or Latin rendering is requested.
- Non-Latin names preserve the original input and reduce unsupported name-derived numerology detail instead of blocking the profile or inventing a transliteration.
- Planetary-angularity mapping now has a versioned fail-closed profile component, persisted component metadata, and an original paid-report status section. It fabricates no chart and calls no third-party calculator.
- Nine Star Ki now produces versioned Principal, Character, and Lo Shu-derived Energy numbers, persists its convention/certification metadata, and contributes original uncertain traits to the paid report. No third-party guide copy, artwork, or calculator output is used.

## Credential-backed staging status

Netlify Deploy Preview #4 is active with the staging Supabase adapter. The protected staging workflow has passed against the owner-approved project: authoritative migrations and idempotent seeds, forced RLS and two-user isolation, authenticated profile/snapshot/reading persistence, locked-draw recovery, scoped export, account/Auth deletion, profile-engine authorization, cleanup, redaction, and accessibility checks all completed. The redacted runtime probe confirms that local persistence is disabled and required environment-variable names are present. The profile-engine client retains its eight-second timeout; prefer an always-on staging instance, and treat any bounded transient retry policy as a separately reviewed change.

The updated protected workflow exercises a positive password sign-in with an ephemeral Supabase identity and both callback failure paths; it must be rerun for the new authentication commit before that hosted result is treated as current. Signup-confirmation and recovery delivery cannot be synthesized safely, so an owner-controlled staging inbox remains required for that smoke test. Secret values must never be pasted into chat or recorded in evidence.

The current runner exposes no deliverable inbox (its `MAIL` value is a local spool path), Stripe credential names, Supabase or Render management token, or authenticated Netlify site context. Those absences were checked by name/presence only; no values were printed. The owner-inbox confirmation/recovery procedure and hosted control-plane review are documented in [Supabase staging](SUPABASE-STAGING.md) and [Deployment](DEPLOYMENT.md).

Supabase Storage is not used by the current private data path. If future report artifacts enter Storage, private buckets and object-level RLS require a separate reviewed migration and test.

## External integrations and operations

- Live AI synthesis is implemented behind the provider-neutral interface and verified against Groq's API with `openai/gpt-oss-120b`, the only offered model that supports strict `json_schema` output. The model never selects cards: it receives the already-locked draw, its curated meanings, each card's position function, the question, and the minimised trait lens, and card identity and orientation are restored from the draw after generation. Any error, timeout, or invalid response falls back to the deterministic reader. Still required before production: an approved provider contract, a no-retention configuration, redaction validation, cost/latency budgets, and the safety evaluation suite.
- Deploy Preview live synthesis currently uses a staging credential in Netlify's `deploy-preview` context. The current Netlify plan does not support scope-specific variables or write-only secret values, so the key is available to every site-level execution scope and remains readable to authorized Netlify operators. The disclosed staging key must be rotated, and a secrets tier or external runtime vault with least-privilege scopes must be in place before production.
- Readings no longer carry a disclaimer. The standing statement about what a reading is and is not lives at `/terms`, linked from the footer of every page. Readings are written in a direct, predictive voice by owner decision; the safety classifier still refuses to diagnose, predict death or pregnancy, determine guilt, or assert private facts about third parties, and still interrupts for crisis.
- Stripe signature, reconciliation, replay, failure-release, refund, dispute, and revocation behavior is automated and documented in [Commerce verification](COMMERCE.md). Test keys, price ID, webhook secret, public endpoint rehearsal, and owner policy are still required. Partial refunds and won disputes deliberately remain review states instead of silently choosing access policy.
- A non-login server database role now keeps browser JWTs away from private tables. Dual-key reads, batched re-encryption, a guarded operational-retention command, CI logical backup/restore, a no-telemetry boundary test, and incident runbook are implemented. Protected staging now requires a non-vacuous, synthetic-only provider-database key-rotation rehearsal and an always-run rollback to the deployed key. Provider-managed restore, production secret-store cutover/audit, approved private-data durations/scheduling, distributed rate limiting, durable async report jobs, email policy, provider telemetry/log review, named responders, and regional crisis resources remain production gates; see [Operations and recovery](OPERATIONS.md).
- Production connection-pool sizing and the database role used by `DATABASE_URL` must be load tested on the selected Supabase plan.

## Calculation, content, and owner decisions

- Western astrology is startup-guarded against flag activation until its ephemeris/timezone licensing, complete convention manifest, 100-chart independent reference suite, failure contracts, and named expert sign-off are approved.
- BaZi is startup-guarded against flag activation until its calendar/solar-term/timezone/true-solar-time/Zi-hour convention manifest, 100-case independent reference suite, and named expert sign-off are approved.
- Dreamspell remains `implemented_pending_approved_reference_dataset` until its 60-date decoder suite, Dreamspell-specific terminology, content/asset rights register, and domain/rights approvals are complete. See [Profile calculations](PROFILE-CALCULATIONS.md) for the exact gates.
- Planetary-angularity mapping remains unavailable until the Swiss Ephemeris license choice, pinned data, validated geocoder/historical timezone integration, angular-line reference suite, and original conditional interpretation rules are approved.
- Nine Star Ki remains pending independent certification until its fixed annual/monthly boundary table, the selected Lo Shu third-star derivation, and boundary cases match an approved reference suite. The current result is convention-bound and does not claim minute-level solar-term precision.
- Pricing, refunds, age policy, legal/privacy copy, launch regions, retention, backup policy, and final artwork distribution approval remain owner decisions.

Automated accessibility scanning excludes frames injected by the deploy-preview host. Those carry `aria-required-children` and `aria-hidden-focus` violations in the host's own toolbar markup, which this project does not ship, cannot repair, and which production does not serve. The application embeds no frames of its own — the suite asserts that, so the exclusion cannot begin hiding our own markup unnoticed.

No production payment, AI, Supabase, authentication, persistence, or deployment path should be described as verified until its credentialed staging evidence is recorded.
