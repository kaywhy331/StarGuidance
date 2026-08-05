# Security and privacy

Birth facts, derived profiles, private questions, and follow-ups are sensitive.

## Implemented controls

- AES-256-GCM envelopes use a random 96-bit nonce and authentication tag; tampering fails authentication.
- Runtime selection fails closed. The local adapter requires `RUNTIME_ADAPTER=local`, `ALLOW_LOCAL_RUNTIME_ADAPTER=true`, a development/test `APP_ENV`, and no hosted Netlify context.
- Supabase Auth is verified server-side with `auth.getUser()`. Routine access uses email/password credentials; passwords are never persisted or logged by the application. Optional signup-confirmation and password-recovery links terminate at a same-site callback, and account deletion also removes the Supabase Auth identity through a server-only service-role client.
- The Supabase repository encrypts raw profiles, calculation payloads, questions, follow-ups, and feedback comments with AES-256-GCM before SQL persistence. The managed key remains outside Postgres.
- Browser JWTs have no private-table privileges. User-scoped SQL transactions assume the non-login, non-inheriting `starguidance_app` role and set only the subject obtained from verified Supabase Auth. RLS is forced on every user-owned table; anonymous/public access is revoked.
- Mutating browser routes validate Origin/Host and use bounded in-process rate limits. Stripe webhooks are exempt from Origin checks and require signature verification.
- Profile-engine bearer authentication is enabled whenever `PROFILE_ENGINE_SHARED_SECRET` is configured. In staging and production, startup rejects a missing or trivially weak secret before serving traffic.
- The profile-engine container disables Uvicorn access logs, and its application does not log request bodies, response bodies, birth inputs, authorization headers, or derived calculations. `/health` remains public and contains no private data.
- The web `/api/health` route exposes configuration names/presence and dependency status codes only. Tests assert that environment values, dependency errors, request bodies, and response bodies are absent from its output.
- Safety classification occurs before a draw for crisis and compulsive-redraw language.
- The draw function accepts no profile snapshot, trait, question, prompt, or AI input.
- AI input is designed to contain only a locked draw, curated meanings, the private question, and a compact stable trait lens. Birth name/date/time/place, email, and raw calculations are excluded.
- History previews are decrypted only for an authenticated response; no question preview is stored in plaintext.
- Authenticated export reads only through user-scoped repositories, then decrypts for that response. Account deletion cascades durable private rows before deleting the hosted Auth identity.
- Reading session and draw writes are one database transaction. Outputs are separate append-only rows, so failure, retry, refresh recovery, and follow-up cannot replace the locked assignments.
- Stripe events are signature checked, claimed with a failure-releasable durable lease, and resolve user/snapshot ownership from the persisted order rather than trusting webhook metadata. Full refunds and disputes revoke the entitlement, and report reads require it to remain active.
- Oracle streaming emits only schema-validated persisted result phases; the private question is not included in the stream URL or payload.
- The deploy-preview composition contains synthetic cards and text only, is `noindex`, and is enabled by a Netlify deploy-preview-only flag that defaults off on public production.

## Production gates

The adapter is connected to the owner-approved disposable Supabase staging project through Netlify Deploy Preview #4. Protected run `30933588147` passed migration/seed rehearsal, forced-RLS and two-user isolation, Auth-backed provisioning, encrypted profile and reading persistence, locked-draw recovery, export, account/Auth deletion, profile-engine authorization, cleanup, redaction, and automated accessibility checks. That evidence is staging-only and does not approve a production deployment.

The remaining security and operations gates are:

- owner-managed key generation/escrow plus a credentialed rehearsal of the implemented dual-read/batched re-encryption procedure;
- owner-approved private-data durations and scheduling for the guarded retention command;
- an owner-inbox rehearsal of optional signup confirmation and password recovery, including a cross-browser token-hash callback;
- hosted Netlify, Supabase, Render, and AI-provider log-retention review by an operator with dashboard access;
- Stripe test credentials and a public webhook/Checkout/refund rehearsal against durable order and entitlement storage;
- provider no-retention contracts, redaction verification, privacy-safe telemetry, backup/restore, incident response, and regional crisis resources.

The concrete role boundary, key-rotation commands, CI logical restore, guarded retention tool, telemetry boundary, and incident procedure are documented in [Operations and recovery](OPERATIONS.md).

Never put birth data or questions in URLs, analytics, breadcrumbs, logs, support screenshots, or unauthenticated storage. The committed `.env.example` contains names only and no credentials.
