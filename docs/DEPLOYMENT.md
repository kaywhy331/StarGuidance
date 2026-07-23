# Deployment

No production deployment has been performed or implied.

## Components

- Build `apps/web` on a Node 24-compatible Next.js host.
- Build `apps/profile-engine` from its non-root Python container.
- Apply every file in `packages/database/migrations` in journal order to Supabase-compatible Postgres, then run `corepack pnpm db:seed` with a staging `DATABASE_URL`.
- Configure all required values from `.env.example` in managed secrets; never pass secrets as image build arguments.

## Release sequence

1. Run the full CI matrix, browser suite, migration check, and secret scan from a clean checkout.
2. Connect Supabase Auth and the durable repository adapter; apply migrations in staging.
3. Prove RLS isolation, export, deletion, consent history, and profile/read lineage with two real users.
4. Configure a managed 32-byte encryption key and rehearse rotation, backup restore, deletion, and rollback.
5. Require a profile-engine shared secret and restrict network ingress to the web service.
6. Verify approved AI provider schema handling, no-retention controls, safety evaluations, timeout/retry behavior, and prompt privacy.
7. Verify Stripe test Checkout, webhook signatures/replays, idempotent durable entitlement, refunds, and asynchronous report jobs. The included Stripe code path has not been externally verified.
8. Keep Western astrology and BaZi flags off; certify Dreamspell only after reference and rights approval.
9. Complete accessibility, reduced-motion, mobile, performance, telemetry-redaction, incident-response, and crisis-resource reviews.
10. Deploy with kill switches and rehearse rollback.

The credential-free runtime must never be enabled in production; `APP_ENV=production` disables local sign-in, and production readiness additionally requires removal of every in-process repository path.
