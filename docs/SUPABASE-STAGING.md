# Supabase staging verification

This procedure is intentionally credential-gated. Use a disposable Supabase project with no production data. Secret values belong in the operator shell, Supabase secret manager, GitHub Actions environment secrets, or Netlify UI—not Git, chat, screenshots, logs, fixtures, or PR text.

`packages/database/migrations` is the authoritative Drizzle migration history. The connected Supabase GitHub integration is not a migration authority and must not create or apply a second `supabase/migrations` source. Keep Supabase automatic **Deploy to production** disabled; the integration's Preview check may remain skipped while migrations are applied explicitly from the operator shell.

Applied migrations are immutable. A correction is always a new migration; `packages/database/tests/migration-integrity.test.ts` pins the digest of every applied file so an edit fails a test instead of silently diverging databases that already ran it.

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

`APP_ENV=staging` and `RUNTIME_ADAPTER=supabase` are non-secret build values committed in `netlify.toml`. Netlify serverless functions do not receive configuration-file values at runtime, so configure the same names and values in the Netlify UI for the **Deploy Previews** context with **Functions** scope. `DEPLOY_PRIME_URL` is build-only; runtime Auth redirects use the request origin on Netlify previews. Add the deploy-preview callback wildcard and exact staging callback to Supabase Auth redirect allowlists.

Configure the Render profile-engine service using the exact settings in [Deployment](DEPLOYMENT.md): Docker runtime, `apps/profile-engine` root directory, `./Dockerfile`, `.` build context, and `/health`. Render must set `APP_ENV=staging` and the server-only `PROFILE_ENGINE_SHARED_SECRET`; Netlify must use the same managed secret. Confirm variable names only. Never echo either service's value or authorization header.

For migration and isolated SQL verification, configure only in the operator shell:

- `DATABASE_URL` — disposable staging migration/seed target
- `DATABASE_INTEGRATION_URL` — disposable integration target; it may equal `DATABASE_URL` only when the whole project is disposable

Generate `DATA_ENCRYPTION_KEY` as 32 random bytes encoded in base64. Store and back it up in a managed secret service. The key must never be placed in a database row or migration.

## Apply and verify

1. Confirm the target project name/ref twice and confirm it contains no production data.
2. Confirm only that `DATABASE_URL` and `DATABASE_INTEGRATION_URL` are present in the operator shell; do not print their values.
3. Run `corepack pnpm --filter @starguidance/database staging:migration-history`, which runs `drizzle-kit check` and the migration-immutability assertions.
4. Run `corepack pnpm db:migrate` with the disposable `DATABASE_URL`, then confirm no `sync_authenticated_user_after_insert` trigger and no `public.sync_authenticated_user()` function remain.
5. Run `corepack pnpm db:seed` twice with the same URL and confirm the second execution is idempotent.
6. Run `corepack pnpm --filter @starguidance/database test:integration` with `DATABASE_INTEGRATION_URL`. CI performs this with an isolated Postgres service.
7. Confirm `/health` on the hosted profile engine and one unauthorized/authorized synthetic compute pair. Record the hostname and status results only. A suspended free instance can need a long cold start; that is not the same as unreachable.
   7a. Confirm the deploy preview reports the commit under test. `/api/health` returns `deployedCommit` in staging previews only, built from Netlify's `COMMIT_REF`; the automated suite waits up to ten minutes for the expected build and refuses to verify an earlier one, because verifying a stale preview proves nothing about the commit being gated.
8. Create two temporary Supabase Auth users through an operator-only process. Do not use real people or personal email addresses. Confirm the Admin API returns a success status rather than 500, and that no `public.users` row exists for either subject until the application is first used.

   Synthetic addresses use the reserved `starguidance.test` domain. RFC 6761 guarantees `.test` can never resolve, so no message can reach a person, and unlike `example.com` it passes Supabase's email validator — Supabase rejects `example.com` outright with `email_address_invalid`, which silently prevented every synthetic identity from being created. `packages/database/tests/synthetic-addresses.test.ts` pins both properties.

   Supabase's built-in SMTP has a low hourly send quota. Passwordless initiation can therefore be refused with `over_email_send_rate_limit` even when the application is correct; `/api/auth` reports that as HTTP 429 with `retryable: true`, and the verification suite records it as a limitation rather than a pass or a defect. Admin-created identities use `email_confirm: true` and send no mail, so they are unaffected.

9. With each user independently authenticated, create synthetic profiles, two snapshots for one user, a reading/follow-up, report entitlement, and order.
10. Verify user A receives not-found/empty results for user B's profile, snapshots, reading, draw, encrypted question, follow-up, report, order, and export—and vice versa. Verify cross-user insert/update/delete attempts are rejected by RLS.
    Also prove Supabase's browser `authenticated` role receives `42501` for a direct private-table read even with a valid subject, while the non-login `starguidance_app` role can operate only on that subject through forced RLS.
11. Force one generation failure, refresh, retry, and submit a follow-up. Compare reading ID, deck/spread/shuffle versions, locked timestamp, positions, card IDs, orientations, and orders byte-for-byte before and after.
12. Update birth data and confirm the prior reading still references snapshot v1 while only future readings use v2.
13. Export user A, then delete the account. Confirm all user-A database rows and the Auth identity are gone while user B remains intact.
    The protected workflow deliberately keeps user B until it has rehearsed application-encryption key rotation against those real synthetic rows. It refuses non-synthetic Auth identities and zero encrypted rows, assumes the subject-scoped `starguidance_app` role without bypassing forced RLS, rotates to a fresh masked ephemeral key, verifies current-key-only authentication, always rotates back to the configured staging key, and verifies again before cleanup. Neither key is recorded in evidence.
14. Inspect Netlify, Supabase, and profile-engine logs for birth data, questions, response bodies, secrets, and authorization headers. Record a redacted pass/fail result only.
15. Delete the temporary Auth users/project after evidence is captured. Record only non-secret pass/fail results and migration IDs.

## Positive PKCE magic-link smoke test

The automated suite cannot manufacture a successful `?code=` callback. Supabase binds the PKCE verifier to the browser that requested the link, while the link itself must arrive through a deliverable mailbox. An admin-generated link does not contain the browser verifier and is not an equivalent test.

Use this one-time manual procedure only with an owner-controlled staging inbox:

1. Open the exact Deploy Preview #4 URL in a fresh private browser window and confirm `/api/health` reports the expected commit and a healthy staging runtime.
2. Enter the staging inbox address on `/sign-in` and submit once. Do not put the address in a terminal, test report, screenshot, issue, or PR.
3. Open the newly delivered message in that inbox and follow its link in the same browser context that initiated sign-in. Do not copy the token or callback URL into evidence.
4. Confirm the callback lands on `/profile`, the session survives one reload, and sign-out returns the browser to an unauthenticated state.
5. Record only the date, preview commit, browser family, and pass/fail result. Delete the message and test identity according to the approved email and identity-retention policy.

An inbox address is not currently available to automation. `MAIL` in a typical runner is a local spool path, not an email address, and must not be treated as authorization to send mail.

## Required evidence before this gate closes

- successful migration and seed output with connection details redacted;
- two real Auth subject IDs represented only by non-sensitive aliases in the test report;
- per-resource RLS pass/fail table;
- locked-draw equality digest before/after recovery, retry, and follow-up;
- successful synthetic-only forward key rotation and verified rollback to the configured staging key;
- profile lineage, export, and deletion results;
- Netlify Deploy Preview URL and green build/function logs with secrets redacted;
- confirmation that deploy-preview environment values are scoped away from production.
- a redacted positive PKCE result from the owner-inbox procedure above.

If any required variable is absent, stop. Report the variable name and its configuration location only; never request the value in chat.
