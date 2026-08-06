# Known gaps and production gates

This branch is a safe-beta candidate, not a public-production approval. The implemented security boundaries are useful now: conventional email/password Auth, versioned consent receipts, encrypted profile/question storage, forced-RLS user isolation, immutable snapshot and draw lineage, deterministic AI fallback, output safety validation, scoped export/deletion, security headers, and fail-closed runtime selection. The gates below are deliberately explicit so a green build cannot be mistaken for business, legal, operational, or provider approval.

## Exact-commit release evidence

- Migration `0005_bumpy_moon_knight` must be applied to the non-production Supabase staging project. It scrubs legacy plaintext birth metadata and adds profile-root, follow-up, and reading-idempotency constraints. The protected workflow must then prove schema readiness, two-user isolation, locked-draw recovery, export, deletion, key rotation/rollback, synthetic cleanup, and the deployed commit.
- Public `/api/health` proves only liveness. The protected HMAC-authorized readiness probe must pass for the exact deploy being promoted; an earlier green run does not transfer to a later commit.
- Full Node 24 CI, browser E2E, Python 3.12 checks, hashed lock installs, production dependency audit, migration rehearsal, secret scan, and Netlify deployment must all be green at the same head.
- `main` now enforces required status checks (`web`, `profile-engine`, `e2e`, `secret-scan`, `migration`, `guard`, `verify`), PR-only merges, required conversation resolution, and blocked force-push/deletion, including for administrators (applied and verified via the GitHub API 2026-08-06). Required approving reviews remain set to zero: GitHub never counts a PR author's own approval toward that count, and no second reviewer is configured yet. The draft PR must not be merged by this implementation lane until an independent reviewer is assigned.

## Product-flow gaps

- Live interpretation is currently generated inside the reading-creation request. The draw is durably locked first, so integrity is preserved, but navigation waits for generation and the reveal ritual does not hide provider latency. Public MVP requires an idempotent background generation boundary that starts after lock/deal and survives serverless interruption.
- The sanctuary now offers an explicit deck-cut choice (Cut / Skip cut), intentional per-card click/tap/keyboard reveal with a Reveal-all convenience control, an early Finish-shuffling control, and an in-app Reduced-motion toggle alongside the OS preference (PRD UX-002/UX-004/UX-006/UX-009), with e2e coverage including keyboard activation. This closes the automated portion of the gap; the manual keyboard/screen-reader/real-device review noted below still applies before calling the ritual complete.
- The beta permits one follow-up and detects compulsive-redraw language, but it has no durable reading allowance, configurable entitlement/cooldown policy, or cross-instance abuse signal. Define the free-reading and repeat-reading policy before wider access.
- Account history exposes readings, not purchased reports or fulfillment states. Support/admin views, non-sensitive trace lookup, content/model/spread kill switches, and operator retry controls are also absent.

## Reports and commerce

- New reports are hidden and checkout/webhooks fail closed unless `ENABLE_PROFILE_REPORTS=true`; button visibility separately requires `NEXT_PUBLIC_ENABLE_PROFILE_REPORTS=true`. Both default false and should remain false in the safe beta.
- Stripe signature, reconciliation, replay, refund, dispute, entitlement, and revocation behavior has automated coverage, but credentialed test Checkout/webhook/refund UAT is still required in an isolated commerce deployment.
- Report generation is synchronous. Public paid fulfillment requires a durable idempotent job, retry/status states, history access, customer/support recovery, and optional notification.
- The web report is browser-printable but there is no accessible PDF artifact or web/PDF content-parity test. Pricing, taxes, receipts, refunds/chargebacks, finance retention, support ownership, and launch-region policy remain owner decisions.
- Supabase Storage is not used. If report/PDF artifacts are later stored there, private buckets and object-level RLS need their own reviewed migration and isolation tests.

## Authentication, privacy, and operations

- Routine login uses email and password and sends no email. The owner must choose whether signup confirmation is required; if it is disabled, addresses are not verified. If enabled, delivered confirmation and recovery links need an owner-inbox, cross-browser smoke test using the reviewed token-hash templates.
- Request limits are bounded and ignore spoofable `x-forwarded-for`. On the `supabase` runtime adapter they are now enforced by an atomic Postgres function (migration `0006_rate_limit_buckets`, one round trip, `starguidance_app`-only, forced RLS) instead of an in-process map, so limits hold across multiple serverless instances; a failed check fails closed. The `local` adapter (dev/test) keeps the original in-process limiter. Covered by `packages/database/src/rate-limits.integration.test.ts` including a concurrency test, plus `apps/web/src/lib/request-security.test.ts` for the local path.
- Provider dashboard review remains outstanding for Netlify, Supabase, Render, the AI provider, Stripe, and any telemetry vendor: retention, region, training use, subprocessors, role access, deletion/export, logs, backups/PITR, and incident auditability.
- Production still needs managed key generation/escrow and cutover, provider-hosted restore rehearsal with approved RPO/RTO, approved retention schedules, named responders, customer-support procedures, privacy-safe traces/metrics/alerts, and regional crisis resources.
- The versioned beta Terms, Privacy Notice, 18+ policy, profile-personalization disclosure, deletion behavior, and consent language are engineering controls and draft copy—not legal advice or counsel approval. A responsible legal/privacy owner must approve them for selected launch regions.

## AI, calculations, and content

- Deterministic interpretation is the safe default. Live Groq remains disabled unless `AI_SAFETY_EVALUATION_APPROVED=true`; production also needs a signed model-specific safety/grounding evaluation, restricted-profile-leakage tests, no-retention contract/configuration, redaction verification, and cost/latency budgets.
- Western astrology, BaZi, and planetary angularity correctly return unavailable. Their licensing, conventions, geocoder/historical-timezone handling, reference suites, and named expert review remain activation gates.
- Dreamspell remains `implemented_pending_approved_reference_dataset`; Nine Star Ki remains convention-bound pending independent reference review. All spiritual-system copy and artwork need a final commercial rights/attribution register and domain-owner approval.
- Automated accessibility tests do not replace manual keyboard/screen-reader/text-zoom review, accessible PDF review, or real-device animation/performance testing. Deploy-preview toolbar frames are excluded only because they are host-injected; the suite separately asserts that the application embeds no frames.

No production payment, live AI, public launch, or calculation feature should be described as verified until its exact evidence and accountable approval are recorded. See [Deployment](DEPLOYMENT.md), [Security](SECURITY.md), [Operations and recovery](OPERATIONS.md), [Commerce verification](COMMERCE.md), and [Profile calculations](PROFILE-CALCULATIONS.md).
