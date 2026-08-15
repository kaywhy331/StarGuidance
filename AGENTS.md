# StarGuidance — Implementation Brief

## Role

Act as the lead full-stack engineer and technical product owner for StarGuidance.

Your responsibility is to implement an end-to-end, production-oriented MVP from the supplied PRD, validate it, document it, and publish the work through a draft pull request.

Repository:

https://github.com/kaywhy331/StarGuidance

`docs/PRD.md` is the primary product source of truth.

Do not merge directly into `main`.

---

# 1. Initial repository inspection

Before writing code:

1. Fetch all branches and inspect the repository.
2. Review:
   - `main`
   - `agent/implement-prd-foundation`
   - any existing open pull requests
   - existing GitHub Actions workflows
3. The prior implementation attempt may contain bootstrap artifacts such as:
   - `.bootstrap/part-*`
   - `.github/workflows/materialize-source.yml`
4. Do not merge or build on bootstrap artifacts unless they contain verified, readable source code.
5. Prefer creating a clean branch from `main`:

   `agent/starguidance-mvp`

6. Do not modify `main` directly.
7. Do not delete potentially useful prior work until it has been inspected.
8. Document the repository state in the draft PR.

If the repository is effectively empty, initialize the project using the architecture below.

---

# 2. Objective

Build a minimal, immersive horoscope and tarot-reading web application that:

- Creates a private profile using the user’s birth information.
- Requires birth name and date of birth.
- Accepts birthplace and birth time as optional enhancements.
- Uses the private profile to personalize tarot interpretations.
- Does not use the profile to select or manipulate tarot cards.
- Lets the user select a reading type.
- Lets the user enter a question.
- Animates shuffling, dealing, and flipping cards.
- Presents a structured reading with:
  - individual card meanings
  - overall synthesis
  - likely trajectory
  - alternative trajectory
  - practical user agency
  - reflection question
  - uncertainty statement
- Allows one or more follow-up questions based on the same locked reading.
- Offers a detailed private profile report as a separate paid product.
- Preserves user privacy and does not expose raw birth information to the AI provider unnecessarily.

The application should feel simple, premium, minimal, atmospheric, and immersive rather than like a conventional chatbot.

---

# 3. Recommended architecture

Use a modular monorepo.

```text
/apps
  /web
  /profile-engine

/packages
  /database
  /contracts
  /tarot-domain
  /tarot-content
  /reading-machine
  /design-system
  /ai
  /config

/docs
```

## Web application

Use:

- Next.js App Router
- React
- TypeScript with strict mode
- Tailwind CSS
- Accessible headless UI primitives
- Motion for card and page animation
- XState for reading-flow state management
- React Hook Form
- Zod
- Supabase Auth, Postgres, and Storage
- Drizzle ORM or another typed SQL-oriented migration system
- Stripe for one-time report purchases
- Playwright for end-to-end tests
- Vitest for TypeScript unit tests

Use current stable, mutually compatible versions. Pin versions in the lockfile.

## Profile engine

Use a separate Python service with:

- FastAPI
- Pydantic
- pytest
- explicit versioned calculation contracts

Keep astrology, numerology, BaZi, and Dreamspell calculations isolated from the UI and AI layers.

## AI layer

Create a provider-agnostic adapter.

The AI must receive structured inputs and return schema-validated structured output.

The AI is the narrator and synthesizer. It must not:

- calculate astrology
- calculate numerology
- calculate BaZi
- calculate Dreamspell signatures
- choose tarot cards
- alter a locked card draw
- invent unsupported profile details

Provide a deterministic reading fallback when no AI credentials are configured or generation fails.

---

# 4. Non-negotiable birth-profile behavior

## Required fields

- Full birth name
- Date of birth

## Optional fields

- Birthplace
- Birth time

## Birth-time rules

Present one optional birth-time field. A blank value means no birth time was supplied. Do not ask
the user to classify the time as unknown, exact, or approximate, and do not request a timezone in
onboarding.

A supplied birth time is accepted independently of birthplace. Calculations that require historical
timezone context must remain unavailable unless a validated calculation integration can derive that
context safely; profile creation itself must not be blocked.

Never invent a birth time.

Do not silently default to:

- noon
- midnight
- sunrise
- 6:00 AM

A neutral internal timestamp may be used only for date-based calculations where the result is proven stable across the entire day. It must never be presented as the user’s natal time.

## Profile completeness states

Implement these states:

### Core

Available:

- Birth name
- Birth date

Capabilities:

- Pythagorean numerology
- Dreamspell Galactic Signature
- stable date-based profile traits

Unavailable or potentially uncertain:

- Ascendant
- Western houses
- Midheaven
- BaZi hour pillar
- time-sensitive Moon or aspect data

### Location enhanced

Available:

- Birth name
- Birth date
- Birthplace

Capabilities:

- location and historical-timezone context
- better date-boundary handling

Still unavailable:

- Ascendant
- Whole Sign houses
- Placidus houses
- BaZi hour pillar

### Complete

Available:

- Birth name
- Birth date
- birth time
- birthplace

Capabilities may include:

- Ascendant
- chart angles
- Whole Sign houses
- Placidus houses
- complete BaZi Four Pillars
- time-sensitive placements

## Updating birth data

When the user later adds or edits birth data:

1. Create a new profile snapshot.
2. Use it for future readings.
3. Preserve historical readings with their original profile snapshot.
4. Do not silently reinterpret old readings.

---

# 5. Calculation requirements

## Pythagorean numerology

Implement deterministic, tested calculation logic.

Define and document behavior for:

- middle names
- suffixes
- hyphens
- apostrophes
- accents
- non-Latin names
- transliteration
- master numbers
- birth name versus current name

Do not silently transliterate or strip non-Latin names. Preserve the original name and mark
unsupported name-derived calculations unavailable without asking the user for a Latin rendering or
blocking profile creation.

## Dreamspell Galactic Signature

Treat this as the Dreamspell system, not as an interchangeable representation of the historical Maya calendar.

Store:

- kin
- tone
- solar seal
- algorithm version

Use original or properly licensed descriptions and visual assets.

## Western astrology

Create a production interface for:

- planetary positions
- aspects
- Whole Sign houses
- Placidus houses
- Ascendant
- Midheaven
- calculation status
- uncertainty information

Do not ship fabricated astrology results.

Use an astronomical calculation library only when its licensing is compatible with the project. Keep any ephemeris dependency isolated behind the profile-engine interface.

If the licensed or validated engine is unavailable:

- return `unavailable`, not placeholder chart data
- keep the feature behind a flag
- document the production activation requirements

## BaZi Four Pillars

Make calculation conventions explicit and versioned, including:

- calendar input
- year boundary
- month boundary
- solar-term handling
- timezone handling
- true-solar-time behavior
- Zi-hour day boundary

Do not ship unvalidated BaZi results.

Use golden-reference test cases before marking the module production-ready.

---

# 6. Private personality lens

Normalize all profile systems into a shared trait ontology.

Suggested domains:

- core motivation
- emotional processing
- communication style
- decision style
- social orientation
- relationship needs
- risk orientation
- stability versus change
- conflict response
- work style
- creative expression
- repeating tension
- growth lever

Every derived trait must retain:

- source system
- source rule
- profile snapshot
- calculation version
- confidence or stability status

Preserve contradictions instead of averaging them away.

Example:

```json
{
  "tension": "independence_vs_reassurance",
  "sideA": "Strong preference for autonomous decisions",
  "sideB": "Strong desire for emotional confirmation"
}
```

Generate a compact reading lens containing only the traits relevant to the user’s current question and reading.

Do not send the following to the AI provider unless strictly required and explicitly documented:

- full birth name
- exact birth date
- exact birth time
- full birthplace
- raw natal chart data

The user should be told that a private birth profile personalizes the reading, even though the full profile report is not displayed without purchase.

---

# 7. Tarot system

## Deck

Create a complete 78-card tarot data model containing:

- card ID
- card name
- Arcana type
- suit
- number or court rank
- upright themes
- reversed themes
- event tags
- reflective prompts
- content version
- source or editorial attribution

Use original, licensed, or confirmed public-domain visual assets.

Do not scrape copyrighted deck artwork or guidebook copy.

Placeholder card faces may use original typography, geometric symbols, numbers, suits, and abstract illustrations.

## Initial readings

Implement these configurable spreads:

1. Single Card — Focus
2. Three Cards — Situation, Challenge, Direction
3. Five Cards — Crossroads
4. Seven Cards — Deeper Outlook

Store spreads as configuration or database content rather than hard-coding each route.

Each spread position must have:

- ID
- display name
- interpretive function
- description
- display order
- animation placement

## Card-selection integrity

The private profile must not influence the cards drawn.

The question must not influence the cards drawn.

The draw process must:

1. Create the reading session.
2. Lock deck and spread versions.
3. Use a cryptographically secure random source.
4. Shuffle with a correct unbiased algorithm.
5. Determine reversals independently.
6. Persist the full locked draw before calling the AI.
7. Prevent duplicate cards.
8. Prevent AI retries from changing cards.
9. Preserve the same draw for follow-up questions.

Store:

- reading ID
- deck version
- spread version
- shuffle version
- card assignments
- orientations
- profile snapshot
- prompt version
- content version
- model identifier
- timestamps

A failed AI generation must never trigger an automatic reshuffle.

---

# 8. Reading experience

Use an XState state machine or equivalent explicit state model.

Required states:

```text
idle
selectingReading
enteringQuestion
preparingDeck
shuffling
cuttingDeck
dealing
awaitingReveal
revealingCards
generatingSynthesis
revealingResult
complete
generationFailed
sessionExpired
highStakesQuestion
```

## Animation

Implement a performant 2.5D DOM experience using:

- CSS perspective
- `transform-style: preserve-3d`
- `backface-visibility`
- card flip rotation
- spring motion
- layered shadows
- subtle parallax

Do not animate 78 full card components during shuffling. Use a small set of visual card shells while maintaining the real deck in application state.

Support:

- user-controlled card reveal
- optional deck cut
- skip animation
- reduced-motion mode
- sound on/off
- keyboard navigation
- screen-reader labels
- mobile touch interaction
- interrupted-session recovery

Start reading generation after the cards are locked and dealt so generation latency is partially hidden behind the reveal ritual.

---

# 9. Reading result contract

Return structured JSON matching a schema similar to:

```json
{
  "title": "",
  "centralTheme": "",
  "cards": [
    {
      "positionId": "",
      "cardId": "",
      "traditionalMeaning": "",
      "personalizedMeaning": "",
      "questionConnection": ""
    }
  ],
  "synthesis": "",
  "likelyTrajectory": {
    "summary": "",
    "conditions": [],
    "alternateTrajectory": ""
  },
  "userAgency": [],
  "reflectionQuestion": "",
  "disconfirmingEvidence": [],
  "uncertainty": ""
}
```

Validate the output before displaying it.

Render designed UI components from structured data. Do not directly render arbitrary model-generated HTML or Markdown.

## Follow-up questions

A follow-up question must:

- use the same reading ID
- use the same cards and orientations
- use the same profile snapshot
- reference the existing result
- never redraw unless the user explicitly starts a new reading

---

# 10. Safety behavior

Tarot results must be framed as conditional reflection and possible trajectories, not guaranteed future facts.

Do not generate deterministic claims involving:

- physical death
- pregnancy
- medical diagnosis
- legal verdicts
- criminal guilt
- infidelity as fact
- investment returns
- guaranteed employment
- mental-health diagnosis

Questions about private third parties must be reframed toward:

- observable behavior
- communication
- boundaries
- evidence
- the user’s choices

High-stakes medical, legal, or financial questions must receive an appropriate scope limitation and encourage qualified professional advice without making the interface feel punitive.

Immediate self-harm language must interrupt the normal reading flow and present crisis-support guidance appropriate to the user’s location where available.

Add protection against compulsive rereading:

- retain the previous answer
- do not silently redraw
- optionally introduce a cooldown
- distinguish clarification from a new reading

---

# 11. Authentication, persistence, and privacy

Implement:

- account creation and login
- guest mode only if the PRD permits it
- encrypted raw birth-profile storage
- versioned derived-profile snapshots
- reading history
- reading deletion
- profile deletion
- account deletion
- personal-data export
- Row-Level Security
- audited administrative access paths

Do not expose sensitive information in:

- URLs
- browser analytics
- application logs
- error-tracking breadcrumbs
- client-side public state
- AI prompts unless required

Use application-level authenticated encryption for raw sensitive profile fields.

Do not commit encryption keys or secrets.

Create `.env.example` with every required environment variable and no actual credentials.

---

# 12. Paid profile report

Implement a one-time purchase flow for the detailed profile report.

The report should be generated from the deterministic profile snapshot and structured interpretation rules.

Suggested sections:

1. Personal overview
2. Core motivations
3. Emotional patterns
4. Relationships
5. Communication and decisions
6. Strengths
7. Internal tensions
8. Growth opportunities
9. Western astrology
10. Numerology
11. BaZi Four Pillars
12. Dreamspell Galactic Signature
13. Cross-system convergence
14. Cross-system contradictions
15. Practical integration prompts

Requirements:

- Stripe test-mode Checkout
- webhook verification
- idempotent fulfillment
- entitlement record
- background report generation
- structured report storage
- responsive web report
- printable/exportable format
- clear handling of unavailable profile components
- no fabricated report sections

When credentials are missing, create a documented local test adapter. Do not represent the live payment flow as verified.

---

# 13. Database entities

At minimum, model:

- users
- user settings
- consents
- birth profiles
- profile snapshots
- profile components
- profile traits
- decks
- cards
- card meanings
- spreads
- spread positions
- reading sessions
- reading draws
- reading outputs
- follow-up questions
- reading feedback
- reports
- report sections
- products
- orders
- entitlements
- payment webhook events
- prompt versions
- calculation versions
- content versions
- audit events

Provide migrations and seed data.

All user-owned tables must have tested authorization policies.

---

# 14. Required application routes

Create an intuitive route structure covering:

- landing page
- onboarding
- profile details
- reading selection
- reading question
- active reading scene
- reading result
- reading history
- paid profile report
- account and privacy controls
- authentication
- payment return states

Exact route naming may follow framework conventions.

---

# 15. Quality and testing

Create automated tests for:

## Tarot domain

- 78 unique cards
- correct Arcana and suit counts
- no duplicate draw
- shuffle integrity
- reversal assignment
- immutable reading draw
- same-draw retry
- same-draw follow-up
- valid spread positions

## Profile behavior

- date-only profile
- location-only enhancement
- omitted optional birth time
- time with place
- time without place
- profile snapshot versioning
- leap-day birth
- name punctuation
- Unicode names
- master-number behavior
- stable versus uncertain traits

## AI

- schema validation
- deterministic fallback
- invalid-provider response
- timeout retry
- no redraw on failure
- safety classification
- third-party question reframing
- high-stakes question handling

## Security

- encryption round trip
- tamper rejection
- RLS/user isolation
- secret scanning
- no sensitive analytics payloads
- deletion and export

## End-to-end

At minimum:

1. Date-only onboarding through completed reading.
2. All four birth fields through completed reading.
3. Birth time without birthplace or timezone through completed reading.
4. AI-disabled deterministic fallback.
5. Interrupted reading recovery.
6. Reduced-motion reading.
7. Follow-up question using the same cards.
8. Test-mode report purchase and entitlement.

---

# 16. Required validation commands

Create scripts so the following or equivalent commands work:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

For the profile engine:

```bash
pytest
ruff check .
mypy .
```

Do not claim a check passed unless it was actually executed successfully.

Document any unavailable check and its exact blocker.

---

# 17. CI requirements

Create GitHub Actions that run on pull requests:

- dependency installation
- lint
- formatting check
- TypeScript type check
- unit tests
- Python tests
- production build
- secret scan
- database migration validation

Add Playwright execution when the CI environment supports it.

The workflow must not commit generated source code back into the branch.

Do not use binary bootstrap archives or self-materializing source bundles.

All source code must be directly visible and reviewable in Git.

---

# 18. Documentation deliverables

Create:

- `README.md`
- `docs/PRD.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY.md`
- `docs/PROFILE-CALCULATIONS.md`
- `docs/TAROT-INTEGRITY.md`
- `docs/LOCAL-DEVELOPMENT.md`
- `docs/DEPLOYMENT.md`
- `docs/KNOWN-GAPS.md`

The README must include:

- product overview
- architecture
- setup commands
- environment variables
- local development
- testing
- deployment
- production gates

---

# 19. Working method

Work in vertical slices and keep the application runnable.

Recommended order:

1. Repository and monorepo foundation
2. Design system and application shell
3. Birth-profile onboarding
4. Profile completeness and snapshot model
5. Tarot deck and spread domain
6. Secure reading-session draw
7. Reading state machine
8. Shuffle, deal, flip, and result UI
9. Deterministic interpretation
10. AI adapter
11. Persistence and authentication
12. Paid report flow
13. Privacy controls
14. Tests and CI
15. Documentation and draft PR

Create coherent commits for major milestones.

Do not leave the repository in a state where source code exists only inside an archive.

Make reasonable implementation decisions without repeatedly requesting clarification. Stop only when a missing decision would create inaccurate calculations, violate licensing, expose secrets, or require irreversible production action.

Use feature flags or explicit `unavailable` states for production services that require credentials, licenses, or approved calculation conventions.

---

# 20. Definition of done

The implementation is complete only when:

- The source tree is directly reviewable in GitHub.
- A clean feature branch exists.
- The app installs successfully.
- The production web build succeeds.
- TypeScript strict checking succeeds.
- Unit tests succeed.
- Profile-engine tests succeed.
- The four tarot reading types work.
- Birthplace and birth time are optional.
- Birth time is accepted without birthplace or user-entered timezone.
- Time-sensitive features remain unavailable without validated context.
- The profile never affects card selection.
- The draw is locked before AI generation.
- AI failure preserves the same cards.
- A deterministic fallback works.
- Follow-up questions use the same reading.
- Reduced-motion and keyboard paths work.
- Raw birth data is not sent to analytics.
- Secrets are not committed.
- Database migrations and seed data are included.
- RLS or equivalent authorization is tested.
- Report-purchase test mode works.
- Known external production gates are documented.
- CI is configured and passing, or every unavailable check is explicitly documented.
- A draft pull request is opened against `main`.

Do not merge the pull request.

---

# 21. Draft pull request requirements

Open a draft PR with:

## Summary

What was implemented.

## Product flow

How onboarding, profile generation, tarot readings, follow-ups, and reports work.

## Architecture

Major applications, packages, services, and data flow.

## Security and privacy

How sensitive birth and reading information is handled.

## Testing

Every command executed and its result.

## Screenshots

Desktop and mobile screenshots for:

- onboarding
- reading selection
- shuffle/deal scene
- card reveal
- result
- report preview

## Known gaps

Licenses, credentials, calculation validation, content rights, deployment configuration, and any incomplete production integrations.

## Reviewer instructions

Exact local setup and test commands.

Do not mark the PR ready for review until the completion criteria have been met.
