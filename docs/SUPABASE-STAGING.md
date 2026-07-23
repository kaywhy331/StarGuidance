# Supabase staging verification

This procedure is intentionally credential-gated. Use a disposable Supabase project with no production data. Secret values belong in the operator shell, Supabase secret manager, GitHub Actions environment secrets, or Netlify UI—not Git, chat, screenshots, logs, fixtures, or PR text.

## Required configuration

Configure these for the Netlify **Deploy Previews** context:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `DATABASE_URL`
- `DATA_ENCRYPTION_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROFILE_ENGINE_URL`
- `PROFILE_ENGINE_SHARED_SECRET`

`APP_ENV=staging` and `RUNTIME_ADAPTER=supabase` are non-secret context values committed in `netlify.toml`. `DEPLOY_PRIME_URL` supplies the callback origin automatically. Add the deploy-preview callback wildcard and exact staging callback to Supabase Auth redirect allowlists.

For migration and isolated SQL verification, configure only in the operator shell:

- `DATABASE_URL` — disposable staging migration/seed target
- `DATABASE_INTEGRATION_URL` — disposable integration target; it may equal `DATABASE_URL` only when the whole project is disposable

Generate `DATA_ENCRYPTION_KEY` as 32 random bytes encoded in base64. Store and back it up in a managed secret service. The key must never be placed in a database row or migration.

## Apply and verify

1. Confirm the target project name/ref twice and confirm it contains no production data.
2. Run `corepack pnpm db:check`.
3. Run `corepack pnpm db:migrate` with the disposable `DATABASE_URL`.
4. Run `corepack pnpm db:seed` with the same URL.
5. Run `corepack pnpm --filter @starguidance/database test:integration` with `DATABASE_INTEGRATION_URL`.
6. Create two temporary Supabase Auth users through an operator-only process. Do not use real people or personal email addresses.
7. With each user independently authenticated, create synthetic profiles, two snapshots for one user, a reading/follow-up, report entitlement, and order.
8. Verify user A receives not-found/empty results for user B's profile, snapshots, reading, draw, encrypted question, follow-up, report, order, and export—and vice versa. Verify cross-user insert/update/delete attempts are rejected by RLS.
9. Force one generation failure, refresh, retry, and submit a follow-up. Compare reading ID, deck/spread/shuffle versions, locked timestamp, positions, card IDs, orientations, and orders byte-for-byte before and after.
10. Update birth data and confirm the prior reading still references snapshot v1 while only future readings use v2.
11. Export user A, then delete the account. Confirm all user-A database rows and the Auth identity are gone while user B remains intact.
12. Delete the temporary Auth users/project after evidence is captured. Record only non-secret pass/fail results and migration IDs.

## Required evidence before this gate closes

- successful migration and seed output with connection details redacted;
- two real Auth subject IDs represented only by non-sensitive aliases in the test report;
- per-resource RLS pass/fail table;
- locked-draw equality digest before/after recovery, retry, and follow-up;
- profile lineage, export, and deletion results;
- Netlify Deploy Preview URL and green build/function logs with secrets redacted;
- confirmation that deploy-preview environment values are scoped away from production.

If any required variable is absent, stop. Report the variable name and its configuration location only; never request the value in chat.
