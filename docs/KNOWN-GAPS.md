# Known gaps and production gates

## Implemented development behavior

- End-to-end onboarding for date-only, exact, approximate-range, and unknown time profiles.
- Deterministic numerology, pending-certification Dreamspell, sourced traits/tensions, immutable snapshots, and explicit astrology/BaZi unavailability.
- Four spreads, secure locked draw, XState ritual, recovery, reduced motion, same-draw retry/follow-up, structured deterministic fallback, safety handling, history, export, deletion, and printable report UI.
- AES-GCM helpers, relational migration/RLS artifacts, local consent/audit/order/entitlement/idempotency behavior, Stripe signature code, and desktop/mobile E2E coverage.

## External credentials and unverified paths

- Supabase credentials are needed to implement and verify hosted authentication, durable Postgres repositories, Storage, RLS isolation, deletion, and export.
- An approved AI provider key and no-retention configuration are needed for live synthesis. Only the deterministic fallback is executed today.
- Stripe test keys, price ID, webhook secret, and a public endpoint are needed to verify real Checkout and webhook delivery. The browser test exercises the explicitly labeled local entitlement adapter, not Stripe's network.
- Observability credentials and a reviewed redaction/sampling policy are needed before telemetry can be enabled.

## Calculation, content, and owner decisions

- Western astrology needs compatible ephemeris licensing, conventions, reference cases, and expert sign-off.
- BaZi needs approved year/month/day/hour boundaries, reference cases, and expert sign-off.
- Dreamspell needs an approved decoder dataset and terminology/rights review.
- Pricing, refund policy, age policy, final legal/privacy copy, launch countries/currencies, crisis resources, report editorial review, deck art/brand, retention periods, and backup policy require owner decisions.
- The generated sanctuary/card-back assets and original vector card-face system require final owner brand and production-distribution approval; no third-party deck license is relied upon.

## Operational gaps

- The local adapter is volatile and not horizontally scalable. Durable jobs, queues, distributed rate limits, email, storage, backup/restore, key rotation, provider failure drills, refund/revocation, and production monitoring are not implemented or verified.
- Migration SQL is validated structurally; it has not been rehearsed against a provisioned Supabase staging database.
- The FastAPI service supports a shared bearer secret, but production network policy and secret rotation are unverified.
- No production payment, AI, authentication, persistence, or deployment path should be described as verified.
