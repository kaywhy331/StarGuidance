# Deployment

## Components

- Deploy `apps/web` to a Node 24-compatible Next.js host.
- Deploy `apps/profile-engine` from its non-root Python container.
- Apply `packages/database/migrations` to a Supabase-compatible Postgres environment.
- Store all `.env.example` values in managed runtime configuration; never copy secrets into source or build arguments.

## Required release sequence

1. Run the complete CI matrix and secret scan from a clean checkout.
2. Apply migrations in staging and verify RLS with two real authenticated users.
3. Verify encryption key access, rotation procedure, deletion/export, and backup restore.
4. Verify AI no-retention controls and safety evaluations, then Stripe test-mode signatures, replay handling, and entitlement fulfillment.
5. Confirm calculation/content licenses and golden references; leave unavailable flags off otherwise.
6. Run browser, accessibility, reduced-motion, performance, and production telemetry privacy checks.
7. Deploy with flags disabled by default and rehearse rollback/kill switches.

No production deployment has been performed or implied by the local development adapters.
