# Deployment

## Netlify contexts

The root `netlify.toml` pins Node 24 and pnpm, builds `@starguidance/web`, and uses the pinned official Next.js adapter. `.node-version` pins the same local/CI major. Deploy-preview builds explicitly set `APP_ENV=staging` and `RUNTIME_ADAPTER=supabase`. Netlify does not pass `netlify.toml` environment values to serverless functions, so the same two non-secret values must also be configured in the Netlify UI for the **Deploy Previews** context with **Functions** scope. The local adapter remains fail-closed in hosted functions by detecting Netlify's runtime `SITE_ID`/`SITE_NAME` markers. The synthetic, noindex `/visual-preview` fixture remains deploy-preview only.

Historical PR #3 visual baseline: [deploy-preview-3--starguidance.netlify.app](https://deploy-preview-3--starguidance.netlify.app)

Release record, 2026-08-21: PR #19 merged as `55747fc2a4ff4af33120f91cea3e1f48bddc1d7b`. Netlify production deploy `6a889b71f468000008b8743b` published that exact application commit and returned `200` from `/api/health`, `/`, `/sign-in`, `/sign-up`, `/terms`, and `/privacy`; the preview-only route returned `404`. Follow-up PR #21 merged the test-only commit `6ce96532e459ada36176969f59e92bc5c8959262`, whose final main CI passed all 52 jobs and whose automatic Netlify production deploy was `6a88a965235fe100082efb96`. Subsequent test- or documentation-only merges can produce newer deployment IDs even though application source is unchanged, so use the Netlify deployment record's commit reference to identify the artifact currently serving the production alias. The pre-release rollback anchor is deploy `6a839aeb9399100008c982db` at `3bf6ad56804fcd716a40fe9cf68cf0074e47fca0`.

This is a code-deployment receipt, not public-launch or provider-readiness approval. No production database migration, production secret change, DNS change, or provider activation was performed. Authenticated/provider-backed production flows remain unverified and fail-closed gates remain in force. The credentialed staging workflow remains restricted to `agent/starguidance-immersive-ux` and the protected `starguidance-staging` environment. Historical PR #19 preview: [deploy-preview-19--starguidance.netlify.app](https://deploy-preview-19--starguidance.netlify.app).

`/api/health` is a cheap public liveness check. It never touches Supabase, Postgres, the profile engine, or AI and returns `200` with only liveness, environment class, runtime-adapter class, staging-preview status, and staging build provenance. Use it for host health checks so a transient dependency does not recycle a healthy web process.

Deep deployment readiness is `/api/health?readiness=1` and is intentionally not public. Its bearer token is the base64url HMAC-SHA256 of the literal context `starguidance-readiness-v1`, keyed by the dedicated `READINESS_PROBE_SECRET`; do not send the raw secret to this endpoint and never publish either value. The readiness, profile-engine, and interpretation-worker trust domains use three distinct managed secrets. The protected workflow derives the readiness token in memory. Readiness checks required configuration by name, encryption-key shape, profile-engine public health plus unauthorized and authorized synthetic compute, the complete authoritative migration manifest, forced RLS, the server actor transaction, and local-adapter rejection. Deterministic interpretation is a healthy degraded-service mode; live Groq is identified as approved only when the exact reviewed model chain and safety flag are selected. Responses never contain environment values, URLs, authorization headers, profile inputs, dependency bodies, or exception text.

## Background generation jobs

`netlify/functions/process-interpretation-jobs.mts` runs every minute (`config.schedule`) as the durability backstop for both interpretation and paid-report generation (see docs/KNOWN-GAPS.md). It has no workspace or database dependency by design—Netlify's zip-it-and-ship-it bundler cannot resolve `postgres`/`drizzle-orm` at runtime for a standalone Netlify Function (`netlify/zip-it-and-ship-it#869`, confirmed here across three bundler configurations)—so it derives a bearer token and calls `POST /api/internal/interpretation-jobs`, where claims, generation, aggregate signal queries, and atomic writes run behind the Next.js/Postgres path. The response contains only counts: queue depth/age and fixed-window auth/profile/AI/payment/latency/live-volume signals. The scheduled wrapper evaluates closed thresholds, writes a fixed greppable class, and optionally posts one content-free JSON payload to `OPERATIONAL_ALERT_WEBHOOK_URL`. Its token is the base64url HMAC-SHA256 of the literal context `starguidance-interpretation-worker-v1`, keyed by `INTERPRETATION_WORKER_SECRET`; as with the readiness token, never send or log the raw secret. `INTERPRETATION_WORKER_SECRET` must be configured, server-only, wherever the `supabase` runtime adapter runs, and must meet the same strength bar `PROFILE_ENGINE_SHARED_SECRET` does (`apps/web/src/lib/shared-secret.ts`—at least 32 characters, no leading/trailing whitespace, at least 8 distinct characters, no placeholder-like substring); a weak or missing secret makes the internal route fail closed with `401` rather than silently accepting an unauthenticated trigger.

Unlike every other server-only value in this project, `NEXT_PUBLIC_APP_URL` must also be reachable from inside the Netlify Functions runtime here, not just derivable from an incoming browser request — a scheduled function has no request to derive an origin from, so it needs this site's own canonical URL to call back into. Configure it in the Netlify UI with **Functions** scope for every context that runs the scheduled trigger.

## Render profile-engine staging service

Create the profile engine as a Render Web Service using the repository connection. These dashboard values are exact and intentionally keep deployment ownership outside the repository:

| Render setting       | Value                 |
| -------------------- | --------------------- |
| Runtime              | `Docker`              |
| Root Directory       | `apps/profile-engine` |
| Dockerfile Path      | `./Dockerfile`        |
| Docker Build Context | `.`                   |
| Health Check Path    | `/health`             |

Render supplies `PORT` at runtime. The container binds Uvicorn to `0.0.0.0` and uses that value, with `8000` only as a local container fallback. Configure `APP_ENV=staging` and a managed `PROFILE_ENGINE_SHARED_SECRET` in the Render staging environment. Keep `ENABLE_WESTERN_ASTROLOGY=false`, `ENABLE_BAZI=false`, and `ENABLE_PLANETARY_ANGULARITY=false`; any truthy value fails startup because no validated adapter exists. The guard may be removed only with the licensed implementation, approved reference suite, conventions, and expert sign-off defined in [Profile calculations](PROFILE-CALCULATIONS.md).

The Docker base is pinned by immutable Python 3.12 image digest. Runtime dependencies install from `requirements.lock` with hash verification before the local package is installed with `--no-deps`. CI separately installs the hashed development lock. Workflow actions are pinned to full commit SHAs, and Dependabot proposes reviewed npm, pip, and Actions updates.

CI secret scanning extends the default Gitleaks rules through the committed `.gitleaks.toml` and allowlists only exact synthetic test markers. `GITLEAKS_LICENSE` is optional while the repository is personal but must be configured as a GitHub Actions secret before transfer to an organization if required by the action's licensing terms. It is never an application or deploy-preview variable.

Hosted startup fails before accepting traffic when the shared secret is blank, shorter than 32 characters, visibly placeholder-like, whitespace-padded, or otherwise trivially weak. The value must match the server-only Netlify Deploy Preview variable, but must never be copied into Git, build output, screenshots, support tickets, or PR text. `/health` remains public and contains only service status/version; `/v1/profile/compute` requires the bearer secret.

The container disables Uvicorn access logs, and the application has no middleware that logs request or response bodies. Retain that boundary when adding observability: record only operational metadata and never birth input, derived profile payloads, authorization headers, or response bodies.

The Next.js profile-engine client uses an eight-second first attempt and one 25-second wake attempt only for transient connection/timeout failures. Rejected input, a contract mismatch, and a malformed service URL are never retried. This bounded pure-computation retry accommodates an idle staging service without duplicating persistence or logging the profile request; do not add an unbounded retry loop.

Render Blueprint fields are documented in the [official Blueprint specification](https://render.com/docs/blueprint-spec). This project uses exact dashboard documentation rather than committing a Blueprint that could create or adopt an owner-managed service unintentionally.

## Environment matrix

Configure secret values in the Netlify UI with the narrowest deploy-context scope. Never place values in Git, build logs, screenshots, fixtures, or pull-request text.

| Variable                                     | Local development                     | Deploy preview / staging                                 | Production                      | Scope and purpose                                                                        |
| -------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `APP_ENV`                                    | `development`                         | `staging` (build config plus Functions-scoped UI value)  | `production`                    | Non-secret environment policy                                                            |
| `RUNTIME_ADAPTER`                            | `local` or `supabase`                 | `supabase` (build config plus Functions-scoped UI value) | `supabase` when approved        | Explicit fail-closed selector                                                            |
| `ALLOW_LOCAL_RUNTIME_ADAPTER`                | `true` only for local/test            | unset                                                    | unset                           | Never configure on a hosted deploy                                                       |
| `NEXT_PUBLIC_APP_URL`                        | `http://localhost:3000`               | required, Functions-scoped (build config plus UI value)  | canonical HTTPS URL             | Auth redirect origin; also the scheduled trigger's callback target — not sensitive       |
| `INTERPRETATION_WORKER_SECRET`               | optional                              | required, server-only                                    | required, server-only           | Authenticates the Netlify-scheduled interpretation/report-job trigger                    |
| `OPERATIONAL_ALERT_WEBHOOK_URL`              | unset                                 | managed HTTPS receiver or unset                          | managed HTTPS receiver          | Closed aggregate alerts only; may contain a secret path, so keep server-only             |
| `OPERATIONAL_LIVE_AI_VOLUME_ALERT_THRESHOLD` | `500`                                 | approved bounded count                                   | budget-owner approved count     | Hourly live-generation cost proxy                                                        |
| `READINESS_PROBE_SECRET`                     | optional                              | required, server-only                                    | required, server-only           | Authenticates deep web readiness; distinct from other service secrets                    |
| `NEXT_PUBLIC_SUPABASE_URL`                   | required for local Supabase           | required                                                 | required                        | Project URL; public runtime value                                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`              | required for local Supabase           | required                                                 | required                        | Publishable/anon project key; RLS remains mandatory                                      |
| `AUTH_EMAIL_CONFIRMATION_MODE`               | `required`                            | `private-testing` only for an approved closed test       | `required`                      | Server-only; temporary mode avoids SMTP but leaves test addresses unverified             |
| `DATABASE_URL`                               | optional local Postgres               | required, server-only                                    | required, server-only           | Transaction-pooler URL for serverless runtime, able to `SET LOCAL ROLE starguidance_app` |
| `DATA_ENCRYPTION_KEY`                        | required for Supabase mode            | required, server-only                                    | required, server-only           | Base64-encoded 32-byte managed key; never stored in Postgres                             |
| `DATA_ENCRYPTION_KEYS_PREVIOUS`              | optional rotation rollback keys       | temporary, server-only                                   | temporary, server-only          | At most three prior keys; remove after verified rotation                                 |
| `GUEST_TRIAL_SECRET`                         | required for the free-reading lane    | preferred; derived preview fallback                      | preferred; derived fallback     | Dedicated 32-byte base64 key; Netlify otherwise derives a context-bound subroot          |
| `READING_FOLLOW_UP_LIMIT`                    | `1`                                   | `1` unless product policy approves another bounded value | owner-approved bounded value    | Maximum follow-ups per locked reading; 0–10                                              |
| `READING_REREAD_COOLDOWN_MINUTES`            | `30`                                  | `30` unless safety policy approves another bounded value | owner-approved bounded value    | Normalized same-question cooldown; 0–1440, with 0 disabling it                           |
| `READING_ACCESS_MODE`                        | `unlimited`                           | `unlimited` or approved `free-window`                    | owner-approved mode             | Versioned reading entitlement policy                                                     |
| `READING_FREE_ALLOWANCE`                     | `3`                                   | bounded positive integer                                 | owner-approved bounded value    | Readings allowed inside a free window                                                    |
| `READING_ALLOWANCE_WINDOW_HOURS`             | `24`                                  | bounded positive integer                                 | owner-approved bounded value    | Durable free-window horizon                                                              |
| `READING_SESSION_TTL_MINUTES`                | `120`                                 | bounded 15 minutes–7 days                                | owner-approved bounded value    | Expiry for interrupted locked rituals                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`                  | required for Supabase signup/deletion | required, server-only                                    | required, server-only           | Signup consent binding, Auth deletion, synthetic cleanup                                 |
| `PROFILE_ENGINE_URL`                         | local URL                             | Render staging HTTPS URL                                 | private production URL          | Server-to-server calculator; record hostname only                                        |
| `PROFILE_ENGINE_SHARED_SECRET`               | optional                              | required, server-only                                    | required, server-only           | Calculator authentication                                                                |
| `TRUSTED_CLIENT_IP_HEADER`                   | unset on Netlify                      | unset on Netlify; edge-specific elsewhere                | edge-specific if approved       | Explicit provider-overwritten client-IP header; never `x-forwarded-for`                  |
| `AI_PROVIDER_MODEL`                          | `openai/gpt-oss-120b`                 | exact reviewed primary                                   | approval required               | Strict-schema primary model                                                              |
| `AI_PROVIDER_FALLBACK_MODELS`                | reviewed comma-separated chain        | `llama-3.3-70b-versatile,openai/gpt-oss-20b`             | approval required               | Validated JSON-mode fallback, then strict-schema fallback                                |
| `AI_PROVIDER_ALLOWED_MODELS`                 | defaults to configured chain          | reviewed comma-separated allowlist                       | reviewed allowlist              | Runtime drafts cannot introduce a model outside this set                                 |
| `AI_PROVIDER_TRANSPORT`                      | `direct`                              | `direct`                                                 | `direct` or approved `tokenpak` | Explicit route selector; URL changes alone cannot activate TokenPak                      |
| `AI_PROVIDER_BASE_URL`                       | Groq default                          | `https://api.groq.com/openai/v1`                         | reviewed route only             | Direct Groq or an approved HTTPS hostname ending in exactly `/v1`                        |
| `AI_PROVIDER_API_KEY`                        | optional managed secret               | direct Groq only                                         | rotated managed secret          | Must be absent in custom-gateway mode                                                    |
| `AI_PROVIDER_GATEWAY_APPROVED`               | `false`                               | `false`                                                  | explicit approval required      | Separate kill switch for the custom gateway route                                        |
| `AI_PROVIDER_GATEWAY_HOST`                   | unset                                 | unset                                                    | exact reviewed hostname         | Must exactly match the custom base URL hostname; trailing dot rejected                   |
| `AI_PROVIDER_GATEWAY_KEY`                    | unset                                 | unset                                                    | managed secret                  | Distinct bearer for the narrow gateway; never the Groq key                               |
| `AI_PROVIDER_CF_ACCESS_CLIENT_ID`            | unset                                 | unset                                                    | managed secret                  | Cloudflare Access service identity; gateway mode only                                    |
| `AI_PROVIDER_CF_ACCESS_CLIENT_SECRET`        | unset                                 | unset                                                    | managed secret                  | Cloudflare Access service identity; gateway mode only                                    |
| `AI_PROVIDER_TIMEOUT_MS`                     | `15000`                               | `15000`                                                  | owner-approved budget           | Maximum duration for one model attempt                                                   |
| `AI_PROVIDER_TOTAL_TIMEOUT_MS`               | `40000`                               | `40000`                                                  | owner-approved budget           | Shared deadline across all Groq model attempts                                           |
| `AI_SAFETY_EVALUATION_APPROVED`              | `false`                               | `false` unless signed off                                | approval required               | Fail-closed live-model safety gate                                                       |
| `READING_AUDIO_PROVIDER`                     | `disabled` or explicit `fish-audio`   | `disabled` until isolated voice UAT                      | approval required               | Fail-closed selector; preference changes never call the provider                         |
| `FISH_AUDIO_API_KEY`                         | optional managed secret               | isolated UAT key only, server-only                       | rotated managed secret          | Bearer key for the fixed `https://api.fish.audio/v1/tts` endpoint                        |
| `FISH_AUDIO_REFERENCE_ID`                    | explicit permitted voice ID           | reviewed permitted voice ID, server-only                 | approved voice ID               | Voice selection; never accepted from the browser                                         |
| `FISH_AUDIO_MODEL`                           | explicit supported model              | reviewed paid/test model                                 | approved paid model             | Accepted values: `s1`, `s2-pro`, `s2.1-pro`, `s2.1-pro-free`; no implicit model          |
| `FISH_AUDIO_TIMEOUT_MS`                      | `45000`                               | bounded 5000–120000                                      | cost/latency-owner approved     | Whole lifetime bound for one lazily requested passage                                    |
| `ENABLE_PROFILE_REPORTS`                     | `false` or local test                 | `false` except isolated commerce UAT                     | approval required               | Server-side purchase/webhook kill switch                                                 |
| `PAYMENTS_PROVIDER` and Stripe variables     | authorized non-hosted `local` or test | `stripe` only when commerce UAT is enabled               | owner-approved `stripe` only    | Missing, invalid, and hosted-local selections fail closed                                |
| `SUPPORT_USER_IDS`                           | optional UUID list                    | server-only approved UUID list                           | access review required          | Masked diagnostics and exact opaque trace status                                         |
| `OPERATOR_USER_IDS`                          | optional UUID list                    | server-only approved UUID list                           | access review required          | Inherits support and adds audited failed-job retry                                       |

Direct Groq remains the non-production preview default. Do not activate
`AI_PROVIDER_TRANSPORT=tokenpak` from URL configuration alone. Before any
custom route, complete the [gateway security contract](AI-GATEWAY-SECURITY.md)
and [Cali synthetic-pilot runbook](CALI-TOKENPAK-PILOT.md), obtain independent
approval of the exact commit/runtime/Cloudflare resources, and keep the direct
Groq key absent from the StarGuidance host in gateway mode.

Enable Supabase's Email provider with password sign-in. Routine sign-in uses `signInWithPassword` and sends no email. Supabase Auth must allow the exact staging callback and the Netlify preview wildcard pattern used by the site because optional signup confirmation and password recovery terminate at `/auth/callback`; never add question or birth data to redirect parameters.

For an explicitly closed testing deployment, `AUTH_EMAIL_CONFIRMATION_MODE=private-testing` uses the server-only Supabase Admin API to create a confirmed identity without requesting an email, then immediately signs in with the submitted password to prove that Supabase stored the credential. An older pending identity can be activated only after Supabase first returns `email_not_confirmed` for the correct password; invalid credentials never trigger an administrative lookup. This mode is temporary and does not verify ownership of an email address. Before public traffic, remove the value (or set `required`), configure custom transactional SMTP with SPF/DKIM/DMARC, verify the canonical Site URL and callback allowlist, and pass delivered confirmation plus recovery tests. The built-in Supabase mailer is not a production provider and must not be treated as delivery evidence.

Netlify automatically supplies the trusted `x-nf-client-connection-ip` used for anonymous rate-limit partitioning. Off Netlify, leave `TRUSTED_CLIENT_IP_HEADER` unset unless the named edge overwrites and strips that header at the public boundary. Only the documented single-value provider headers are accepted; `x-forwarded-for` remains ignored even if configured.

If **Confirm email** is enabled, configure the **Confirm signup** template to send the one-time token hash directly to the reviewed callback. `RedirectTo` already contains the safe `next` query generated by the application:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=signup">Confirm StarGuidance account</a>
```

Configure the **Reset password** template similarly, using the recovery type:

```html
<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=recovery"
  >Reset StarGuidance password</a
>
```

Disabling **Confirm email** gives the simplest MVP registration flow: signup creates a session immediately, while later sign-ins use the password. The tradeoff is that the email remains unverified. If confirmation stays enabled, it is a one-time registration step, not the recurring login mechanism.

The callback accepts portable `signup` and `recovery` token hashes and retains Supabase's same-browser PKCE `code` exchange. On Netlify, signup/recovery initiation and callback redirects use the proxy-authenticated browser-visible host rather than the immutable internal deploy host. Do not put `ConfirmationURL`, a raw token, an email address, or a fixed production hostname into a custom link. After changing a template, request a new message and verify that its host is the active preview without recording its token-bearing URL.

## Database release sequence

The repository's Drizzle files in `packages/database/migrations` are the only migration authority. The Supabase GitHub integration must not create, adopt, or apply an independent `supabase/migrations` history. Keep Supabase automatic **Deploy to production** disabled until an owner approves a reviewed promotion workflow; a skipped Supabase Preview check is expected under this policy.

1. Select an explicitly non-production Supabase staging project, confirm the migration/fixture run is authorized, and take the owner-required backup before applying changes. The protected workflow operates only on reserved-domain synthetic identities and does not require deleting unrelated beta accounts.
2. Set `DATABASE_URL` only in the operator shell or secret manager.
3. Run `corepack pnpm db:check`, `corepack pnpm db:migrate`, and `corepack pnpm db:seed`.
4. Run `DATABASE_INTEGRATION_URL=<isolated-url> corepack pnpm --filter @starguidance/database test:integration` and `DATABASE_INTEGRATION_URL=<isolated-url> corepack pnpm --filter @starguidance/web test:integration` against a disposable database. CI performs both with an isolated Postgres service; the web-owned suite directly verifies atomic paid-report fulfillment after profile deletion and replay idempotency.
5. Run the Auth-backed two-user procedure in [Supabase staging](SUPABASE-STAGING.md).
6. Record migration IDs and non-secret results; do not copy connection strings or keys into the PR.

Migration `0001_supabase_staging` adds durable reading lenses and order lineage, links hosted Auth identities when `auth.users` exists, and forces RLS. Migration `0002_remove_auth_user_sync_trigger` moves user provisioning to the verified application boundary. Migration `0003_webhook_replay_lease` adds retry-safe webhook claims. Migration `0004_server_actor_role` removes all private-table privileges from browser JWT roles and grants subject-scoped operations only to the non-login server actor. Migration `0005_bumpy_moon_knight` removes legacy plaintext birth metadata, adds reading-request idempotency, and initially enforces one profile root and one follow-up per reading. Migrations `0006`–`0010` add distributed rate limiting, durable interpretation jobs, subject-bound job policies, immutable snapshots, and deletion receipts. Migration `0011_reading_flow_controls` adds active deck/spread kill switches and replaces the follow-up singleton index with the application-policy index. Migrations `0012`–`0017` add the durable report path, temporary minimized source, account/consent history, ritual recovery, and sound default. Migration `0018` separates immutable outcome annotations. Migrations `0019`/`0020` create and constrain the first-party event store, `0021` creates the independently approved runtime ledger, `0022` extends only its closed event vocabulary for auth/generation alert signals, and `0023` adds complete primary/follow-up output provenance with honest legacy markers. Applied files and their pinned digests remain immutable.

## Hosted control-plane review

Application tests can prove that StarGuidance does not intentionally emit private payloads, but they cannot prove provider-side retention settings. Before production, an authorized operator must inspect each dashboard and record only the setting name, effective retention period, region, access roles, deletion/export behavior, and a pass/fail result:

| Service     | Review scope                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Netlify     | build/function log retention, deploy access, environment-variable scopes, log drains, and operator audit history                     |
| Supabase    | Postgres/Auth/API log retention, backups/PITR, project region, database access roles, and Auth email logs                            |
| Render      | build/runtime log retention, service access, environment-secret access, and any log stream integration                               |
| AI provider | prompt/output retention, training use, abuse-monitoring exceptions, region, subprocessors, deletion, and organization access         |
| Fish Audio  | passage/audio retention, training use, abuse review, region, subprocessors, voice permissions, plan rights, deletion, and key access |

Provider dashboard and contract review is owner-controlled and cannot be inferred from application tests or a green deploy. Never paste dashboard exports, tokens, log bodies, or secret values into the repository or PR; record only the reviewed setting names, non-sensitive outcomes, reviewer, and date.

## Release gates

1. Full CI, desktop/mobile Chromium plus Firefox/WebKit suite, migration rehearsal, secret scan, and Netlify preview must be green.
2. Rehearse encryption-key rotation, backup restore, export, deletion, and rollback.
3. Restrict the profile engine to web-service ingress and rotate its shared secret.
4. Verify approved AI no-retention/schema handling and Stripe test Checkout/webhook replay separately.
5. Keep Western astrology, BaZi, and planetary angularity disabled; keep Dreamspell and Nine Star Ki labeled pending certification.
6. Obtain owner decisions for retention, crisis resources, telemetry, licensing, payments, and production rollout.
7. Durable report generation, retry/status handling, standalone history, structured web output, and authenticated tagged PDF with automated web/PDF source parity are implemented. Keep profile reports disabled until Stripe test UAT, hosted failure/recovery rehearsal, and independent PDF accessibility review pass.
8. Distributed rate limiting and privacy-safe aggregate measurement/alert delivery are implemented. Before public traffic, configure and rehearse the managed alert receiver plus provider-native host/database/billing alerts, and approve cross-service trace correlation. `main` requires PRs, required checks, and conversation resolution (verified 2026-08-06). An independent reviewer remains unassigned; the owner explicitly waived that review for PR #19 and its 2026-08-21 release-closeout follow-ups. That release decision is not a standing waiver for later feature merges or activation gates.
9. The committed-draw lifecycle, 78-back planar shuffle field, entropy-contributing stir, explicit optional cut/no-cut finalization, reader-chosen reveal order, Reveal All, and full-spread result gate are implemented and e2e-covered (updated 2026-08-25). Migration `0025` must be applied before this code is promoted. Background interpretation and report generation use leased durable jobs with the same authenticated Netlify-scheduled backstop (migrations `0007` and `0012`); still open per [Known gaps](KNOWN-GAPS.md): manual keyboard/screen-reader/real-device review of the ritual controls.
10. Prefer `GUEST_TRIAL_SECRET` as a separately rotated key and rehearse the public trial's signed-marker, distributed keyed-network quota, storage-cleared, private-mode, seven-day expiry, and email-confirmation/account-handoff behavior. A Netlify deploy may omit it: `next.config.ts` inlines a non-secret marker only for the matching `deploy-preview` or `production` build context. The server additionally requires the matching `APP_ENV`, a valid runtime `SITE_ID`, and a valid `DATA_ENCRYPTION_KEY` before deriving a context-separated HMAC subroot (per site/PR for previews, per site for production). Local builds, branch deploys, mismatched/incomplete metadata, invalid root material, and any explicitly malformed `GUEST_TRIAL_SECRET` fail closed with `503`.
11. Public promotion requires `AUTH_EMAIL_CONFIRMATION_MODE=required`, an owner-approved custom SMTP sender, verified SPF/DKIM/DMARC, and delivered signup-confirmation/password-recovery evidence. `private-testing` is a closed-beta convenience, not a launch configuration.
12. Keep `READING_AUDIO_PROVIDER=disabled` until Fish Audio commercial-plan terms, privacy/retention settings, the exact voice's usage permission, cost controls, and point-of-use disclosure are approved. Then run credentialed tests proving no request on load or preference enablement, one request on Play, lazy next-section loading, pause/stop behavior, provider failure recovery, and current Chrome/Firefox/Safari plus iOS/Android playback before promotion.

Owner-managed DNS, domains, notifications, and production secrets were not changed during the 2026-08-21 release. Future provider configuration and production promotion remain explicit owner actions.
