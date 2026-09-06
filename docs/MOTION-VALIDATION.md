# Motion validation receipt

Validation date: September 5, 2026. Branch: `agent/cinematic-motion-system`, based on `origin/main` at `6cf0bb7` (PR #43). The continuation preserved the uncommitted motion implementation from the previous session. The historical `agent/implement-prd-foundation` branch still contains bootstrap parts and a materialization workflow; none of those artifacts were used. Existing open PRs were dependency updates. This change adds directly reviewable source and uses the existing pull-request CI workflow.

## Implemented behavior

- Shared timing and motion preferences span landing, forms, guest and authenticated readings, reports, and account controls. Device reduced motion takes precedence and updates live; browser storage failure leaves the control usable.
- Routes and sections arrive briefly, artwork has bounded decorative depth, and loaded backdrop layers crossfade without holding up reading controls. Content stays readable without JavaScript and in print.
- Twelve decorative shells perform one bounded shuffle. All 78 real selection indexes remain available in the fan. Selection and dealing share transform timings, and revealed faces survive live changes to motion preferences.
- Card flights keep both layout anchors at their original fan positions. The transform supplies the whole displacement, preventing a second vertical offset. Container-relative distances follow width and height changes.
- Phase-specific light rules cannot extend the three-second settling animation. Resting atmosphere and narration emphasis do not loop.

See [MOTION-SYSTEM.md](MOTION-SYSTEM.md) for the choreography and extension rules. No draw, profile, AI, payment, or database contract changed.

## Executed checks

Commands use Node **24.20.0**, pnpm **11.16.0**, and Python **3.12.3**. The workspace shell initially selected Node 22, so the installed Node 24 binary was placed first on `PATH` for JavaScript checks.

| Command                                 | Result                                                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`        | Passed; lockfile unchanged.                                                                                                   |
| `pnpm lint`                             | Passed. The updated motion browser spec also received a targeted ESLint check.                                                |
| `pnpm format:check`                     | Passed; final receipt formatting is checked again before commit.                                                              |
| `pnpm typecheck`                        | Passed in every workspace with a typecheck script.                                                                            |
| `pnpm test`                             | 577 passed, 60 skipped. The skipped suites require `DATABASE_INTEGRATION_URL`; this is not evidence of live RLS verification. |
| `pnpm requirements:check`               | Passed; 147 Must requirements accounted for exactly once.                                                                     |
| `pnpm db:check`                         | Passed; Drizzle migration metadata validated.                                                                                 |
| `pytest` in `apps/profile-engine`       | 35 passed.                                                                                                                    |
| `ruff check .` in `apps/profile-engine` | Passed.                                                                                                                       |
| `mypy .` in `apps/profile-engine`       | Passed; 15 source files.                                                                                                      |

The Playwright web-server harness successfully executed production `next build` twice in this session, including once after the final CSS fixes. A subsequent web typecheck covered the final browser assertions. Staging test collection (`playwright test --config=playwright.staging.config.ts --list`, with synthetic compile-only URL values) passed: 18 tests in five files, without contacting external services.

The final desktop/mobile Chromium run executed:

```bash
CAPTURE_SCREENSHOTS=1 pnpm --filter @starguidance/web exec playwright test \
  --config=/tmp/sg-motion-continued-playwright.config.ts \
  motion.spec.ts visual.spec.ts accessibility.spec.ts guest-reading.spec.ts \
  --project=desktop-chromium --project=mobile-chromium
```

**26 passed, two skipped** in 4.2 minutes. The filename pattern also collects `preview-visual.spec.ts`; the two skipped cases require a hosted Netlify preview. Both local screenshot journeys passed, including local report access. An earlier baseline run of the original motion tests passed eight Chromium cases before the vertical-placement and phase-duration assertions were added.

The desktop Chromium regression run used the same verified production build on isolated ports 3337/8337:

```bash
pnpm --filter @starguidance/web exec playwright test \
  --config=/tmp/sg-motion-regression-playwright.config.ts \
  mvp.spec.ts account-settings.spec.ts --project=desktop-chromium
```

**24 passed** in 3.4 minutes. Coverage includes all four initial result contracts, all eight configured spread layouts, optional cutting, reveal order, interrupted-session recovery, same-draw follow-ups, reduced-motion completion, immutable profile snapshots after birth-data edits, local report entitlement, account preference persistence, and policy re-consent.

Cross-browser motion acceptance used:

```bash
pnpm --filter @starguidance/web exec playwright test \
  --config=/tmp/sg-motion-playwright.config.ts motion.spec.ts \
  --project=desktop-firefox --project=desktop-webkit
pnpm --filter @starguidance/web exec playwright test \
  --config=/tmp/sg-motion-playwright.config.ts motion.spec.ts \
  --project=desktop-webkit --grep 'bounded shuffle' \
  --output=/tmp/sg-motion-webkit-final-results
```

The combined run passed all five Firefox cases and four WebKit cases. The final WebKit journey exhausted its initial 90-second total budget during the resize assertion after slow navigation/input actions. Its total timeout now matches existing long reading journeys at 150 seconds; individual assertion timeouts and geometry tolerances remain unchanged. The isolated rerun **passed in 55.7 seconds**. All five motion cases therefore have passing evidence on all four configured browser projects. Across final acceptance and regression runs, **60 distinct browser cases passed**, with the two hosted-preview captures explicitly skipped.

Standalone Gitleaks 8.21.2 directory scans used `--config .gitleaks.toml --redact --no-banner`. `apps/web/tests` passed; `apps/web/src` reported two existing fixed synthetic fixtures in `shared-secret.test.ts:5` and `api/internal/interpretation-jobs/route.test.ts:40`. They are intentionally high-entropy test strings, not configured credentials. No allowlist was broadened. The staged candidate passed `git diff --cached --no-ext-diff | gitleaks stdin --config .gitleaks.toml --redact --no-banner`: no leaks found.

## Screenshots

These synthetic-account images were captured from the final production build in this session. Images were saved without opening them.

| Journey            | Desktop                                                       | Mobile                                                      |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Onboarding         | [Desktop](screenshots/onboarding-desktop-chromium.png)        | [Mobile](screenshots/onboarding-mobile-chromium.png)        |
| Reading selection  | [Desktop](screenshots/reading-selection-desktop-chromium.png) | [Mobile](screenshots/reading-selection-mobile-chromium.png) |
| Shuffle/deal scene | [Desktop](screenshots/shuffle-deal-desktop-chromium.png)      | [Mobile](screenshots/shuffle-deal-mobile-chromium.png)      |
| Card reveal        | [Desktop](screenshots/card-reveal-desktop-chromium.png)       | [Mobile](screenshots/card-reveal-mobile-chromium.png)       |
| Result             | [Desktop](screenshots/reading-result-desktop-chromium.png)    | [Mobile](screenshots/reading-result-mobile-chromium.png)    |
| Report preview     | [Desktop](screenshots/report-preview-desktop-chromium.png)    | [Mobile](screenshots/report-preview-mobile-chromium.png)    |
| Full atlas         | [Desktop](screenshots/pattern-atlas-desktop-chromium.png)     | [Mobile](screenshots/pattern-atlas-mobile-chromium.png)     |

The landing screenshots (`motion-landing-desktop.png`, `motion-landing-mobile.png`) were preserved from the previous session.

## Browser setup and review

Another workspace occupied port 3100. Local browser runs used a temporary config importing `apps/web/playwright.config.ts`, preserving its synthetic test adapters and project settings while replacing ports 3100/8000 with 3317/8317 in server commands, readiness URLs, `use.baseURL`, and `PROFILE_ENGINE_URL`. The first run and final source run included `next build && next start`; subsequent runs can start the same verified production build. The older session's start-only test failure after a separately configured build was not treated as an application regression.

With the default ports free, reviewers can run the same acceptance coverage directly:

```bash
corepack enable
pnpm install --frozen-lockfile
python3 -m pip install --require-hashes -r apps/profile-engine/requirements-dev.lock
pnpm exec playwright install chromium firefox webkit
pnpm --filter @starguidance/web exec playwright test motion.spec.ts \
  --project=desktop-chromium --project=mobile-chromium \
  --project=desktop-firefox --project=desktop-webkit
CAPTURE_SCREENSHOTS=1 pnpm --filter @starguidance/web exec playwright test \
  visual.spec.ts accessibility.spec.ts guest-reading.spec.ts \
  --project=desktop-chromium --project=mobile-chromium
```

The motion suite checks preference persistence, live device changes, blocked storage, cross-tab changes, no-JavaScript content, touch exclusion, desktop pointer reset, a bounded/restartable shuffle, all 78 available keyboard choices, card placement after resizing both viewport dimensions, and a revealed card surviving quiet-mode activation. Existing journeys cover accessibility, text reflow, guest conversion, fixed-draw follow-ups, and local report access.

## Evidence limits

- Screenshots are captured for human review. No image-viewing function was used, and no visual inspection or frame-rate measurement is claimed.
- The full repository browser matrix runs in GitHub Actions; targeted local runs do not imply that every browser test has run locally.
- No live Supabase, AI, Fish Audio, or Stripe credentials were used for this validation. Payment evidence is the documented local test adapter, not a live Checkout verification.
- Migration metadata and the unit tests do not replace the credentialed database integration lane. Production calculation, privacy, content-rights, operational, and provider gates remain in [KNOWN-GAPS.md](KNOWN-GAPS.md).
- Low-end physical-device performance, manual screen-reader review, and public production rollout remain separate release checks. This work is submitted through a draft PR and is not merged.
