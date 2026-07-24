# Known gaps and production gates

## Implemented on this stacked branch

- Explicit `local`/`supabase` runtime selection with no fallback; hosted contexts reject local sessions.
- Supabase passwordless Auth, callback/session handling, sign-out, and service-role account identity deletion.
- User-scoped Postgres repositories for every private MVP entity plus durable export and deletion.
- AES-256-GCM persistence for raw birth data, calculation payloads, questions, follow-ups, and optional feedback comments.
- Atomic session/locked-draw persistence, append-only outputs, same-draw retry/follow-up, durable recovery, and immutable profile history.
- Durable Stripe order, entitlement, report, and webhook-idempotency storage.
- Forced RLS/public privilege revocation and a two-subject isolated-Postgres test covering cross-user profile, snapshots, readings, draw, question, follow-up, report, order, export source data, and deletion.
- Four-question profile onboarding: required full birth name and date, plus independent optional birth city/country and birth time fields. No timezone, time-confidence mode, or Latin rendering is requested.
- Non-Latin names preserve the original input and reduce unsupported name-derived numerology detail instead of blocking the profile or inventing a transliteration.

## Credential-backed staging status

Netlify Deploy Preview #4 is active with the staging Supabase adapter. The redacted runtime probe confirms that local persistence is disabled, required environment-variable names are present, Render `/health` returns 200, and an unauthenticated profile computation returns 401. The profile-engine client retains its eight-second timeout; prefer an always-on staging instance, and treat any bounded transient retry policy as a separately reviewed change.

Passwordless initiation with a non-deliverable synthetic address returned a generic rejection. An owner-controlled staging inbox is still required to verify the complete magic-link callback, authenticated profile persistence, refresh recovery, export, and account/Auth deletion. The authoritative Drizzle migration and two-user RLS procedure also remain to be executed against the owner-approved Supabase project from an operator shell that exposes `DATABASE_URL` and `DATABASE_INTEGRATION_URL` by name. Secret values must never be pasted into chat or recorded in evidence.

Supabase Storage is not used by the current private data path. If future report artifacts enter Storage, private buckets and object-level RLS require a separate reviewed migration and test.

## External integrations and operations

- AI synthesis still needs an approved provider key, no-retention contract, redaction validation, and safety evaluation. The deterministic fallback remains active.
- Stripe needs test keys, price ID, webhook secret, public test endpoint, refund/revocation tests, and owner commerce policy.
- Durable async report jobs, distributed rate limiting, key rotation, backup/restore, retention automation, telemetry redaction, incident response, email policy, and regional crisis resources remain production gates.
- Production connection-pool sizing and the database role used by `DATABASE_URL` must be load tested on the selected Supabase plan.

## Calculation, content, and owner decisions

- Western astrology needs ephemeris licensing, conventions, reference cases, and expert sign-off.
- BaZi needs approved boundaries, reference cases, and expert sign-off.
- Dreamspell needs an approved decoder dataset and terminology/rights review.
- Pricing, refunds, age policy, legal/privacy copy, launch regions, retention, backup policy, and final artwork distribution approval remain owner decisions.

No production payment, AI, Supabase, authentication, persistence, or deployment path should be described as verified until its credentialed staging evidence is recorded.
