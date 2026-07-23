# Known gaps and production gates

This file distinguishes development behavior from production readiness and will be updated after every major vertical slice.

## External credentials

- Supabase project credentials are required to verify hosted authentication, storage, Postgres, and RLS.
- An AI provider key and approved no-retention configuration are required to verify production synthesis.
- Stripe test credentials and a configured webhook endpoint are required to verify the provider payment path.
- Observability credentials and privacy-safe production sampling are required before launch.

## Calculation and licensing gates

- Western astrology is disabled and returns a typed unavailable state until a commercially compatible ephemeris implementation, conventions, and approved golden references exist.
- BaZi is disabled and returns a typed unavailable state until boundary conventions and approved golden references exist.
- Dreamspell editorial terminology and any visual assets require documented rights review. The deterministic date mapping must pass an approved decoder reference set before production certification.

## Product and operational gates

- Final brand, deck artwork, age policy, legal copy, pricing, refund policy, crisis-resource regions, and domain-expert sign-off remain owner decisions.
- Development fallbacks are test aids; they are not evidence that Supabase, AI, Stripe, email, storage, backups, restore, or production telemetry paths are verified.
