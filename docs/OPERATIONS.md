# Operations and recovery

This runbook separates what the repository can prove from what an owner or provider must approve. All commands are staging-first, output counts/status only, and assume secret values are already present in an operator shell or managed secret store. Never paste a URL, key, token, private payload, log body, or backup into a PR or support ticket.

## Database privilege boundary

Authenticated browsers receive Supabase's `authenticated` role for Auth only. Migration `0004_server_actor_role` removes that role's access to every private application table. The Next.js server verifies the Auth subject, explicitly assumes the `starguidance_app` role, binds only that subject to `request.jwt.claim.sub`, and remains constrained by forced RLS. The role is `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS`, and non-administrative.

The server-only `DATABASE_URL` role must be able to `SET LOCAL ROLE starguidance_app`; migration 0004 grants that membership to the migration role. Service repositories run only for the Stripe webhook and other explicit operator boundaries. Health, isolated Postgres tests, and protected staging verify both positive server-role access and negative browser-role access. A deployment fails health if `authenticated` can select a user, update a draw, or insert an entitlement.

## Data-encryption key rotation

`DATA_ENCRYPTION_KEY` is the current write key. `DATA_ENCRYPTION_KEYS_PREVIOUS` accepts at most three comma-separated rollback keys during a bounded rotation. Reads try current then previous; all writes use current. Keys must be canonical base64 for exactly 32 random bytes.

The protected staging workflow performs a credentialed database-side rehearsal before cleanup. It keeps one reserved-domain synthetic user, refuses to run if any non-synthetic application user exists, refuses a vacuous zero-row run, generates a masked ephemeral key, re-encrypts every supported envelope, verifies that no row needs the old key, and then runs an `always()` rollback that restores and verifies the configured staging key. Forward and rollback are separate mandatory gate stages, so a partial rotation or failed restoration cannot report `PASSED`. The ephemeral key is never committed, uploaded, or installed in Netlify/GitHub configuration.

That rehearsal proves the data path and rollback against the provider database. It does not rotate the managed deployment secret, approve a rollback window, or prove a production secret-store audit trail; those remain owner-controlled cutover work.

Rehearse on a disposable restored database before staging, and on staging before production:

1. Confirm a fresh provider backup and complete the restore verification below.
2. Generate a new managed key outside the repository. Move the old current key into `DATA_ENCRYPTION_KEYS_PREVIOUS`, place the new key in `DATA_ENCRYPTION_KEY`, and deploy both together. Do not remove the old key yet.
3. Inventory every encrypted storage location without writing:

   ```bash
   KEY_ROTATION_MODE=inventory pnpm --filter @starguidance/database key-rotation
   ```

4. Re-encrypt rows in bounded batches. The command compares the prior ciphertext during update and fails on a concurrent change:

   ```bash
   KEY_ROTATION_MODE=reencrypt \
   KEY_ROTATION_CONFIRM=REENCRYPT_WITH_CURRENT_KEY \
   pnpm --filter @starguidance/database key-rotation
   ```

5. Prove every birth-profile copy, calculation envelope, reading question, follow-up, and optional feedback comment authenticates with the current key:

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

| Data class                                              | Current deletion behavior                                                             | Automation status                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Raw birth data and derived snapshots                    | Account deletion cascades; profile/history deletion is user-scoped                    | Duration awaits owner/privacy approval            |
| Reading questions, draws, outputs, follow-ups, feedback | Reading/account deletion is user-scoped; locked draw remains immutable while retained | Duration awaits owner/privacy approval            |
| Orders, entitlements, reports                           | Account deletion cascades in the MVP; provider records remain external                | Finance/refund retention awaits approval          |
| Audit events                                            | Account deletion cascades                                                             | Explicit-cutoff inventory/delete tool implemented |
| Completed webhook claims                                | Never exposed to users; unprocessed claims are never retention-deleted                | Explicit-cutoff inventory/delete tool implemented |
| Hosted logs and backups                                 | Provider-controlled                                                                   | Dashboard/contract approval required              |

The retention tool defaults to inventory. It can delete only audit events and completed webhook claims; a test prevents it from targeting profiles, readings, reports, orders, or entitlements. Use exact past UTC cutoffs and a non-sensitive approved policy identifier:

```bash
RETENTION_MODE=inventory pnpm --filter @starguidance/database retention

RETENTION_MODE=delete \
RETENTION_DELETE_CONFIRM=DELETE_BEFORE_APPROVED_CUTOFFS \
pnpm --filter @starguidance/database retention
```

`RETENTION_POLICY_VERSION`, `RETENTION_AUDIT_BEFORE`, and `RETENTION_WEBHOOK_BEFORE` must already be configured. Run inventory, review its counts, take/verify the required backup, then execute. Never delete an unprocessed webhook claim.

## Telemetry and hosted logs

No Sentry, PostHog, Segment, Mixpanel, server content logger, or equivalent SDK is installed. An automated boundary test rejects those server call sites until a reviewed allowlisted adapter exists. Health and staging evidence publish names, booleans, status codes, fixed reason classes, counts, and synthetic aliases only.

Before enabling telemetry, define a strict event schema containing operational fields only—for example release, route template, status class, duration bucket, fixed error class, and opaque trace ID. Reject arbitrary objects and strings. Never include email, birth data, profile traits/calculations, question/follow-up text, cards plus question context, report prose, authorization/cookies, provider payloads, URLs with query strings, or exception messages that may quote them. Complete the hosted control-plane review in [Deployment](DEPLOYMENT.md).

## Incident response

1. **Detect and classify:** identify affected service, time window, data class, region, and whether confidentiality, integrity, availability, payment, or safety is involved. Record opaque IDs and fixed classes only.
2. **Contain:** disable the affected feature flag/provider, stop retention or rotation jobs, revoke sessions where required, restrict operator access, and preserve the locked draw. Do not destroy evidence or silently reshuffle.
3. **Protect credentials:** rotate the specific AI, Stripe, Supabase, Render, Netlify, profile-engine, database, or encryption credential through its owner console. For encryption incidents, keep the prior key available until row authentication and recovery are proven.
4. **Assess safely:** inspect provider audit trails and redacted samples with least privilege. Never download broad raw logs into chat, Git, screenshots, or personal devices.
5. **Recover:** deploy a reviewed fix, restore only into an isolated target first, run security/integrity tests, and verify exact deployed commit plus rollback path.
6. **Notify:** the accountable owner/counsel decides user, regulator, processor, payment, or law-enforcement notification based on approved regions and deadlines. The repository does not invent those legal decisions.
7. **Close:** document root cause, affected counts, timeline, rotations, deletion/restore actions, validation evidence, and follow-up owner. Add a regression test without private production data.

Named on-call roles, escalation contacts, breach deadlines, regional crisis resources, and customer-support templates remain owner-controlled launch gates.
