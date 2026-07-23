# Security and privacy

Birth facts, derived profiles, private questions, and follow-ups are sensitive.

## Implemented controls

- AES-256-GCM envelopes use a random 96-bit nonce and authentication tag; tampering fails authentication.
- Runtime selection fails closed. The local adapter requires `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, a development/test `APP_ENV`, and no hosted Netlify context.
- Supabase Auth is verified server-side with `auth.getUser()`. Passwordless links terminate at a same-site callback, and account deletion also removes the Supabase Auth identity through a server-only service-role client.
- The Supabase repository encrypts raw profiles, calculation payloads, questions, follow-ups, and feedback comments with AES-256-GCM before SQL persistence. The managed key remains outside Postgres.
- User-scoped SQL transactions assume the `authenticated` role and set only the subject obtained from verified Supabase Auth. RLS is forced on every user-owned table; anonymous/public table privileges are revoked.
- Mutating browser routes validate Origin/Host and use bounded in-process rate limits. Stripe webhooks are exempt from Origin checks and require signature verification.
- Profile-engine bearer authentication is enabled whenever `PROFILE_ENGINE_SHARED_SECRET` is configured. In staging and production, startup rejects a missing or trivially weak secret before serving traffic.
- The profile-engine container disables Uvicorn access logs, and its application does not log request bodies, response bodies, birth inputs, authorization headers, or derived calculations. `/health` remains public and contains no private data.
- Safety classification occurs before a draw for crisis and compulsive-redraw language.
- The draw function accepts no profile snapshot, trait, question, prompt, or AI input.
- AI input is designed to contain only a locked draw, curated meanings, the private question, and a compact stable trait lens. Birth name/date/time/place, email, and raw calculations are excluded.
- History previews are decrypted only for an authenticated response; no question preview is stored in plaintext.
- Authenticated export reads only through user-scoped repositories, then decrypts for that response. Account deletion cascades durable private rows before deleting the hosted Auth identity.
- Reading session and draw writes are one database transaction. Outputs are separate append-only rows, so failure, retry, refresh recovery, and follow-up cannot replace the locked assignments.
- Stripe events are signature checked, claimed through a unique durable event row, and resolve user/snapshot ownership from the persisted order rather than trusting webhook metadata.
- Oracle streaming emits only schema-validated persisted result phases; the private question is not included in the stream URL or payload.
- The deploy-preview composition contains synthetic cards and text only, is `noindex`, and is enabled by a Netlify deploy-preview-only flag that defaults off on public production.

## Production gates

The adapter and isolated-Postgres RLS suite are implemented. This branch has not been connected to an owner-managed Supabase staging project because no credentials are available in the execution environment. A deployment still needs:

- managed `DATA_ENCRYPTION_KEY` generation, rotation, and recovery procedures;
- Supabase staging credentials, migration/seed execution, and Auth-backed adversarial cross-user verification;
- a key-rotation rehearsal and durable asynchronous report/retention jobs;
- Stripe test credentials and replay tests against durable order/entitlement storage;
- provider no-retention contracts, redaction verification, privacy-safe telemetry, backup/restore, incident response, and regional crisis resources.

Never put birth data or questions in URLs, analytics, breadcrumbs, logs, support screenshots, or unauthenticated storage. The committed `.env.example` contains names only and no credentials.
