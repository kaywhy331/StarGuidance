# Supabase staging verification

This procedure is intentionally credential-gated. Use an explicitly non-production Supabase staging project and obtain authorization for the migration and synthetic-fixture run. The workflow scopes identity creation, destructive fixture cleanup, and key-rotation rehearsal to reserved-domain synthetic users, so unrelated non-production beta accounts may coexist; it is never authorized against production data. Secret values belong in the operator shell, Supabase secret manager, GitHub Actions environment secrets, or Netlify UI—not Git, chat, screenshots, logs, fixtures, or PR text.

`packages/database/migrations` is the authoritative Drizzle migration history. The connected Supabase GitHub integration is not a migration authority and must not create or apply a second `supabase/migrations` source. Keep Supabase automatic **Deploy to production** disabled; the integration's Preview check may remain skipped while migrations are applied explicitly from the operator shell.

Applied migrations are immutable. A correction is always a new migration; `packages/database/tests/migration-integrity.test.ts` pins the digest of every applied file so an edit fails a test instead of silently diverging databases that already ran it.

Migration 0005 removes the legacy plaintext birth metadata copy from every existing profile snapshot, adds a request idempotency key to locked readings, and initially enforces one profile root per user plus one follow-up per reading. Its preflight refuses ambiguous duplicate roots/follow-ups instead of silently deleting or choosing records. Migration 0011 adds active deck/spread controls and replaces the singleton follow-up index with a non-unique reading index; the server then serializes count-and-insert on the owned reading row and enforces `READING_FOLLOW_UP_LIMIT` (default 1). Migration 0012 adds the forced-RLS paid-report queue and makes order, entitlement, and report snapshot pointers nullable with `ON DELETE SET NULL`; migration 0013 stages an encrypted minimized report source on a pending Checkout order so a paid purchase can recover after profile deletion. Migrations 0014–0017 add account settings, append-only consent history, ritual recovery, and sound defaults. Migration 0018 separates immutable outcome annotations from reading feedback. Migrations 0019–0020 add the forced-RLS, vocabulary-constrained first-party product-event store. Migration 0021 adds independently reviewed, immutable runtime-configuration releases; migration 0022 extends only the closed event-name vocabulary required for aggregate auth and generation alerts. Migration 0023 records model/provider, prompt, content, safety-policy, and schema provenance on every new follow-up and adds the missing safety-policy coordinate to primary outputs; older rows are labelled `legacy-unrecorded` instead of receiving invented metadata. Migration 0024 backfills deck/spread version coordinates into existing meaning and position rows, then replaces globally unique canonical card/spread IDs with version-qualified keys. It preserves every prior payload and reading reference while allowing a newer immutable release to reuse the same canonical IDs.

## How an application user comes into existence

Migration 0001 installed a SECURITY DEFINER trigger on `auth.users` that inserted the matching `public.users` row. That could never work: `FORCE ROW LEVEL SECURITY` applies to SECURITY DEFINER functions as well, `request.jwt.claim.sub` is unset inside GoTrue's signup transaction, and the `users_self` check therefore rejected the insert with `42501`. Supabase Auth surfaced that as HTTP 500 and no identity could be created at all.

Migration 0002 removes the trigger and its function. Provisioning is now a single application boundary, and no database object creates a user row:

1. Supabase Auth creates the `auth.users` row. Nothing else happens.
2. The first authenticated application request reaches `requireUser()`, which validates the Supabase subject.
3. `repositories.users.ensure()` runs as the `authenticated` role with the verified subject bound to `request.jwt.claim.sub`, so the row it upserts can only ever be the caller's own. Repeats are idempotent and the address is normalised to lower case.
4. Deleting the `auth.users` row cascades into `public.users` and every owned application table.

Nothing was relaxed to achieve this: no `BYPASSRLS` role, no service-role policy, no trigger-specific exception, no replacement SECURITY DEFINER function, and no temporary disabling of row level security. Migration 0002 fails if the foreign key, its cascade, forced RLS, policies, or then-current grants are missing. The later migration 0004 intentionally removes private-table grants from the browser `authenticated` role and gives them to a `NOLOGIN`, `NOBYPASSRLS` server actor that remains subject-scoped by the same policies.

Because that boundary is the only provisioning path, every route that touches a user-owned repository must pass through `requireUser()` first; `apps/web/src/lib/provisioning-boundary.test.ts` enforces this and requires a written justification for each exempt route.

## Required configuration

Configure these for the Netlify **Deploy Previews** context:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY`
- `DATA_ENCRYPTION_KEYS_PREVIOUS` only during a bounded key-rotation window
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROFILE_ENGINE_URL`
- `PROFILE_ENGINE_SHARED_SECRET`
- `READINESS_PROBE_SECRET`
- `INTERPRETATION_WORKER_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `READING_ACCESS_MODE`, `READING_FREE_ALLOWANCE`, and `READING_ALLOWANCE_WINDOW_HOURS`
- `READING_SESSION_TTL_MINUTES`
- `SUPPORT_USER_IDS` and `OPERATOR_USER_IDS` only when named synthetic/staff identities are approved for operational verification

`APP_ENV=staging` and `RUNTIME_ADAPTER=supabase` are non-secret build values committed in `netlify.toml`. Netlify serverless functions do not receive configuration-file values at runtime, so configure the same names and values in the Netlify UI for the **Deploy Previews** context with **Functions** scope. `DEPLOY_PRIME_URL` is build-only; runtime Auth redirects use the request origin on Netlify previews. Add the deploy-preview callback wildcard and exact staging callback to Supabase Auth redirect allowlists.

Configure the Render profile-engine service using the exact settings in [Deployment](DEPLOYMENT.md): Docker runtime, `apps/profile-engine` root directory, `./Dockerfile`, `.` build context, and `/health`. Render must set `APP_ENV=staging` and the server-only `PROFILE_ENGINE_SHARED_SECRET`; Netlify must use the same managed secret. Confirm variable names only. Never echo either service's value or authorization header.

For migration and isolated SQL verification, configure only in the operator shell:

- `DATABASE_URL` — authorized non-production staging migration/seed target; the Netlify deploy-preview copy must use Supabase transaction-pooler mode (normally port 6543), while operator migrations may use a direct or session-mode connection
- `DATABASE_INTEGRATION_URL` — isolated integration target; it may equal `DATABASE_URL` only when the owner has approved the reserved-domain synthetic fixture lifecycle on that staging project

Generate `DATA_ENCRYPTION_KEY` as 32 random bytes encoded in base64. Store and back it up in a managed secret service. The key must never be placed in a database row or migration.

## Apply and verify

1. Confirm the target project name/ref twice and confirm it contains no production data.
2. Confirm only that `DATABASE_URL` and `DATABASE_INTEGRATION_URL` are present in the operator shell; do not print their values.
3. Run `corepack pnpm --filter @starguidance/database staging:migration-history`, which runs `drizzle-kit check` and the migration-immutability assertions.
4. Run `corepack pnpm db:migrate` with the authorized staging `DATABASE_URL`, then confirm no `sync_authenticated_user_after_insert` trigger and no `public.sync_authenticated_user()` function remain, migration 0005's lineage/idempotency indexes exist, migration 0015 has one partial unique index for active consent rather than an all-history uniqueness constraint, migration 0016's intake/recovery columns exist, both background queues have forced RLS plus subject-bound actor policies, `reading_feedback` and `product_events` are forced-RLS, the primary/follow-up provenance columns from migration 0023 exist, migration 0024's composite card/deck and spread/version keys plus child lineage columns are present, and all five runtime-configuration domains have immutable version rows.
5. Run `corepack pnpm db:seed` twice with the same URL and confirm the second execution is idempotent. The seed must also succeed when an older deck uses the same canonical card IDs, while preserving both releases byte-for-byte. The second seed must preserve product kill switches and published content/configuration exactly; a payload change under an existing version must fail with `SEED_VERSION_CONFLICT` instead of mutating the release.
6. Run `corepack pnpm --filter @starguidance/database test:integration` and `corepack pnpm --filter @starguidance/web test:integration` with `DATABASE_INTEGRATION_URL`. CI performs both with an isolated Postgres service; the latter directly verifies the atomic paid-report repository transaction after profile deletion and on webhook replay.
7. Confirm `/health` on the hosted profile engine and one unauthorized/authorized synthetic compute pair. Record the hostname and status results only. A suspended free instance can need a long cold start; that is not the same as unreachable.
   7a. Confirm public web `/api/health` returns dependency-free liveness and the commit under test. The protected suite then derives the readiness bearer as base64url HMAC-SHA256 over `starguidance-readiness-v1`, keyed by the dedicated `READINESS_PROBE_SECRET`, and calls `/api/health?readiness=1`. It never sends a raw shared secret to web readiness or records the bearer. The suite waits up to ten minutes for the expected build and refuses to verify an earlier one. `PROFILE_ENGINE_SHARED_SECRET` remains exclusive to calculator authentication.
8. Create two temporary Supabase Auth users through an operator-only process. Do not use real people or personal email addresses. Confirm the Admin API returns a success status rather than 500, and that no `public.users` row exists for either subject until the application is first used.

   Synthetic addresses use the reserved `starguidance.test` domain. RFC 6761 guarantees `.test` can never resolve, so no message can reach a person, and unlike `example.com` it passes Supabase's email validator — Supabase rejects `example.com` outright with `email_address_invalid`, which silently prevented every synthetic identity from being created. `packages/database/tests/synthetic-addresses.test.ts` pins both properties.

   Supabase's built-in SMTP has a low hourly send quota. Optional signup confirmation and password recovery can therefore be refused with `over_email_send_rate_limit` even when the application is correct; `/api/auth` reports that as HTTP 429 with `retryable: true`. Routine password sign-in sends no email. Admin-created synthetic identities use `email_confirm: true` and send no mail, so they are unaffected.

9. With each user independently authenticated, create synthetic profiles, two snapshots for one user, a reading/follow-up, and report commerce fixtures. In an approved Stripe test rehearsal, confirm Checkout stores only a context-bound encrypted minimized source on the pending order, the paid webhook atomically creates one entitlement/report/job, and the order source is cleared.
10. Verify user A receives not-found/empty results for user B's profile, snapshots, reading, draw, encrypted question, follow-up, report, order, and export—and vice versa. Verify cross-user insert/update/delete attempts are rejected by RLS.
    Also prove Supabase's browser `authenticated` role receives `42501` for a direct private-table read even with a valid subject, while the non-login `starguidance_app` role can operate only on that subject through forced RLS. Verify both `interpretation_jobs` and `report_jobs` are cross-subject invisible and their connection-role sweeps remain operational.
11. Force one generation failure, refresh, retry, and submit a follow-up. Compare reading ID, deck/spread/shuffle versions, locked timestamp, positions, card IDs, orientations, and orders byte-for-byte before and after.
12. Update birth data and confirm the prior reading still references snapshot v1 while only future readings use v2.
13. Delete user A's profile first. Confirm birth snapshots/readings are removed while paid orders, entitlements, reports, and any pending paid fulfillment survive with null snapshot pointers; confirm the minimized source can still produce the purchased report. Export user A and confirm feedback plus revoked report content are included, then delete the account. Confirm all user-A application rows and the Auth identity are gone while user B remains intact.
    The protected workflow deliberately keeps user B until it has rehearsed application-encryption key rotation against those real synthetic rows. It selects only reserved-domain synthetic Auth identities even when ordinary staging accounts coexist, refuses zero synthetic identities or encrypted rows, assumes the subject-scoped `starguidance_app` role without bypassing forced RLS, rotates to a fresh masked ephemeral key, verifies current-key-only authentication, always rotates back to the configured staging key, and verifies again before cleanup. Because no non-synthetic subject is ever bound, forced RLS prevents the rehearsal from reading or changing another account's rows. Neither key is recorded in evidence.
14. Inspect Netlify, Supabase, and profile-engine logs for birth data, questions, response bodies, secrets, and authorization headers. Record a redacted pass/fail result only.
15. Delete the temporary Auth users/project after evidence is captured. Record only non-secret pass/fail results and migration IDs.

## Positive credential and recovery smoke test

The protected suite proves password sign-in using an ephemeral Supabase identity, then checks that the same encrypted profile survives sign-out and password re-entry. Delivered signup-confirmation and recovery messages still require the owner-managed templates documented in [Deployment](DEPLOYMENT.md). Their portable token-hash callbacks remove the hidden same-browser dependency; an admin-generated link is not equivalent to a delivered message and must not be used as proof.

Use this one-time manual procedure only with an owner-controlled staging inbox:

1. Open the exact Deploy Preview #19 URL in a fresh private browser window and confirm `/api/health` reports liveness and the expected commit. Confirm deep staging readiness from the protected workflow summary, not from the public endpoint.
2. Register the staging inbox on `/sign-up` with a unique test password. Do not put the address or password in a terminal, test report, screenshot, issue, or PR. The protected browser suite first generates a non-delivered synthetic signup action and fails if Supabase substitutes its Site URL (commonly localhost) for the deployed callback; this proves the redirect allowlist without exposing the action link or token. If **Confirm email** is disabled, confirm registration lands directly on `/onboarding`; if enabled, open the delivered confirmation once and confirm the callback lands there. The manual inbox step remains required because action generation cannot prove the configured email template or delivery provider.
3. Sign out, return to `/sign-in`, and authenticate with the password. Confirm no email is sent, the prior profile remains available, the session survives one reload, and sign-out revokes access.
4. Use `/forgot-password`, open the newly delivered recovery message through the mail application's normal browser handoff, choose a new password, and sign in with it. Do not copy the token or callback URL into evidence.
5. Record only the date, preview commit, browser family, confirmation setting, and pass/fail result. Delete the messages and test identity according to the approved email and identity-retention policy.

An inbox address is not currently available to automation. `MAIL` in a typical runner is a local spool path, not an email address, and must not be treated as authorization to send mail.

## Required evidence before this gate closes

- successful migration and seed output with connection details redacted;
- two real Auth subject IDs represented only by non-sensitive aliases in the test report;
- per-resource RLS pass/fail table;
- locked-draw equality digest before/after recovery, retry, and follow-up;
- numeric interpretation and report queue depths from the authenticated drain probe;
- singular paid-report fulfillment plus profile-deletion recovery results from the approved commerce rehearsal;
- successful synthetic-only forward key rotation and verified rollback to the configured staging key;
- profile lineage, export, and deletion results;
- Netlify Deploy Preview URL and green build/function logs with secrets redacted;
- confirmation that deploy-preview environment values are scoped away from production;
- a redacted signup-confirmation/recovery result from the owner-inbox procedure above.

If any required variable is absent, stop. Report the variable name and its configuration location only; never request the value in chat.
