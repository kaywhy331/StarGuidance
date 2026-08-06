# Deployment

## Netlify contexts

The root `netlify.toml` pins Node 24 and pnpm, builds `@starguidance/web`, and uses the pinned official Next.js adapter. `.node-version` pins the same local/CI major. Deploy-preview builds explicitly set `APP_ENV=staging` and `RUNTIME_ADAPTER=supabase`. Netlify does not pass `netlify.toml` environment values to serverless functions, so the same two non-secret values must also be configured in the Netlify UI for the **Deploy Previews** context with **Functions** scope. The local adapter remains fail-closed in hosted functions by detecting Netlify's runtime `SITE_ID`/`SITE_NAME` markers. The synthetic, noindex `/visual-preview` fixture remains deploy-preview only.

PR #3 visual baseline: [deploy-preview-3--starguidance.netlify.app](https://deploy-preview-3--starguidance.netlify.app)

PR #4 credentialed staging preview: [deploy-preview-4--starguidance.netlify.app](https://deploy-preview-4--starguidance.netlify.app). The preview was enabled from the stacked `agent/starguidance-mvp` Branch Deploy base; verify its head commit after every staging trigger. No production deployment has been performed or implied.

`/api/health` is a cheap public liveness check. It never touches Supabase, Postgres, the profile engine, or AI and returns `200` with only liveness, environment class, runtime-adapter class, staging-preview status, and staging build provenance. Use it for host health checks so a transient dependency does not recycle a healthy web process.

Deep deployment readiness is `/api/health?readiness=1` and is intentionally not public. Its bearer token is the base64url HMAC-SHA256 of the literal context `starguidance-readiness-v1`, keyed by `PROFILE_ENGINE_SHARED_SECRET`; do not send the raw profile-engine secret to this endpoint and never publish either value. The protected workflow derives the token in memory. Readiness checks required configuration by name, encryption-key shape, profile-engine public health plus unauthorized and authorized synthetic compute, authoritative schema including migration 0005, forced RLS, the server actor transaction, and local-adapter rejection. Deterministic interpretation is a healthy degraded-service mode; live Groq is identified as approved only when its exact model and safety flag are selected. Responses never contain environment values, URLs, authorization headers, profile inputs, dependency bodies, or exception text.

## Render profile-engine staging service

Create the profile engine as a Render Web Service using the repository connection. These dashboard values are exact and intentionally keep deployment ownership outside the repository:

| Render setting       | Value                 |
| -------------------- | --------------------- |
| Runtime              | `Docker`              |
| Root Directory       | `apps/profile-engine` |
| Dockerfile Path      | `./Dockerfile`        |
| Docker Build Context | `.`                   |
| Health Check Path    | `/health`             |

Render supplies `PORT` at runtime. The container binds Uvicorn to `0.0.0.0` and uses that value, with `8000` only as a local container fallback. Configure `APP_ENV=staging` and a managed `PROFILE_ENGINE_SHARED_SECRET` in the Render staging environment. Keep `ENABLE_WESTERN_ASTROLOGY=false` and `ENABLE_BAZI=false`; a truthy value now fails startup because neither validated adapter exists. The guard may be removed only with the licensed implementation, approved reference suite, conventions, and expert sign-off defined in [Profile calculations](PROFILE-CALCULATIONS.md).

The Docker base is pinned by immutable Python 3.12 image digest. Runtime dependencies install from `requirements.lock` with hash verification before the local package is installed with `--no-deps`. CI separately installs the hashed development lock. Workflow actions are pinned to full commit SHAs, and Dependabot proposes reviewed npm, pip, and Actions updates.

Hosted startup fails before accepting traffic when the shared secret is blank, shorter than 32 characters, visibly placeholder-like, whitespace-padded, or otherwise trivially weak. The value must match the server-only Netlify Deploy Preview variable, but must never be copied into Git, build output, screenshots, support tickets, or PR text. `/health` remains public and contains only service status/version; `/v1/profile/compute` requires the bearer secret.

The container disables Uvicorn access logs, and the application has no middleware that logs request or response bodies. Retain that boundary when adding observability: record only operational metadata and never birth input, derived profile payloads, authorization headers, or response bodies.

The Next.js profile-engine client currently aborts after eight seconds. Use an always-on staging service so routine profile creation does not collide with cold-start latency. If cost requires an idle service, approve and test a narrowly bounded retry policy separately; it should retry only transient connection/timeout failures, cap total latency, and must not log the encrypted or plaintext profile request. Do not add an unbounded retry loop.

Render Blueprint fields are documented in the [official Blueprint specification](https://render.com/docs/blueprint-spec). This project uses exact dashboard documentation rather than committing a Blueprint that could create or adopt an owner-managed service unintentionally.

## Environment matrix

Configure secret values in the Netlify UI with the narrowest deploy-context scope. Never place values in Git, build logs, screenshots, fixtures, or pull-request text.

| Variable                                 | Local development                     | Deploy preview / staging                                 | Production               | Scope and purpose                                            |
| ---------------------------------------- | ------------------------------------- | -------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| `APP_ENV`                                | `development`                         | `staging` (build config plus Functions-scoped UI value)  | `production`             | Non-secret environment policy                                |
| `RUNTIME_ADAPTER`                        | `local` or `supabase`                 | `supabase` (build config plus Functions-scoped UI value) | `supabase` when approved | Explicit fail-closed selector                                |
| `ALLOW_LOCAL_RUNTIME_ADAPTER`            | `true` only for local/test            | unset                                                    | unset                    | Never configure on a hosted deploy                           |
| `NEXT_PUBLIC_APP_URL`                    | `http://localhost:3000`               | optional; verified request origin is used                | canonical HTTPS URL      | Auth redirect origin; not sensitive                          |
| `NEXT_PUBLIC_SUPABASE_URL`               | required for local Supabase           | required                                                 | required                 | Project URL; public runtime value                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`          | required for local Supabase           | required                                                 | required                 | Publishable/anon project key; RLS remains mandatory          |
| `DATABASE_URL`                           | optional local Postgres               | required, server-only                                    | required, server-only    | Pooler/direct URL able to `SET LOCAL ROLE starguidance_app`  |
| `DATA_ENCRYPTION_KEY`                    | required for Supabase mode            | required, server-only                                    | required, server-only    | Base64-encoded 32-byte managed key; never stored in Postgres |
| `DATA_ENCRYPTION_KEYS_PREVIOUS`          | optional rotation rollback keys       | temporary, server-only                                   | temporary, server-only   | At most three prior keys; remove after verified rotation     |
| `SUPABASE_SERVICE_ROLE_KEY`              | required for Supabase signup/deletion | required, server-only                                    | required, server-only    | Signup consent binding, Auth deletion, synthetic cleanup     |
| `PROFILE_ENGINE_URL`                     | local URL                             | Render staging HTTPS URL                                 | private production URL   | Server-to-server calculator; record hostname only            |
| `PROFILE_ENGINE_SHARED_SECRET`           | optional                              | required, server-only                                    | required, server-only    | Calculator authentication                                    |
| `AI_SAFETY_EVALUATION_APPROVED`          | `false`                               | `false` unless signed off                                | approval required        | Fail-closed live-model safety gate                           |
| `ENABLE_PROFILE_REPORTS`                 | `false` or local test                 | `false` except isolated commerce UAT                     | approval required        | Server-side purchase/webhook kill switch                     |
| `NEXT_PUBLIC_ENABLE_PROFILE_REPORTS`     | match server flag for local test      | `false` except isolated commerce UAT                     | approval required        | UI visibility only; never an authorization control           |
| `PAYMENTS_PROVIDER` and Stripe variables | `local` or test                       | optional test mode                                       | owner approval required  | Commerce remains a separate gate                             |

Enable Supabase's Email provider with password sign-in. Routine sign-in uses `signInWithPassword` and sends no email. Supabase Auth must allow the exact staging callback and the Netlify preview wildcard pattern used by the site because optional signup confirmation and password recovery terminate at `/auth/callback`; never add question or birth data to redirect parameters.

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
4. Run `DATABASE_INTEGRATION_URL=<isolated-url> corepack pnpm --filter @starguidance/database test:integration` against a disposable database. CI performs this with an isolated Postgres service.
5. Run the Auth-backed two-user procedure in [Supabase staging](SUPABASE-STAGING.md).
6. Record migration IDs and non-secret results; do not copy connection strings or keys into the PR.

Migration `0001_supabase_staging` adds durable reading lenses and order lineage, links hosted Auth identities when `auth.users` exists, and forces RLS. Migration `0002_remove_auth_user_sync_trigger` moves user provisioning to the verified application boundary. Migration `0003_webhook_replay_lease` adds retry-safe webhook claims. Migration `0004_server_actor_role` removes all private-table privileges from browser JWT roles and grants subject-scoped operations only to the non-login server actor. Migration `0005_bumpy_moon_knight` removes legacy plaintext birth metadata, adds reading-request idempotency, and enforces one profile root and one follow-up per reading. Applied files and their pinned digests remain immutable.

## Hosted control-plane review

Application tests can prove that StarGuidance does not intentionally emit private payloads, but they cannot prove provider-side retention settings. Before production, an authorized operator must inspect each dashboard and record only the setting name, effective retention period, region, access roles, deletion/export behavior, and a pass/fail result:

| Service     | Review scope                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Netlify     | build/function log retention, deploy access, environment-variable scopes, log drains, and operator audit history             |
| Supabase    | Postgres/Auth/API log retention, backups/PITR, project region, database access roles, and Auth email logs                    |
| Render      | build/runtime log retention, service access, environment-secret access, and any log stream integration                       |
| AI provider | prompt/output retention, training use, abuse-monitoring exceptions, region, subprocessors, deletion, and organization access |

Provider dashboard and contract review is owner-controlled and cannot be inferred from application tests or a green deploy. Never paste dashboard exports, tokens, log bodies, or secret values into the repository or PR; record only the reviewed setting names, non-sensitive outcomes, reviewer, and date.

## Release gates

1. Full CI, browser suite, migration rehearsal, secret scan, and Netlify preview must be green.
2. Rehearse encryption-key rotation, backup restore, export, deletion, and rollback.
3. Restrict the profile engine to web-service ingress and rotate its shared secret.
4. Verify approved AI no-retention/schema handling and Stripe test Checkout/webhook replay separately.
5. Keep Western astrology, BaZi, and planetary angularity disabled; keep Dreamspell and Nine Star Ki labeled pending certification.
6. Obtain owner decisions for retention, crisis resources, telemetry, licensing, payments, and production rollout.
7. Keep profile reports disabled until Stripe test UAT, durable job/status handling, report history, and accessible web/PDF parity pass.
8. Distributed rate limiting is implemented (Postgres-backed, migration `0006_rate_limit_buckets`, verified 2026-08-06); privacy-safe production observability/alerts are still needed before public traffic. `main` now requires PRs, required checks, and conversation resolution (verified 2026-08-06); an independent approving reviewer is still unassigned.
9. Intentional card reveal, optional cut behavior, and an explicit skip-animation control are implemented and e2e-covered (2026-08-06); still open per [Known gaps](KNOWN-GAPS.md): background generation after draw lock, and manual keyboard/screen-reader/real-device review of the ritual controls.

Do not configure or change owner-managed DNS, domains, notifications, production secrets, or a production deploy from this branch.
