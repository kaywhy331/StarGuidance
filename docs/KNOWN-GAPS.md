# Known gaps and production gates

## Implemented on this stacked branch

- Explicit `local`/`supabase` runtime selection with no fallback; hosted contexts reject local sessions.
- Supabase passwordless Auth, callback/session handling, sign-out, and service-role account identity deletion.
- User-scoped Postgres repositories for every private MVP entity plus durable export and deletion.
- AES-256-GCM persistence for raw birth data, calculation payloads, questions, follow-ups, and optional feedback comments.
- Atomic session/locked-draw persistence, append-only outputs, same-draw retry/follow-up, durable recovery, and immutable profile history.
- Durable Stripe order, entitlement, report, and webhook-idempotency storage.
- Forced RLS/public privilege revocation and a two-subject isolated-Postgres test covering cross-user profile, snapshots, readings, draw, question, follow-up, report, order, export source data, and deletion.

## Credential-blocked staging verification

No Supabase or Netlify secrets are present in this environment. Therefore the migration and seed have not been applied to an owner-managed Supabase staging project, real Supabase Auth users have not run the adversarial RLS procedure, and this stacked branch has no verified Netlify Deploy Preview. Required variable names and configuration locations are listed in [Supabase staging](SUPABASE-STAGING.md); secret values must never be pasted into chat.

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
