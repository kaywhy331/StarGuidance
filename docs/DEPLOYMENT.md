# Deployment

## Netlify contexts

The root `netlify.toml` pins Node and pnpm, builds `@starguidance/web`, and uses the pinned official Next.js adapter. Deploy previews explicitly set `APP_ENV=staging` and `RUNTIME_ADAPTER=supabase`; the local adapter therefore cannot become an accidental hosted fallback. The synthetic, noindex `/visual-preview` fixture remains deploy-preview only.

PR #3 visual baseline: [deploy-preview-3--starguidance.netlify.app](https://deploy-preview-3--starguidance.netlify.app)

The stacked Supabase branch does not yet have a verified preview because its required secrets are not configured. No production deployment has been performed or implied.

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
| `PROFILE_ENGINE_URL`                     | local URL                        | private staging URL                                     | private production URL   | Server-to-server calculator                                  |
| `PROFILE_ENGINE_SHARED_SECRET`           | optional                         | required, server-only                                   | required, server-only    | Calculator authentication                                    |
| `PAYMENTS_PROVIDER` and Stripe variables | `local` or test                  | optional test mode                                      | owner approval required  | Commerce remains a separate gate                             |

Supabase Auth must allow the exact staging callback and the Netlify preview wildcard pattern used by the site. Magic-link redirects terminate at `/auth/callback`; do not add question or birth data to redirect parameters.

## Database release sequence

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
