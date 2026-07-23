# Security and privacy

Birth facts, derived profiles, private questions, and follow-ups are sensitive.

## Implemented controls

- AES-256-GCM envelopes use a random 96-bit nonce and authentication tag; tampering fails authentication.
- The local adapter generates an ephemeral 256-bit key, stores only encrypted raw profiles/calculations/questions, uses HttpOnly SameSite=Strict session cookies, and is disabled in production.
- Mutating browser routes validate Origin/Host and use bounded in-process rate limits. Stripe webhooks are exempt from Origin checks and require signature verification.
- Profile-engine bearer authentication is enabled whenever `PROFILE_ENGINE_SHARED_SECRET` is configured.
- Safety classification occurs before a draw for crisis and compulsive-redraw language.
- The draw function accepts no profile snapshot, trait, question, prompt, or AI input.
- AI input is designed to contain only a locked draw, curated meanings, the private question, and a compact stable trait lens. Birth name/date/time/place, email, and raw calculations are excluded.
- History previews are decrypted only for an authenticated response; no question preview is stored in plaintext.
- Authenticated export returns readable birth/profile/reading/report data. Account deletion removes local sessions, encrypted snapshots, readings, reports, orders, entitlements, and user-scoped idempotency entries.
- The migration enables RLS on user-owned tables and defines JWT-subject policies. Audit metadata excludes raw birth and question content.
- Oracle streaming emits only schema-validated persisted result phases; the private question is not included in the stream URL or payload.
- The deploy-preview composition contains synthetic cards and text only, is `noindex`, and is enabled by a Netlify deploy-preview-only flag that defaults off on public production.

## Production gates

The current web runtime does not yet connect to Supabase Auth/Postgres/Storage. RLS therefore has schema-level and migration validation, not live two-user verification. A deployment needs:

- managed `DATA_ENCRYPTION_KEY` generation, rotation, and recovery procedures;
- durable repositories and jobs for deletion, export, report generation, retention, and webhook processing;
- Supabase project credentials and adversarial cross-user tests;
- Stripe test credentials and replay tests against durable order/entitlement storage;
- provider no-retention contracts, redaction verification, privacy-safe telemetry, backup/restore, incident response, and regional crisis resources.

Never put birth data or questions in URLs, analytics, breadcrumbs, logs, support screenshots, or unauthenticated storage. The committed `.env.example` contains names only and no credentials.
