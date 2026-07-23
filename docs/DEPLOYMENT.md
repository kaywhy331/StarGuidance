# Deployment

## Netlify contexts

The root `netlify.toml` pins Node and pnpm, builds `@starguidance/web`, and uses the pinned official Next.js adapter. Deploy previews explicitly set `APP_ENV=staging` and `RUNTIME_ADAPTER=supabase`; the local adapter therefore cannot become an accidental hosted fallback. The synthetic, noindex `/visual-preview` fixture remains deploy-preview only.

PR #3 visual baseline: [deploy-preview-3--starguidance.netlify.app](https://deploy-preview-3--starguidance.netlify.app)

The stacked Supabase branch does not yet have a verified preview because its required secrets are not configured. No production deployment has been performed or implied.

## Render profile-engine staging service

Create the profile engine as a Render Web Service using the repository connection. These dashboard values are exact and intentionally keep deployment ownership outside the repository:

| Render setting       | Value                 |
| -------------------- | --------------------- |
| Runtime              | `Docker`              |
| Root Directory       | `apps/profile-engine` |
| Dockerfile Path      | `./Dockerfile`        |
| Docker Build Context | `.`                   |
| Health Check Path    | `/health`             |

Render supplies `PORT` at runtime. The container binds Uvicorn to `0.0.0.0` and uses that value, with `8000` only as a local container fallback. Configure `APP_ENV=staging` and a managed `PROFILE_ENGINE_SHARED_SECRET` in the Render staging environment. Do not configure either `ENABLE_WESTERN_ASTROLOGY` or `ENABLE_BAZI` as enabled; both integrations remain explicitly unavailable.

Hosted startup fails before accepting traffic when the shared secret is blank, shorter than 32 characters, visibly placeholder-like, whitespace-padded, or otherwise trivially weak. The value must match the server-only Netlify Deploy Preview variable, but must never be copied into Git, build output, screenshots, support tickets, or PR text. `/health` remains public and contains only service status/version; `/v1/profile/compute` requires the bearer secret.

The container disables Uvicorn access logs, and the application has no middleware that logs request or response bodies. Retain that boundary when adding observability: record only operational metadata and never birth input, derived profile payloads, authorization headers, or response bodies.

The Next.js profile-engine client currently aborts after eight seconds. Use an always-on staging service so routine profile creation does not collide with cold-start latency. If cost requires an idle service, approve and test a narrowly bounded retry policy separately; it should retry only transient connection/timeout failures, cap total latency, and must not log the encrypted or plaintext profile request. Do not add an unbounded retry loop.

Render Blueprint fields are documented in the [official Blueprint specification](https://render.com/docs/blueprint-spec). This project uses exact dashboard documentation rather than committing a Blueprint that could create or adopt an owner-managed service unintentionally.

## Environment matrix

Configure secret values in the Netlify UI with the narrowest deploy-context scope. Never place values in Git, build logs, screenshots, fixtures, or pull-request text.

| Variable                                 | Local development                | Deploy preview / staging                                | Production               | Scope and purpose                                            |
| ---------------------------------------- | -------------------------------- | ------------------------------------------------------- | ------------------------ | ------------------------------------------------------------ |
| `APP_ENV`                                | `development`                    | `staging` (committed context value)                     | `production`             | Non-secret environment policy                                |
| `RUNTIME_ADAPTER`                        | `local` or `supabase`            | `supabase` (committed context value)                    | `supabase` when approved | Explicit fail-closed selector                                |
| `ALLOW_LOCAL_RUNTIME_ADAPTER`            | `true` only for local/test       | unset                                                   | unset                    | Never configure on a hosted deploy                           |
| `NEXT_PUBLIC_APP_URL`                    | `http://localhost:3000`          | optional; `DEPLOY_PRIME_URL` is preferred automatically | canonical HTTPS URL      | Auth redirect origin; not sensitive                          |
| `NEXT_PUBLIC_SUPABASE_URL`               | required for local Supabase      | required                                                | required                 | Project URL; public runtime value                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`          | required for local Supabase      | required                                                | required                 | Publishable/anon project key; RLS remains mandatory          |
| `DATABASE_URL`                           | optional local Postgres          | required, server-only                                   | required, server-only    | Pooler/direct URL able to `SET LOCAL ROLE authenticated`     |
| `DATA_ENCRYPTION_KEY`                    | required for Supabase mode       | required, server-only                                   | required, server-only    | Base64-encoded 32-byte managed key; never stored in Postgres |
| `SUPABASE_SERVICE_ROLE_KEY`              | optional except account deletion | required, server-only                                   | required, server-only    | Auth deletion and disposable test-user cleanup only          |
| `PROFILE_ENGINE_URL`                     | local URL                        | Render staging HTTPS URL                                | private production URL   | Server-to-server calculator; record hostname only            |
| `PROFILE_ENGINE_SHARED_SECRET`           | optional                         | required, server-only                                   | required, server-only    | Calculator authentication                                    |
| `PAYMENTS_PROVIDER` and Stripe variables | `local` or test                  | optional test mode                                      | owner approval required  | Commerce remains a separate gate                             |

Supabase Auth must allow the exact staging callback and the Netlify preview wildcard pattern used by the site. Magic-link redirects terminate at `/auth/callback`; do not add question or birth data to redirect parameters.

## Database release sequence

The repository's Drizzle files in `packages/database/migrations` are the only migration authority. The Supabase GitHub integration must not create, adopt, or apply an independent `supabase/migrations` history. Keep Supabase automatic **Deploy to production** disabled until an owner approves a reviewed promotion workflow; a skipped Supabase Preview check is expected under this policy.

1. Create a disposable Supabase staging project that contains no production data.
2. Set `DATABASE_URL` only in the operator shell or secret manager.
3. Run `corepack pnpm db:check`, `corepack pnpm db:migrate`, and `corepack pnpm db:seed`.
4. Run `DATABASE_INTEGRATION_URL=<isolated-url> corepack pnpm --filter @starguidance/database test:integration` against a disposable database. CI performs this with an isolated Postgres service.
5. Run the Auth-backed two-user procedure in [Supabase staging](SUPABASE-STAGING.md).
6. Record migration IDs and non-secret results; do not copy connection strings or keys into the PR.

Migration `0001_supabase_staging` adds durable reading lenses and order lineage, links hosted Auth identities when `auth.users` exists, forces RLS, revokes public access, and grants only the required authenticated operations. It refuses to invent missing legacy reading lenses or order snapshot lineage.

## Release gates

1. Full CI, browser suite, migration rehearsal, secret scan, and Netlify preview must be green.
2. Rehearse encryption-key rotation, backup restore, export, deletion, and rollback.
3. Restrict the profile engine to web-service ingress and rotate its shared secret.
4. Verify approved AI no-retention/schema handling and Stripe test Checkout/webhook replay separately.
5. Keep Western astrology and BaZi disabled; keep Dreamspell labeled pending certification.
6. Obtain owner decisions for retention, crisis resources, telemetry, licensing, payments, and production rollout.

Do not configure or change owner-managed DNS, domains, notifications, production secrets, or a production deploy from this branch.
