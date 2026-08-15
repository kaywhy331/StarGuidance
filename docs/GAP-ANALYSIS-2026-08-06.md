# StarGuidance gap analysis — 2026-08-06

Branch: `agent/starguidance-supabase-staging` @ `80253f1`. Method: four parallel code audits
(reading/tarot/safety UX; profile calculations; auth/privacy/commerce; CI/testing/docs/ops), each
comparing the implementation against the brief (`AGENTS.md` §1–21), `docs/PRD.md`, and
`docs/KNOWN-GAPS.md`, with file:line evidence. Findings are deduplicated and re-tiered here.
This file is a working review artifact, not a replacement for `docs/KNOWN-GAPS.md` — the fix for
several gaps below is precisely to fold corrected language back into the canonical docs.

Tier meanings: **P0** — must fix before the associated surface can be considered launch-ready
(safety, money, correctness of live calculations, silent-failure gates). **P1** — important;
brief/PRD Must-level or integrity items to schedule before public MVP. **P2** — minor, polish, or
record-the-decision items. Commerce P0s are behind `ENABLE_PROFILE_REPORTS=false` today; they
block _flag flip_, not the current reading beta.

## Resolution status — 2026-08-11

The findings below are retained as point-in-time audit evidence; they are not the current open-work list. All repository-actionable G1–G60 remediations have now been implemented or converted into an explicit external approval/provider gate in `docs/KNOWN-GAPS.md`. Waves 1–3 closed the safety interrupt/pre-draw high-stakes boundary, deterministic user-facing fallback, durable worker diagnostics, RLS/AAD/snapshot/retention/deletion controls, calculation correctness/version registries, regression fixtures, and the first documentation drift sweep. Waves 4–5 are recorded below. Wave 6 and the continuation audit added profile correction/prefill, `profile-traits-v4`, `question-trait-lens-v2`, append-only consent history, account settings, safe operational access, complete review screenshots, confirmation/recovery hardening, trusted-edge IP policy, dedicated readiness authentication, environment/secret-scan drift guards, expanded output grounding, calculation latency enforcement, and updated production contracts.

A follow-on remediation pass added structured topic/intent/horizon intake, a question-free general-reading path, no-draw high-stakes confirmation, versioned reading allowances, persisted session TTL and server-authoritative ritual recovery, purchased-report history, tagged PDF generation with web-source parity, role-separated masked trace/retry operations, fully typed `available | unavailable` Western/BaZi/angularity activation payloads, and Firefox/WebKit CI projects. Local validation on 2026-08-11 passed install, formatting, lint, typecheck, 193 web tests plus all package tests, 35 Python tests/Ruff/mypy/latency, migration validation, production audit, build, and 61 active desktop/mobile Chromium E2E tests; Node 24 and actual Firefox/WebKit execution remain CI evidence because the local host is Node 22 and has only Chromium installed.

## Implementation update — Wave 4 (2026-08-10)

G14–G19 and G43–G47 are implemented on this branch. Completed readings now have a direct pre-revealed result route; cut/reveal progress recovers per reading; revealed cards expose orientation-correct themes; follow-up cardinality and normalized reread cooldown are configurable; feedback has an authenticated encrypted route, UI, history state, and export; `result.title` heads the opening theme; Groq cardinality is exact; active deck/spread flags gate creation; motion/sound persist; and history uses spread names plus follow-up/feedback/report state. Migration `0011_reading_flow_controls` carries the database changes. The default remains one follow-up to preserve PRD DEC-007. Scheduled outcome reminders and their separate outcome research schema remain explicitly deferred as recorded in `docs/KNOWN-GAPS.md`; the new feedback surface must not be described as outcome verification.

## Implementation update — Wave 5 (2026-08-10)

G5–G7, G30, G31, and G53 are implemented on this branch. Checkout success/cancel states are active, open sessions resume, expired sessions are replaceable without replacing the order, and one active purchase is reused per snapshot. Verified paid events atomically grant entitlement, create a pending report, and enqueue durable `report_jobs`; the webhook no longer generates the report inline. A minimized encrypted source is staged before redirect so profile deletion during Checkout cannot strand a later payment. Commerce snapshot pointers use `ON DELETE SET NULL`, while profile deletion removes private snapshots/readings and retains finance/report records. The preview and structured report expose all 17 agreed sections with trait provenance, explicit unavailable systems, convergence, and preserved contradictions. Revoked report content and feedback are included in export, and the report banner derives from the persisted provider. Migrations `0012_commerce_report_jobs` and `0013_checkout_report_source` carry the database changes. Commerce remains default-off pending the owner gates in `docs/KNOWN-GAPS.md` and `docs/COMMERCE.md`.

---

## P0 — launch blockers

### G1. Self-harm interrupt shows operator-voice text with no crisis resources

- **Evidence:** `packages/ai/src/index.ts:88-94` returns guidance written to an operator ("Pause
  the reading and connect the person with…"); `apps/web/src/app/readings/reading-chooser.tsx:101-105`
  renders that string as an inline form error. No hotline, no link, no region config anywhere;
  the only crisis copy is static prose on `/terms`. No e2e covers the interrupt. (Brief §10;
  PRD AI-013 Must, SEC-014.)
- **Fix:** Split `SafetyCategory` guidance into `operatorGuidance` (prompt-side) and approved
  second-person `userFacing` copy + a crisis-resource config (file/table, region-keyed, defaulting
  to international resources). Render the interrupt as a dedicated full-screen state, not a form
  error — same treatment on the follow-up path (`reading-scene.tsx:246`). Add an e2e that submits
  crisis language and asserts the resource panel.

### G2. High-stakes questions get no scope-limitation UI; `highStakesQuestion` is dead code

- **Evidence:** `packages/reading-machine/src/index.ts:52-54` defines the state; nothing outside
  its own test ever sends `HIGH_STAKES`. The session scene fast-forwards past `enteringQuestion`
  unconditionally (`reading-scene.tsx:80-87`); `GET /api/readings/[id]` never returns
  `safetyClassification`; `result.safetyFlags` is rendered nowhere. (Brief §10; PRD AI-013 Must.)
- **Fix:** Return `safetyClassification` from the reading GET; on a guarded category, dispatch
  `HIGH_STAKES` and render a non-punitive scope-limitation panel (continue-as-reflection
  affordance) before `preparingDeck`; show `safetyFlags` as a persistent banner on the result.

### G3. Deterministic "reframing" prints policy-instruction text as the reading

- **Evidence:** `packages/ai/src/index.ts:191-195,205` — for any non-ordinary category, every
  card's `questionConnection` and the `directAnswer` are replaced with the same classifier
  instruction string ("Do not claim facts or outcomes; reframe toward evidence…"), displayed
  verbatim N times. (Brief §10 reframing; PRD AI-014 Must.)
- **Fix:** Write per-category, per-position reframing copy in `interpretation.ts` (observable
  behavior / communication / boundaries / evidence / the user's choices) so guarded readings are
  actually reframed instead of echoing policy text. Extend the AI tests beyond refusal phrasing.

### G4. Life Path numerology flattens master numbers via an undocumented convention

- **Evidence:** `apps/profile-engine/src/profile_engine/numerology.py:42,46` sums all ISO date
  digits at once; component-wise reduction (the mainstream convention) preserves master Life
  Paths this method destroys (1987-07-26 → 4 vs 22). `docs/PROFILE-CALCULATIONS.md:5` claims
  "Master numbers 11, 22, and 33 are preserved" without naming the convention; no end-to-end
  master-number test exists. Numerology is the one calculation system live in beta and feeds the
  trait lens and paid report. (PRD CAL-007.)
- **Fix:** Adopt and document component-wise reduction as `pythagorean-v3` (or explicitly defend
  all-digit and correct the doc), add golden cases where the two conventions diverge, and recompute
  nothing retroactively — snapshots carry their algorithm version by design.

### G5. Checkout lifecycle is broken end-to-end (return states inert; abandoned session dead-ends)

- **Evidence:** (a) `apps/web/src/app/api/reports/checkout/route.ts:61-62` sets
  `/profile?checkout=success|cancelled`, but no code anywhere reads a `checkout` param — the
  purchaser lands on an unchanged page. (b) `profile/page.tsx:70-86` reuses one fixed
  idempotency key per snapshot and the replay branch returns `{orderId, status}` without
  `checkoutUrl`, so after a cancelled Stripe session the user can never start checkout again and
  sees no message. (Brief §14 payment return states; PRD RPT-008/RPT-011 Must.)
- **Fix:** Read `checkout` in a client boundary on `/profile` with success (poll fulfillment) /
  cancelled / failed states; when a matched order is still `pending`, return a fresh (or live)
  Checkout URL instead of an inert replay payload.

### G6. Report fulfillment is synchronous inside the Stripe webhook; paid-no-report has no recovery

- **Evidence:** `apps/web/src/lib/stripe-events.ts:86-102` awaits `generateReport` inline before
  ACKing Stripe; `reports.status` is hard-coded `"ready"` (`lib/report.ts:45`), so
  `pending`/`failed` states are dead. A throw after payment leaves order `paid` + entitlement
  `active` + no report, with no retry, status, or operator tool. The migration-0007 job machinery
  exists but is wired only for readings. (Brief §12 background report generation; PRD RPT-010
  Must; already documented at KNOWN-GAPS:23.)
- **Fix:** Generalize the job queue (job `kind` column or a `report_jobs` twin): webhook enqueues
  in the same transaction as the entitlement grant, ACKs immediately; the existing worker +
  scheduled drain fulfil; `reports.status` driven by the job lifecycle.

### G7. Deleting the private profile destroys paid orders and entitlements

- **Evidence:** `apps/web/src/lib/repositories/postgres.ts:358-371` deletes `reports`,
  `entitlements`, `orders` when the user deletes their _profile_ (UI copy mentions only the
  profile). A later `charge.refunded`/dispute webhook then fails reconciliation forever
  (`stripe-events.ts:46-55` → 500 to Stripe). Conflicts with PRD 8.2 finance retention.
- **Fix:** Detach commerce rows from profile deletion (nullable `profile_snapshot_id` or a
  retained order projection); profile deletion keeps commercial records under the finance
  retention policy; only account deletion (with its own policy) touches them. Update
  `docs/OPERATIONS.md` cascade language.

### G8. No gate detects a dead interpretation-job backstop

- **Evidence:** Neither `INTERPRETATION_WORKER_SECRET` nor `NEXT_PUBLIC_APP_URL` appears in
  `REQUIRED_STAGING_ENVIRONMENT` (`apps/web/src/app/api/health/route.ts:14-22`) or the
  staging-verify config check (`.github/workflows/staging-verify.yml:107-133`); no probe touches
  `POST /api/internal/interpretation-jobs`. A missing/weak secret 401s the every-minute trigger
  forever — correct fail-closed behavior whose only signal is a Netlify function log line, while
  every readiness gate reports green and interrupted jobs stay `pending` indefinitely.
- **Fix:** Add both names to the readiness list and staging-verify; add an
  `interpretationWorker: { configured, secretStrong }` block to the readiness payload (reuse
  `isWeakSharedSecret`); add a staging probe asserting the drain route answers 401 (deployed) and
  200 with a derived token (configured); have the drain response include queue depth +
  oldest-pending age so the scheduled function can log a fixed-class alert line.

---

## P1 — important

### Data integrity & security

- **G9. `interpretation_jobs` has no subject-bound RLS and is skipped by every isolation gate.**
  `USING (true)` policy (migration 0007) on a table carrying `user_id`; absent from
  `USER_OWNED_TABLES` in `verify-staging-schema.ts:16-33` and the staging isolation matrix; the
  insert runs inside the requesting user's actor transaction, so an actor bound to user A can
  read/update user B's job rows. `docs/SECURITY.md:14`'s "every user-owned table" claim is now
  imprecise. **Fix:** subject-bound policy for the request path + a distinct claim path (the
  `payment_webhook_events` pattern); add `interpretation_jobs` + `rate_limit_buckets` to an
  `APP_ONLY_TABLES` staging assertion; correct SECURITY.md.
- **G10. AES-GCM envelopes carry no associated data.** `encryption.ts:24-36` — any envelope
  decrypts in any row; ciphertext isn't bound to table/row/owner. **Fix:** `setAAD` with
  `table:rowId:userId` context, re-encrypt during the next rotation window (the rotation tool
  already batches all five encrypted columns).
- **G11. Profile snapshots are only application-immutable.** Full UPDATE/DELETE granted to
  `starguidance_app`, no trigger (`0004_server_actor_role.sql:36-49`); KNOWN-GAPS:3 overstates
  this as an implemented boundary. **Fix:** `BEFORE UPDATE` guard trigger (delete allowed only via
  user-deletion cascade) or narrow grants; soften the KNOWN-GAPS wording until then.
- **G12. Unbounded table growth.** `rate_limit_buckets` never pruned despite its `expires_at`
  index; completed/failed `interpretation_jobs` never removed; `apply-retention.ts` covers only
  audit + webhook events and is manual. **Fix:** opportunistic `DELETE … WHERE expires_at < now()`
  (or piggyback pruning on the scheduled drain); add both tables as approved retention classes.
- **G13. No deletion tombstone; no auth security events.** `audit_events` cascade on user delete
  erases the evidence of erasure; no audit rows for sign-in/out, password change, account
  deletion (PRD ACC-008). **Fix:** user-less `deletion_receipts` row (hashed subject + timestamp +
  policy version) before cascade; add auth-event audit actions.

### Product completeness (reading flow)

- **G14. No reading-result route — revisiting a finished reading forces the whole ritual again.**
  History links to `/session/[id]`, which always bootstraps from `idle` and re-requires cut +
  per-card reveal. (Brief §14 separate result screen; PRD RES-004.) **Fix:** `/reading/[id]` (or
  `?view=result` short-circuit) rendering the pre-revealed spread + transcript when
  `generationStatus === "ready"`; link history there.
- **G15. Interrupted-session recovery restores the draw but not ritual progress.** No reveal/cut
  state is persisted; the e2e concedes the restart (`mvp.spec.ts:316-328`). PRD DRW-008 Must
  requires "correct interaction state". **Fix:** persist `{revealedIndexes, cutTaken}` per reading
  (sessionStorage keyed by reading id or a progress column) and rehydrate the machine.
- **G16. No baseline card meaning at reveal.** Dealt-card payload omits themes; during
  `generatingSynthesis` the user sees name + orientation only. PRD UX-007 Must. **Fix:** include
  orientation-appropriate themes from `tarot-content` in the dealt-card view; one-line caption at
  reveal.
- **G17. Follow-up cap is hard-coded in three layers including a DB unique index**
  (`follow_up_questions_reading_unique`, migration 0005). Brief says "one or more"; PRD caps MVP
  at one — conflict unrecorded. **Fix:** replace unique index with a config/entitlement-driven
  count check read by API + composer; record the product decision.
- **G18. Compulsive-reread protection is four literal phrases.** Same question five times in a
  row is undetected; interrupt doesn't re-present the prior reading; no cooldown (documented
  partially at KNOWN-GAPS:16). **Fix:** same-question/short-interval check against recent
  sessions; on trigger, surface the retained reading + configurable cooldown.
- **G19. `reading_feedback` is fully modeled and completely unreachable** — no route, no UI; PRD
  RES-009 Must (outcome follow-ups) has no table at all; export omits feedback (SEC-008).
  **Fix:** `POST /api/readings/[id]/feedback` + result-view control; add to export; decide/record
  outcome-follow-up scope.

### Product completeness (profile & calculations)

- **G20. Latin-script names silently lose numerology.** NFKD doesn't decompose Ø/Ł/ß/æ/ı →
  `unsupported_writing_system` for Jørgen, Łukasz, Weiß, Işık (`numerology.py:20-27`);
  PROFILE-CALCULATIONS.md describes normalization the code doesn't do. **Fix:** documented
  per-letter Latin-Extended mapping as `pythagorean-v3`, or restate the doc; fixtures either way.
- **G21. Dreamspell counts leap days the Dreamspell system skips.** Continuous Gregorian delta
  (`dreamspell.py:50`); the 260-day cycle test straddles 29 Feb 1988 and locks the divergence in
  (`test_calculations.py:36-42`). **Fix:** decide the leap-day rule; if Dreamspell-canonical,
  subtract intervening Feb 29s, bump version, replace the cycle test, add leap-day goldens.
- **G22. `Location enhanced` unlocks nothing and has zero tests.** No geocoder/timezone code
  exists; no test asserts the state. **Fix:** state plainly in docs + completeness UI copy that
  place is recorded for future activation; add the missing place-only test (§15).
- **G23. Editing birth data starts from a blank form.** `/profile` → `/onboarding` unseeded; a
  complete profile silently regresses when fields aren't retyped; `birthplaceLabel` fetched but
  never rendered; completeness shown as raw enum. **Fix:** prefill the form from
  `GET /api/profile` for the owner's own edit; render place + human-readable completeness.
- **G24. Trait ontology thinner than PRD:** no `direction`/`strength`/`lifeDomains` (CAL-011);
  6 of 13 declared domains never populated; one tension rule; convergence never recorded
  (CAL-012); tensions never rendered anywhere. **Fix:** `profile-traits-v4` with the missing
  fields; at least one rule per kept domain (prune the rest); convergence records; render
  `sideA`/`sideB` in the report.
- **G25. Lens pads to three with irrelevant traits** (rank-99 fill at `packages/ai/src/index.ts:152-160`)
  — a career question gets relationship traits. **Fix:** drop rank-99 entries; accept a 1–2 trait
  lens; feeds from G24.
- **G26. Calculation-version registry disagrees with snapshots.** Seed registers `pythagorean-v1`
  / `unavailable`; snapshots record `pythagorean-v2` / `*-contract-v1` — no join possible
  (CAL-014 reproducibility). **Fix:** single shared version-constant source; CI assertion that
  every emitted version exists in `calculation_versions`.
- **G27. Golden-reference datasets absent for everything marked "implemented and tested".**
  Numerology 3 ad-hoc cases vs 60 required; Dreamspell 2 (one wrong); Nine Star Ki 7 vs 100;
  zero leap-day (`02-29`) tests repo-wide; no suffix case. **Fix:** `tests/fixtures/` per system
  with named source + digest (the format PROFILE-CALCULATIONS.md:64 already mandates), numerology
  first.
- **G28. §5-required name policies undocumented:** middle names, suffixes (Jr/III currently
  counted into the letter sum), birth-vs-current name (only `fullBirthName` exists). **Fix:**
  "Name handling" subsection covering all nine §5 items + explicit suffix decision + fixtures.
- **G29. No typed production interface for Western astrology/BaZi; date-only BaZi pillars (PRD
  CAL-008 Must) unbuilt.** Only a generic unavailable envelope exists; the web contract
  hard-requires that literal, so activation is a two-sided schema project no doc admits.
  **Fix:** versioned discriminated-union result types (positions/aspects/angles/houses/
  uncertainty; pillars) with `unavailable` as one arm; either implement date-only 3-pillar BaZi
  behind a convention manifest or amend PRD 4.3/CAL-008.

### Commerce & account

- **G30. Report covers 9 of the 15+ suggested sections; no pre-purchase preview (RPT-002 Must).**
  Missing: motivations, emotional patterns, relationships, communication/decisions, strengths,
  tensions detail, growth, convergence, contradictions — while `snapshot.tensions` is already
  persisted. **Fix:** derive the missing sections from traits/tensions with provenance; title-only
  preview on `/profile` behind the same flag.
- **G31. Export omits refunded/revoked report content and feedback; privacy-page copy says "no
  security logs" while the payload includes `auditEvents`.** **Fix:** export report content
  regardless of entitlement status; add feedback; fix the copy.
- **G32. Consent mechanics incomplete:** no marketing consent (ACC-007 Must), no withdrawal
  column/endpoint, no re-consent when `POLICY_VERSIONS` bumps. **Fix:** optional marketing consent
  with `withdrawn_at` + settings toggle; version-mismatch re-acceptance interstitial.
- **G33. `user_settings` is dead** — no settings route, no display name (ACC-005 Must), sound and
  reduced-motion preferences reset every reading. **Fix:** account-settings page upserting
  `user_settings`; seed the reading scene from it.
- **G34. No admin/support surface at all** (§11 audited administrative access paths; documented in
  part at KNOWN-GAPS:17) and **no dead-letter visibility** for terminally failed jobs — nothing
  reads `status='failed'`. **Fix (first increment):** read-only
  `packages/database/scripts/inspect-interpretation-jobs.ts` (status counts + fixed error
  classes, never raw `last_error`); name the queue in the KNOWN-GAPS operator bullet.

### Process, tests, CI

- **G35. `guard`/`verify` required checks will deadlock every future PR.** They run only on
  `workflow_dispatch` for this one branch (`staging-verify.yml:15,34,44-57`) yet are required
  status checks on `main` — after merge, unrelated PRs wait forever, admins included. **Fix:**
  drop them from required checks (gate promotion on the published evidence artifact) or add a
  `pull_request` neutral-pass path; record the constraint at KNOWN-GAPS:10.
- **G36. The worker/trigger pair is glued by an unverified string triplicated in three files.**
  `TOKEN_CONTEXT` in the route, its test, and the Netlify function; `netlify/functions` has zero
  tests. Editing the route + test keeps CI green while the trigger 401s forever. **Fix:** shared
  constant importable without `postgres`; a vitest in `netlify/functions-tests/` asserting token
  equality and `config.schedule`.
- **G37. `interpretation-worker.ts` itself is untested** (E2E pins the local adapter where it
  no-ops; the route test mocks it). **Fix:** unit tests over a faked persistence/provider —
  success, transient failure, terminal failure (reading marked failed), missing reading.
- **G38. §15 test-matrix holes:** leap-day birth (zero hits repo-wide), location-only
  enhancement, master numbers end-to-end, provider timeout retry (adapter makes exactly one
  attempt — arguably superseded by job-level retry, but the decision is unrecorded). **Fix:** add
  the fixtures (overlaps G21/G22/G27); record the adapter no-retry decision or add a bounded one.
- **G39. No e2e touches a safety interrupt** — the only `/crisis/i` assertion is the terms-page
  link test. **Fix:** part of G1/G2 acceptance.
- **G40. §21 evidence incomplete:** 4 of 12 required screenshots (missing onboarding, reading
  selection, shuffle/deal, report preview × both form factors); README lacks the required
  environment-variables and deployment sections. **Fix:** extend `visual.spec.ts` capture points;
  add the two README sections linking `.env.example` + DEPLOYMENT.md.
- **G41. Staging verification doesn't exercise migration 0007's surface** — only the migration
  count proves it applied; no drain-route probe; `migration-integrity.test.ts` has a static
  RLS/grant assertion block for 0006 but not 0007. **Fix:** copy the 0006 assertion block for
  0007; staging step calling the drain route with a derived token (overlaps G8/G9).

---

## P2 — minor / record-the-decision

- **G42.** `sessionExpired` state is unreachable (no TTL exists) — implement expiry or remove the
  state and record why. `selectingReading`/`enteringQuestion` are replayed synthetically, not
  governing — document the machine's actual scope.
- **G43.** `result.title` is validated, generated, and never displayed — use it as the
  `openingTheme` heading (PRD RES-001).
- **G44.** Groq schema lacks `minItems`/`maxItems` on `cards`; a short response duplicates card
  1's prose under other cards' names — constrain to the locked position count, treat mismatch as
  invalid-response.
- **G45.** Spread/deck DB tables are seeded but never read at runtime (code is the source of
  truth) — add an `active` kill-switch flag consulted at request time, or drop the unread tables.
- **G46.** In-app reduced-motion toggle is hidden when the OS preference is set (un-reversible)
  and neither motion nor sound persists — always render, seed from OS, persist via G33.
- **G47.** History renders raw spread IDs (`crossroads`) and no follow-up/report state — map to
  display names; extend the payload.
- **G48.** Dead `magiclink` callback branch (no `signInWithOtp` caller anywhere) — remove it and
  reword KNOWN-GAPS:29 to name confirmation/recovery links explicitly.
- **G49.** No resend-confirmation path; the sign-up form permanently disables after one notice —
  add a resend action.
- **G50.** Off-Netlify, anonymous rate limiting collapses to one global `client:unresolved`
  bucket (`request-security.ts:115-124`) — acceptable while Netlify-only; record it, or key by
  connection IP when a trusted header exists.
- **G51.** Readiness bearer reuses `PROFILE_ENGINE_SHARED_SECRET` across trust domains — dedicate
  a secret at the next rotation.
- **G52.** `.env.example` drift both ways: declares unread vars (`SENTRY_DSN`, PostHog pair,
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_NAME`) that a telemetry-boundary test
  actively forbids wiring, while omitting vars the ops scripts require (`RETENTION_*`,
  `KEY_ROTATION_*`, `DATABASE_INTEGRATION_URL`). Header says "and Storage" though Storage is
  unused. Prune + add.
- **G53.** Report banner hard-codes "local test entitlement" regardless of adapter — derive from
  the order's provider.
- **G54.** Birthplace min-length mismatch (zod none vs engine `min_length=2`) yields a generic
  422 — mirror `.min(2)` client-side.
- **G55.** Vestigial `approximateTime` completeness enum member contradicts §4 — delete from both
  enums.
- **G56.** Nine Star Ki is computed/encrypted on every save yet reachable by no beta user
  (lens-excluded, report-flag-gated) — note that in PROFILE-CALCULATIONS.md so nobody
  fast-tracks certification for an invisible surface.
- **G57.** No output guard against a live model inventing profile-system values ("your Life Path
  7") — add a pattern group to `output-safety.ts`, active when the live provider is selected.
- **G58.** Onboarding copy lacks the §6 personalization disclosure and any mention that the full
  report is a paid product — one sentence at the point of collection; record the PRO-007
  deviation (houses/Ascendant omitted while unavailable) as intentional.
- **G59.** `gitleaks-action` has no config; org transfer would break `secret-scan` without
  `GITLEAKS_LICENSE`; no allowlist for synthetic test secrets — add a minimal `.gitleaks.toml`;
  note the license requirement in DEPLOYMENT.md.
- **G60.** No profile-calculation cache and no latency-budget check (PRD CAL-016 p95 targets;
  every POST recomputes) — measure first; cache only if the budget actually fails.

---

## Documentation drift (fix as one sweep)

| Doc                                | Problem                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ARCHITECTURE.md:17`          | Still says generation runs inside the request and calls the background boundary an open gate — closed by migration 0007.                                                          |
| `docs/DEPLOYMENT.md:125` (gate 9)  | Same stale claim.                                                                                                                                                                 |
| `docs/TAROT-INTEGRITY.md:15`       | Says cut is auto-skipped and reveals are sequential — contradicted by the shipped Cut/Skip/reveal controls and KNOWN-GAPS:15.                                                     |
| `docs/KNOWN-GAPS.md:7`             | Names only migration 0005 as requiring staging application — 0006 and 0007 do too.                                                                                                |
| `docs/KNOWN-GAPS.md:3`             | "Immutable snapshot … lineage" overstates DB enforcement (G11).                                                                                                                   |
| `docs/SECURITY.md:14-15`           | "RLS forced on every user-owned table" (see G9) and "in-process rate limits" (superseded by migration 0006); the new internal worker route is absent from the boundary inventory. |
| `docs/PROFILE-CALCULATIONS.md:3-5` | "Implemented and tested" heading over numerology with an unstated reduction convention (G4), unhandled Latin letters (G20), and no reference set (G27).                           |
| `docs/KNOWN-GAPS.md:29`            | "Magic-link" phrasing suggests passwordless sign-in exists; the owner smoke test is really confirmation/recovery links (G48).                                                     |

---

## Owner / ops actions (cannot be closed by repository code)

1. Apply the authoritative migration history through `0016_reading_intake_recovery` to the real Supabase staging project and run the protected exact-commit verification.
2. Set `INTERPRETATION_WORKER_SECRET` in Netlify (server-only, Functions scope, ≥32 chars).
3. Set the distinct `READINESS_PROBE_SECRET`, approved reading-policy values, and any named `SUPPORT_USER_IDS` / `OPERATOR_USER_IDS` in their server-only deploy scope.
4. Confirm `NEXT_PUBLIC_APP_URL` resolves from the Netlify **Functions** runtime and that the
   `*/1 * * * *` scheduled function actually registered post-deploy.
5. Run the real-inbox confirmation/recovery-link smoke test, credentialed Stripe lifecycle UAT, provider dashboard/retention review, and independent tagged-PDF/manual accessibility review.
6. Assign an independent reviewer before any merge (required-review count is 0 and self-approval
   never counts).

---

## Verified solid (no action)

Card-selection integrity end to end (CSPRNG Fisher–Yates, independent reversals, dedupe, draw
locked pre-AI, no reshuffle on failure); result-contract validation at every write/read/stream
boundary with zero raw-HTML rendering; AI-input privacy (payload key-exhaustively asserted; no
birth data can reach the provider; no `console.*` in app code); birth-time rules and snapshot
pinning incl. the async worker; fail-closed calculation flags on both sides of the contract;
Stripe test-mode-only guards, signature + replay lease, refund/dispute revocation; encryption
round-trip + bounded key rotation; forced RLS on the 17 subject-bound tables; all 26 brief-listed
entities exist in schema; all 8 required E2E scenarios exist; CI covers the full §17 list without
write-back.

---

## Suggested fix order

- **Wave 1 — safety + gates + truth (implemented):** G1, G2, G3, G8, G36,
  G37, G39, G41, the documentation-drift sweep, G48, G55.
- **Wave 2 — data integrity (implemented):** G9, G10, G11, G12, G13, G26.
- **Wave 3 — calculation correctness (implemented; certification remains external):** G4, G20, G21, G27, G28 (+ G38 fixtures).
- **Wave 4 — reading-flow completeness (implemented 2026-08-10):** G14, G15, G16, G17, G18, G19, G43–G47.
- **Wave 5 — commerce (implemented 2026-08-10; flag remains off):** G5, G6, G7, G30, G31, G53.
- **Wave 6 — account & ops (implemented 2026-08-11):** G23–G25, G29, G32–G35, G38, G40, G42, G49–G52, G56–G60.
- **Parallel, owner-side:** the six external actions above.
