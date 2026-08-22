# Operations and recovery

This runbook separates what the repository can prove from what an owner or provider must approve. All commands are staging-first, output counts/status only, and assume secret values are already present in an operator shell or managed secret store. Never paste a URL, key, token, private payload, log body, or backup into a PR or support ticket.

## Database privilege boundary

Authenticated browsers receive Supabase's `authenticated` role for Auth only. Migration `0004_server_actor_role` removes that role's access to every private application table. The Next.js server verifies the Auth subject, explicitly assumes the `starguidance_app` role, binds only that subject to `request.jwt.claim.sub`, and remains constrained by forced RLS. The role is `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`, and non-administrative.

The server-only `DATABASE_URL` role must be able to `SET LOCAL ROLE starguidance_app`; migration 0004 grants that membership to the migration role. Service repositories run only for the Stripe webhook and other explicit operator boundaries. Health, isolated Postgres tests, and protected staging verify both positive server-role access and negative browser-role access. A deployment fails health if `authenticated` can select a user, update a draw, or insert an entitlement.

## Role-separated queue diagnostics and recovery

An authorized operator can inspect both durable queues without opening application records or emitting raw failures:

```bash
pnpm --filter @starguidance/database jobs:inspect
```

Provide `DATABASE_URL` only through the operator shell or managed secret store. The command is read-only and returns aggregate counts by queue status plus a closed set of failure classes. SQL converts every legacy or unexpected `last_error` to `interpretation_unclassified` or `report_unclassified` before it leaves Postgres. It never returns user/reading/report/job IDs, questions, report text, encrypted source, URLs, exception messages, or credentials.

The authenticated `/operations` surface applies a narrower server-only role boundary:

- `SUPPORT_USER_IDS` is a comma-separated UUID allowlist. Support sees aggregate queue health, closed 24-hour product-event counts, read-only effective configuration, and exact opaque trace lookup. A trace returns only the entered UUID plus matching entity type, status, and creation timestamp—never user IDs, questions, profile facts, report content, encrypted values, or raw errors.
- `OPERATOR_USER_IDS` is a separate UUID allowlist whose members inherit support visibility and may retry only a retained job currently locked in `failed`. The row is checked under a database lock, requests are same-origin and limited to 12 per operator per hour, and the retry plus its `operations.job.retried` audit receipt commit atomically.
- A malformed allowlist fails operational access closed. Support cannot mutate configuration. Operators receive the governed controls below; no browser role receives direct table privileges.

Use opaque IDs only when a person has supplied the relevant reading/report/order reference through an approved support channel. Do not ask for screenshots containing questions or birth data. Named role owners, staff offboarding, periodic access review, and production incident escalation remain launch responsibilities.

## Governed runtime and content releases

Migration `0021_optimal_frightful_four` adds an app-only, forced-RLS configuration ledger with one published version per domain: `content`, `prompts`, `commerce`, `features`, and `models`. `pnpm db:seed` installs conservative system-approved version 1 records only when a domain has no history. The content release explicitly locks the deck, card set, meanings, spread catalog, interpretation rules, and enabled spread IDs.

The operator console enforces this sequence:

1. Create a strict-schema draft. Unknown keys, unreviewed prompt bundles, unknown spreads, and models outside `AI_PROVIDER_ALLOWED_MODELS` are rejected.
2. A different operator approves the draft. The database rejects creator/approver identity equality.
3. Publish the approved version. Archiving the prior release, publishing the target, and recording the audit receipt share one transaction and advisory domain lock.
4. Roll back to an earlier approved or system-bootstrap release with the exact `ROLL BACK` confirmation. The action is audited and preserves all version history.

Deck, spread, and product activation switches are separate restrictive controls for new sessions. They never change historical locked readings. Emergency AI/model/payment actions use `DISABLE NOW`, create an immediate published restrictive version, and record an audit receipt. Emergency controls cannot re-enable a capability; restoration uses the reviewed approval/rollback path. Production still requires two named operators, access-review cadence, and an approved change window.

## Data-encryption key rotation

`DATA_ENCRYPTION_KEY` is the current write key. `DATA_ENCRYPTION_KEYS_PREVIOUS` accepts at most three comma-separated rollback keys during a bounded rotation. Reads try current then previous; all writes use current. Keys must be canonical base64 for exactly 32 random bytes.

`GUEST_TRIAL_SECRET` is the separate production ephemeral-boundary key. It derives distinct receipt-encryption, marker-signing, browser-ID, and network-quota subkeys; never copy or manually reuse a database encryption, readiness, worker, profile-engine, AI, or payment secret as this value. Rotation intentionally invalidates outstanding seven-day guest handoffs. Existing signed trial cookies then fail closed into account conversion rather than granting another draw. Because the guest lane has no server-side artifact to re-encrypt, there is no previous-key overlap: schedule routine rotation after the seven-day handoff window, or rotate immediately on suspected compromise and communicate that unfinished guest continuations have expired. Verify the free-reading route, a prior-marker browser, and a newly issued signup handoff after deployment without recording questions or secret values.

Netlify Deploy Previews have one bounded exception for testability. During a real `deploy-preview` build, Next.js inlines only Netlify's non-secret `REVIEW_ID`. At runtime, the guest security module also requires `APP_ENV=staging`, a valid Netlify `SITE_ID`, and a valid `DATA_ENCRYPTION_KEY`; it then uses HMAC-SHA-256 with a versioned site-and-review context to derive a guest-only subroot before deriving the four ordinary guest keys. The data key is never used directly to sign or encrypt a guest artifact, previews for different sites or PRs receive different subroots, and production or incomplete metadata cannot select this path. A present but malformed `GUEST_TRIAL_SECRET` also blocks the fallback. Rotating the data key invalidates outstanding preview receipts, which is acceptable for disposable UAT; production receipt continuity remains governed only by the dedicated guest key.

The protected staging workflow performs a credentialed database-side rehearsal before cleanup. It keeps one reserved-domain synthetic user, selects only reserved-domain Auth subjects even when ordinary staging accounts coexist, refuses a vacuous zero-subject or zero-row run, generates a masked ephemeral key, re-encrypts every supported synthetic envelope, verifies that no synthetic row needs the old key, and then runs an `always()` rollback that restores and verifies the configured staging key. Synthetic maintenance assumes `starguidance_app` and binds each retained subject exactly as the server does, so forced RLS prevents the rehearsal from reading or changing any non-synthetic account and is neither disabled nor bypassed. Forward and rollback are separate mandatory gate stages, so a partial rotation or failed restoration cannot report `PASSED`. The ephemeral key is never committed, uploaded, or installed in Netlify/GitHub configuration.

That rehearsal proves the data path and rollback against the provider database. It does not rotate the managed deployment secret, approve a rollback window, or prove a production secret-store audit trail; those remain owner-controlled cutover work.

Rehearse on a disposable restored database before staging, and on staging before production:

1. Confirm a fresh provider backup and complete the restore verification below.
2. Generate a new managed key outside the repository. Move the old current key into `DATA_ENCRYPTION_KEYS_PREVIOUS`, place the new key in `DATA_ENCRYPTION_KEY`, and deploy both together. Do not remove the old key yet.
3. Inventory every encrypted storage location without writing:

   ```bash
   KEY_ROTATION_MODE=inventory pnpm --filter @starguidance/database key-rotation
   ```

4. Re-encrypt rows in bounded batches. The command compares the prior ciphertext during update and fails on a concurrent change. It also rewrites any remaining pre-AAD (v1) envelope into the context-bound v2 form even when the row already uses the current key, so a completed rotation leaves every envelope bound to its data class and owner:

   ```bash
   KEY_ROTATION_MODE=reencrypt \
   KEY_ROTATION_CONFIRM=REENCRYPT_WITH_CURRENT_KEY \
   pnpm --filter @starguidance/database key-rotation
   ```

5. Prove every birth-profile copy, calculation envelope, reading question, follow-up, optional feedback comment, and pending Checkout/report-job source authenticates with the current key:

   ```bash
   KEY_ROTATION_MODE=verify-current pnpm --filter @starguidance/database key-rotation
   ```

6. Exercise onboarding, history, reading recovery, follow-up, export, and deletion in staging. Record counts and pass/fail only.
7. Remove previous keys from application scope in a later change after the approved rollback window. Retain or destroy escrowed key material according to the approved backup-retention policy.

If any envelope cannot authenticate, stop. Keep both keys, restore no data over the affected database, and begin the incident procedure. The tool never prints key material, plaintext, or ciphertext.

## Backup and restore

CI creates an encrypted synthetic profile, locked reading, order, active entitlement, and report; takes a PostgreSQL custom-format dump; restores it into a separately named database; verifies encryption authentication and exact snapshot lineage across profile, reading, order, entitlement, and report; then removes the fixture and restored database. This proves the repository-level logical procedure on PostgreSQL 16, not the owner provider's backup schedule, PITR window, regions, or recovery-time objective.

For provider rehearsal:

1. Confirm the target is an isolated empty project/database and that no production endpoint can reach it.
2. Capture provider backup ID/time, Postgres version, migration count, encryption-key escrow availability, and source region without recording credentials.
3. Restore roles/globals as required by the provider, then the custom-format database with fail-on-error enabled.
4. Run migrations only if the restore intentionally targets an older migration point; never rewrite applied migration files.
5. Run the restore fixture verification, full database integration suite, two-user RLS isolation, encrypted read/export, locked-draw recovery, entitlement/report access, and account deletion.
6. Record RPO, RTO, migration IDs, row-count checks, and pass/fail. Destroy the isolated restore and its credentials.

Production remains blocked until an owner approves backup/PITR frequency, retention, region, encryption, RPO/RTO, responsible operator, and at least one provider-hosted restore rehearsal.

## Retention

No duration is silently selected in code. The approved policy must assign an owner, purpose, legal basis, cutoff, deletion behavior, backup lag, and exception process to each class:

| Data class                                              | Current deletion behavior                                                                                                                   | Automation status                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Raw birth data and derived snapshots                    | Account deletion cascades; profile/history deletion is user-scoped                                                                          | Duration awaits owner/privacy approval                                      |
| Reading questions, draws, outputs, follow-ups, feedback | Reading/account deletion is user-scoped; locked draw remains immutable while retained                                                       | Duration awaits owner/privacy approval                                      |
| Orders, entitlements, reports                           | Profile deletion nulls snapshot pointers and retains commerce; account deletion cascades application rows; provider records remain external | Finance/refund retention awaits approval                                    |
| Audit events                                            | Account deletion cascades                                                                                                                   | Explicit-cutoff inventory/delete tool implemented                           |
| Completed webhook claims                                | Never exposed to users; unprocessed claims are never retention-deleted                                                                      | Explicit-cutoff inventory/delete tool implemented                           |
| Completed interpretation jobs                           | Result lives in reading outputs; the job row is operational residue                                                                         | Pruned by the scheduled drain after 24 hours                                |
| Completed report jobs                                   | Structured sections live in report tables; the encrypted source is already cleared                                                          | Pruned by the scheduled drain after 24 hours                                |
| Expired rate-limit buckets                              | Garbage past their own `expires_at`                                                                                                         | Pruned by the scheduled drain; tool clears backlog                          |
| Failed interpretation jobs (dead letter)                | Only record of a job that gave up; never pruned automatically                                                                               | Masked inspection and audited retained-job retry implemented                |
| Failed report jobs                                      | Retains the encrypted minimized source so the paid report can be retried                                                                    | Masked inspection/retry implemented; deletion awaits finance/privacy policy |
| Hosted logs and backups                                 | Provider-controlled                                                                                                                         | Dashboard/contract approval required                                        |

The retention tool defaults to inventory. It can delete only audit events and completed webhook claims; a test prevents it from targeting profiles, readings, reports, orders, or entitlements. Use exact past UTC cutoffs and a non-sensitive approved policy identifier:

```bash
RETENTION_MODE=inventory pnpm --filter @starguidance/database retention

RETENTION_MODE=delete \
RETENTION_DELETE_CONFIRM=DELETE_BEFORE_APPROVED_CUTOFFS \
pnpm --filter @starguidance/database retention
```

`RETENTION_POLICY_VERSION`, `RETENTION_AUDIT_BEFORE`, `RETENTION_WEBHOOK_BEFORE`, and `RETENTION_FAILED_JOBS_BEFORE` must already be configured. Run inventory, review its counts, take/verify the required backup, then execute. Never delete an unprocessed webhook claim. Failed interpretation jobs are dead-letter records and failed report jobs additionally retain the encrypted recovery source; review fixed failure classes and the paid entitlement before approving any cutoff. The current retention command does not delete failed report jobs.

## Telemetry and hosted logs

No Sentry, PostHog, Segment, Mixpanel, server content logger, or equivalent SDK is installed. First-party measurement is stored in `product_events` (migrations `0019`, `0020`, and `0022`) behind forced RLS and app-only insert/select grants. The application and database both enforce a closed event/property vocabulary. It has no user ID, email, birth field, profile statement/calculation, raw question/follow-up, card identity, reading URL, report prose, cookie, authorization value, provider payload, or arbitrary exception. The caller's idempotency value is SHA-256 digested before storage. Measurement failure never blocks a user or payment flow.

The every-minute durable-job trigger also evaluates content-free operational signals:

- queue depth above 20 or oldest claimable work above 180 seconds;
- any interpretation/report job failure in the current drain;
- more than 20 auth failures, 5 profile failures, 5 generation failures, or 3 generations over 15 seconds in five minutes;
- more than 2 payment failures in fifteen minutes;
- hourly live-AI volume above `OPERATIONAL_LIVE_AI_VOLUME_ALERT_THRESHOLD` (default 500) as a bounded cost proxy.

Every alert contains only class, severity, observed count, threshold, and `staging | production | unknown`. Configure one managed HTTPS `OPERATIONAL_ALERT_WEBHOOK_URL` to deliver it; invalid or non-HTTPS targets are ignored, and webhook failures are logged without the target or body. This repository path does not prove receiver ownership, paging escalation, database/host uptime alerts, or provider-native billing caps. Those must be configured and rehearsed by accountable operators before launch.

## Incident response

1. **Detect and classify:** identify affected service, time window, data class, region, and whether confidentiality, integrity, availability, payment, or safety is involved. Record opaque IDs and fixed classes only.
2. **Contain:** disable the affected feature flag/provider, stop retention or rotation jobs, revoke sessions where required, restrict operator access, and preserve the locked draw. Do not destroy evidence or silently reshuffle.
3. **Protect credentials:** rotate the specific AI, Stripe, Supabase, Render, Netlify, profile-engine, database, or encryption credential through its owner console. For encryption incidents, keep the prior key available until row authentication and recovery are proven.
4. **Assess safely:** inspect provider audit trails and redacted samples with least privilege. Never download broad raw logs into chat, Git, screenshots, or personal devices.
5. **Recover:** deploy a reviewed fix, restore only into an isolated target first, run security/integrity tests, and verify exact deployed commit plus rollback path.
6. **Notify:** the accountable owner/counsel decides user, regulator, processor, payment, or law-enforcement notification based on approved regions and deadlines. The repository does not invent those legal decisions.
7. **Close:** document root cause, affected counts, timeline, rotations, deletion/restore actions, validation evidence, and follow-up owner. Add a regression test without private production data.

Named on-call roles, escalation contacts, breach deadlines, regional crisis resources, and customer-support templates remain owner-controlled launch gates.
