# Personalized Tarot & Horoscope Web App

## Product Requirements Document

*Private cross-system birth profile + immersive tarot readings + purchasable deep profile report*

**Version 1.0 | Implementation-ready draft | July 22, 2026**

Prepared for Kevin

> **Markdown conversion note:** Converted from `Personalized_Tarot_Webapp_PRD_v1.0.docx` for repository use. The requirements and completion criteria are preserved; minor layout-only formatting was normalized for GitHub.

> **Core product decision**
>
> Birth name and date of birth are required. Birthplace and birth time are optional. A supplied birth time requires birthplace or equivalent timezone context. Missing data reduces profile detail but never blocks a tarot reading.

## Document control
| **Field** | **Value** |
| --- | --- |
| Product | Personalized Tarot & Horoscope Web App |
| Document | Product Requirements Document and completion criteria |
| Version / date | v1.0 / July 22, 2026 |
| Status | Implementation-ready draft; business, brand, legal, and domain-expert sign-off pending |
| Primary platforms | Responsive web application; mobile-first; desktop supported |
| Primary audience | Founder, product, design, engineering, content, QA, security/privacy, and operations |
| MVP definition | One deck, four reading types, private profile engine, AI synthesis, one follow-up, report purchase, history, and admin controls |

## Priority and completion model
| **Priority** | **Meaning** | **Release treatment** |
| --- | --- | --- |
| Must | Required for the defined MVP and launch-blocking unless formally waived. | All acceptance criteria must pass. |
| Should | Expected in MVP when feasible; may move behind a flag or to the immediate follow-on release. | Deferral requires owner, rationale, and target release. |
| Could | Designed for compatibility but not required for MVP launch. | No launch impact unless explicitly promoted. |

## Executive summary
The product delivers immersive tarot readings personalized by a private birth profile assembled from Western astrology (Whole Sign and Placidus), Pythagorean numerology, BaZi Four Pillars, and Dreamspell Galactic Signature. The profile is not displayed in the standard tarot experience; it is converted into a compact plain-language personality lens used to emphasize relevant card meanings. Users may later purchase a detailed profile report that reveals the underlying systems and cross-system synthesis.

The user experience remains simple on the surface: create an account, enter minimum birth details, select a reading, ask a question, experience the shuffle/deal/reveal sequence, and receive a structured interpretation. Behind that surface, calculations, random card selection, AI interpretation, privacy controls, content versioning, and payment fulfillment are separated so each can be tested and audited.

> **Non-negotiable architecture rule**
>
> AI is the narrator. Deterministic services calculate the profile; a secure draw engine selects and locks the cards; curated content defines tarot meanings. The model synthesizes those inputs but does not invent chart facts or choose cards.

## Product at a glance
- **Required profile inputs:** full birth name and date of birth.
- **Optional enhancement inputs:** birthplace and birth time; time requires place/timezone context.
- **Private personalization:** the base reading uses plain-language traits without showing placements, numbers, pillars, or signature labels.
- **Tarot integrity:** the profile affects interpretation, never card selection.
- **MVP readings:** 1-card Focus, 3-card Direction, 5-card Crossroads, and 7-card Deeper Outlook.
- **Immersive experience:** shuffle, optional cut, deal, user-controlled flips, progressive explanations, and final synthesis.
- **Primary monetized SKU:** a one-time Full Profile Report; reading entitlements remain configurable.
- **Recommended stack:** Next.js/TypeScript, Supabase/Postgres, isolated Python profile engine, Motion/XState, structured AI output, Stripe, and durable jobs.

# 1 Product strategy
*What the product is trying to achieve, who it serves, and how success will be judged.*

## 1.1 Vision
Create a simple, premium-feeling spiritual guidance product that gives users a meaningful tarot ritual and a personalized answer without exposing them to a complicated dashboard of metaphysical systems. The experience should feel emotionally resonant and game-like, while the underlying calculations and draw process remain disciplined, private, and reproducible.

## 1.2 User problem
- Generic automated tarot readings often feel interchangeable and do not reflect the user's patterns, context, or decision style.
- Astrology and related profile systems can be overwhelming when presented as dense charts and terminology.
- Many users want a guided ritual and a direct answer, but do not want an open-ended chatbot or an intimidating setup process.
- Birth time is frequently unknown; products that require it exclude users or quietly invent inaccurate defaults.
- Automated spiritual products can undermine trust when card selection, AI generation, pricing, and private data handling are opaque.

## 1.3 Value proposition
> **Product promise**
>
> A private birth profile helps the reading speak to how you tend to process choices, relationships, uncertainty, and change—while the tarot cards themselves remain a genuine random draw.

## 1.4 Product principles
| **Principle** | **Implication** |
| --- | --- |
| Simple surface, deep engine | Users see a short guided flow; complexity remains behind the scenes. |
| Ritual before result | Shuffle, deal, and reveal create anticipation and agency rather than acting as decorative loading screens. |
| Profile informs, never predetermines | Traits shape interpretation but do not select cards or guarantee outcomes. |
| Private by default | Birth data and questions are minimized, encrypted, and excluded from analytics and logs. |
| Specific without fatalism | Readings answer the question directly, identify conditions and leverage, and preserve uncertainty. |
| Version everything | Calculations, content, prompts, draws, reports, and policies remain reproducible. |
| Accessible immersion | Reduced motion, keyboard, screen reader, text zoom, and no-audio modes deliver the same meaning. |
| No fear-based monetization | Negative or ambiguous cards never trigger urgency, curses, or coercive upsells. |

## 1.5 Goals
- Deliver a first personalized tarot reading with minimal onboarding friction.
- Make the reading feel materially more tailored than a generic card-definition generator.
- Preserve the integrity and reproducibility of the random draw.
- Convert a portion of engaged users into purchasers of a detailed profile report.
- Establish a privacy-safe dataset for resonance, usefulness, and later outcome research.
- Create a foundation that can add decks, spreads, subscriptions, daily readings, and additional forecasting layers later without re-platforming.

## 1.6 Non-goals for MVP
- Daily transit horoscopes, synastry, relationship compatibility, or live transit forecasting.
- A marketplace for live human readers.
- A social feed, public profiles, public reading links, or community messaging.
- Native iOS or Android applications.
- Multiple deck storefronts or user-generated decks.
- Claims that tarot or profile systems provide scientifically validated diagnosis or guaranteed future prediction.
- Unlimited open-ended spiritual chat detached from a locked reading session.
- Full WebGL or game-engine implementation before 2.5D web animation proves insufficient.

## 1.7 Provisional success metrics
| **Category** | **Metric** | **Initial target / interpretation** |
| --- | --- | --- |
| Activation | Profile completion to first reading start | Measure by profile completeness; target set after prototype baseline. |
| Completion | Reading start to final result viewed | >= 80% for users who begin the shuffle. |
| Engagement | Card reveal completion | >= 90% of dealt cards revealed in completed sessions. |
| Value | Helpful or very helpful rating | >= 70% among users who submit feedback; not treated as predictive proof. |
| Retention | Return for another reading within 30 days | Track by acquisition cohort and first reading type. |
| Revenue | Full Profile Report conversion | Track from report preview, reading result CTA, and account page separately. |
| Trust | Refund, complaint, and unsafe-output rate | No unresolved critical safety incidents; trend downward after beta. |
| Reliability | Reading completion without manual support | >= 99% excluding user abandonment and provider-wide outages. |
| Unit economics | Average model and infrastructure cost per reading | Remain below configurable margin threshold by spread. |

# 2 Users and jobs to be done
*The product serves several belief levels without forcing one metaphysical worldview.*

## 2.1 Primary user profiles
| **Persona** | **Primary need** | **Behavior and design implications** |
| --- | --- | --- |
| The Curious Seeker | A low-friction answer to a current question. | May not identify as spiritual; needs clear language, fast setup, and no jargon. |
| The Ritual-Oriented User | An immersive reading that feels intentional and personal. | Values shuffle, reveal, symbolism, atmosphere, and the option to revisit readings. |
| The Decision Navigator | Perspective on a relationship, career, money, or life-direction decision. | Needs a direct answer, conditions, tradeoffs, and actionable leverage rather than vague affirmation. |
| The Profile Explorer | A deeper explanation of recurring traits and cross-system patterns. | Likely report purchaser; expects detail, provenance, and clear treatment of missing birth time. |

## 2.2 Core jobs
- **When I feel uncertain,** help me frame the situation and see a plausible direction without pretending the future is fixed.
- **When a generic reading feels shallow,** use my private profile to make the interpretation more relevant to how I tend to think and act.
- **When I do not know my birth time,** let me continue without making me feel that the reading is invalid.
- **When I want a deeper self-understanding,** offer a clear paid report that explains the systems behind my profile.
- **When I return later,** preserve my original cards and results so I can compare them with what happened.

## 2.3 Critical experience expectations
- The app feels like a guided ritual, not a form followed by a generic chat message.
- The answer is understandable without knowing tarot or astrology terminology.
- The user never wonders whether the profile secretly selected the cards.
- Optional missing information is handled gracefully, with no fake precision.
- The user can distinguish card meaning, personalized interpretation, likely trajectory, and personal agency.
- Purchasing the report feels like unlocking depth, not paying to resolve fear created by the reading.

# 3 Scope, decisions, and release boundaries
*Working decisions derived from the product concept; flagged items can be revised through change control.*

## 3.1 Decision log
| **ID** | **Decision** | **Status** |
| --- | --- | --- |
| DEC-001 | Birth name and date of birth are required for personalized readings. | Confirmed |
| DEC-002 | Birthplace and birth time are optional; a supplied time requires place/timezone context. | Confirmed |
| DEC-003 | The private profile is used for readings but is not displayed in the base experience. | Confirmed |
| DEC-004 | A detailed profile report is sold separately. | Confirmed |
| DEC-005 | Profile data affects interpretation, never card selection. | Recommended / launch-critical |
| DEC-006 | MVP begins with one original or properly licensed 78-card deck. | Recommended |
| DEC-007 | MVP includes four spreads and one follow-up question per completed reading. | Recommended |
| DEC-008 | MVP is a responsive web application; native apps are deferred. | Recommended |
| DEC-009 | The Full Profile Report is the required one-time paid SKU; reading pricing remains configurable. | Recommended |
| DEC-010 | MVP launches in English and is architected for localization. | Recommended |
| DEC-011 | Initial launch assumes adult users; final age policy requires legal/product sign-off. | Open sign-off |
| DEC-012 | Dreamspell terminology and artwork will be original or properly licensed. | Required |

## 3.2 MVP scope
| **Included** | **Deferred / future** |
| --- | --- |
| Account, consent, private birth profile, profile completeness | Guest personalized readings and anonymous profile storage |
| Western Whole Sign + Placidus, numerology, BaZi, Dreamspell | Additional astrology forecasting techniques and compatibility |
| One deck, four versioned spreads, upright/reversed | Deck marketplace, custom spreads, community decks |
| Secure random draw, shuffle/deal/reveal, results, one follow-up | Unlimited chat, live readers, multiplayer/social features |
| History, feedback, optional outcome check-in | Public sharing and social proof systems |
| Full Profile Report purchase, web report, PDF | Subscriptions, bundles, gifting, affiliate marketplace |
| Protected admin, content/prompt versioning, feature flags | Full enterprise CMS or no-code workflow builder |

## 3.3 Key dependencies
- Final brand, visual identity, product name, and voice guidelines.
- Original or licensed tarot card artwork, card backs, symbols, sound, and report graphics.
- Domain-expert approval of calculation conventions, interpretation rules, and reference cases.
- Commercial licensing review for astronomical calculation components and any third-party content.
- Payment account, refund policy, age policy, Terms, Privacy Notice, and spiritual-entertainment disclosure.
- Pricing, free-reading allowance, and report-regeneration policy.

# 4 End-to-end experience
*The user sees one coherent ritual; the system coordinates multiple deterministic and AI services behind it.*

## 4.1 Primary journey
| **Step** | **User experience** | **System behavior** |
| --- | --- | --- |
| 1 | Understands the product and chooses to begin. | Public page explains personalization, privacy, optional birth time, tarot randomness, and report offer. |
| 2 | Creates an account and accepts required terms. | Authentication and consent versions are persisted. |
| 3 | Enters birth name and birth date; optionally adds place/time. | Inputs are validated, encrypted, normalized, and sent to the profile service. |
| 4 | Sees a simple profile-ready state. | A versioned profile snapshot and compact reading lens are stored; hidden system details remain private. |
| 5 | Chooses a reading and types a question or selects General. | The question is classified for domain, horizon, and safety; entitlement is checked. |
| 6 | Begins the shuffle and optionally cuts the deck. | A durable reading session is created and the state machine advances. |
| 7 | Watches cards dealt and flips them intentionally. | The secure draw is locked; deterministic card meanings appear immediately; AI synthesis begins in parallel. |
| 8 | Receives a concise answer and can expand deeper sections. | Structured output is validated, safety-checked, stored, and rendered. |
| 9 | Asks one follow-up using the same reading. | The same draw and profile snapshot remain in context; no redraw occurs. |
| 10 | Saves/revisits the reading and may provide feedback. | The original output remains immutable; feedback is stored separately. |
| 11 | May purchase the Full Profile Report. | Checkout, webhook, entitlement, durable report job, web/PDF fulfillment, and history are coordinated. |

## 4.2 Screen inventory
| **Route / screen** | **Purpose** | **Primary completion state** |
| --- | --- | --- |
| / | Brand, product explanation, trust, reading preview, report offer | User starts account creation or explores pricing |
| /sign-in | Passwordless account access | Authenticated session |
| /onboarding | Consent and private birth profile | Profile snapshot ready |
| /readings | Reading catalog | Spread selected |
| /readings/{slug} | Reading details and question entry | Question classified and session created |
| /session/{id} | Shuffle, cut, deal, reveal, generation | All cards revealed and result ready |
| /reading/{id} | Layered result and follow-up | Reading reviewed/saved; optional feedback |
| /history | Saved readings and purchased reports | Artifact reopened or managed |
| /profile | Birth facts, completeness, privacy controls, report preview | Profile updated, deleted, or report purchase started |
| /report/{id} | Paid Full Profile Report | Web report viewed or PDF downloaded |
| /settings/privacy | Consent, export, deletion, notifications | Preference or privacy action completed |
| /admin | Content, configuration, health, support, audits | Approved operational action |

## 4.3 Profile completeness model
| **Level** | **Inputs** | **Available profile capabilities** | **Unavailable / uncertain** |
| --- | --- | --- | --- |
| Core | Birth name + date | Numerology, Dreamspell, date-stable Western factors, 3-pillar BaZi, compact trait lens | Ascendant, houses, BaZi hour pillar, time-sensitive placements |
| Location-enhanced | + birthplace | Historical timezone/location normalization and stronger date-boundary handling | Ascendant/houses/hour pillar remain unavailable |
| Approximate-time | + birthplace + time range | Stable factors across sampled interval; possible Ascendants/hour pillars recorded | Any changing factor is excluded from strong claims |
| Complete | + exact birthplace + time | Ascendant, angles, Whole Sign, Placidus, precise time-sensitive factors, BaZi hour pillar | Only calculation-system limitations |

> **User-facing wording**
>
> Use 'more detailed profile' or 'enhanced profile' rather than 'more accurate prediction.' The app can explain exactly which chart capabilities become available when time and place are known.

# 5 Functional requirements
*Numbered, testable requirements grouped by product capability.*

## 5.1 Account, consent, and identity
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **ACC-001** | Public visitors can view marketing pages, product explanations, pricing, and privacy information without an account. | **Must** | Public routes load without authentication and contain no personalized or private data. |
| **ACC-002** | An authenticated account is required before a user can create a private birth profile, save a reading, or purchase a report. | **Must** | Unauthenticated users are redirected to sign in; no birth data is persisted to an anonymous browser session. |
| **ACC-003** | MVP authentication supports secure email magic link or one-time code. | **Must** | New and returning users can sign in, sign out, recover access, and receive actionable error states. |
| **ACC-004** | Social sign-in is supported behind a feature flag. | **Should** | Google and/or Apple sign-in can be enabled without changing user or profile schemas. |
| **ACC-005** | The account display name is separate from the encrypted birth name used for numerology. | **Must** | Reading UI uses the display name; the birth name is never used as the public-facing account label. |
| **ACC-006** | Age eligibility, Terms, Privacy Notice, and spiritual-entertainment disclosure are accepted before profile creation. | **Must** | Consent versions and timestamps are stored; unchecked required consent blocks continuation. |
| **ACC-007** | Marketing consent is optional and independent from service consent. | **Must** | Users can complete onboarding without marketing consent and can change it later. |
| **ACC-008** | Account sessions are protected and revocable. | **Must** | Logout invalidates the active session; passwordless tokens expire; suspicious session events are logged without PII. |

**Epic completion criteria**

| **[ ]** A new user can authenticate, accept required consent, create a distinct display identity, and return later without support intervention. |
| --- |
| **[ ]** No private profile or birth data is stored before authentication and required consent. |
| **[ ]** Marketing consent is independent and reversible. |
| **[ ]** Automated authorization tests confirm that one user cannot access another user's account artifacts. |

## 5.2 Birth profile onboarding
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **PRO-001** | Full birth name and date of birth are the minimum required inputs for a personalized profile. | **Must** | The Continue action is disabled until both fields are valid and the privacy explanation has been acknowledged. |
| **PRO-002** | Birthplace is optional and is captured only at city/region/country granularity. | **Must** | The interface never asks for a street address; selected places resolve to normalized city, coordinates, country, and IANA timezone. |
| **PRO-003** | Birth time is optional and supports Exact, Approximate, and Unknown states. | **Must** | Users can proceed without a time; the selected confidence state is persisted and used by the calculation engine. |
| **PRO-004** | When a birth time is entered, birthplace becomes conditionally required. | **Must** | The form explains why location is needed and prevents profile completion until a place is supplied or the time is removed. |
| **PRO-005** | The system never invents a default birth time. | **Must** | Unknown times remain null; noon, midnight, sunrise, or inferred times are not stored as the user's birth time. |
| **PRO-006** | Approximate time is represented as an uncertainty interval rather than an exact midpoint. | **Should** | The engine receives a start/end range and only promotes traits that remain stable across the sampled interval. |
| **PRO-007** | The onboarding copy explains the benefit of optional details without implying guaranteed predictive accuracy. | **Must** | Copy states that time and place unlock a more detailed astrological profile, including houses and Ascendant where available. |
| **PRO-008** | Users see profile completeness status, not the hidden horoscope interpretation. | **Must** | The base experience may show Core, Location-Enhanced, Approximate-Time, or Complete; it does not expose placements, pillars, numbers, or signature details. |
| **PRO-009** | The hidden profile is used internally to personalize tarot language and emphasis. | **Must** | The reading service receives a compact trait lens, not the full raw calculation payload. |
| **PRO-010** | Base tarot readings do not reveal paid-report details. | **Must** | Generated readings may use plain-language traits but must not reveal raw natal placements, numerology values, BaZi pillars, or Galactic Signature labels. |
| **PRO-011** | Users can update optional birth data later. | **Must** | Saving changes creates a new profile snapshot; future readings use the new snapshot while historical readings retain the original snapshot reference. |
| **PRO-012** | Birth date input supports international users and prevents impossible or future dates. | **Must** | Validated dates are stored canonically; locale-specific display does not alter the underlying date. |
| **PRO-013** | Unicode birth names are preserved exactly as entered. | **Must** | Original input is encrypted and retained; normalization creates a separate derived value and never overwrites the original. |
| **PRO-014** | Pythagorean numerology handles non-Latin names transparently. | **Should** | Users can confirm or enter a Latin-letter rendering; the system records the transformation method and avoids silent arbitrary transliteration. |
| **PRO-015** | The user can review and correct supplied birth facts without viewing the hidden profile. | **Must** | Settings show birth name masked by default, date, place, and time status with edit and delete controls. |
| **PRO-016** | Profile calculation failures are recoverable. | **Must** | The user sees a clear retry state; no partial profile is silently marked complete; operations receives a traceable error event. |

**Epic completion criteria**

| **[ ]** Core onboarding completes successfully using only birth name and date of birth. |
| --- |
| **[ ]** Birthplace and birth time remain optional, while time entry conditionally requires location/timezone context. |
| **[ ]** Unknown or approximate time never becomes a fabricated exact time. |
| **[ ]** The user sees completeness and editable facts but not the hidden profile interpretation. |
| **[ ]** Updating profile facts creates a new snapshot and leaves historical readings unchanged. |
| **[ ]** Unicode and non-Latin name cases follow the approved numerology handling policy. |

## 5.3 Profile calculation and trait synthesis
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **CAL-001** | All profile calculations are deterministic, versioned, and independent of the language model. | **Must** | The same normalized inputs and engine version produce identical outputs; AI is never asked to calculate chart facts. |
| **CAL-002** | Western astrology calculates planetary longitudes, signs, major aspects, and chart angles where inputs permit. | **Must** | Outputs include source data, orb rules, calculation timestamp, and engine version. |
| **CAL-003** | Whole Sign and Placidus are calculated as two house-system views of the same natal chart. | **Must** | Both views use the same planetary positions and birth-time normalization; house output is marked unavailable when required inputs are missing. |
| **CAL-004** | Date-only Western astrology uses a 24-hour uncertainty model. | **Must** | Stable sign/aspect facts are retained; any placement that changes during the local birth date is tagged uncertain and excluded from strong personalization. |
| **CAL-005** | Approximate-time charts are sampled across the provided interval. | **Should** | Possible Ascendants, houses, and time-sensitive aspects are recorded; only stable observations enter the high-confidence trait lens. |
| **CAL-006** | Placidus calculation errors or polar-region fallbacks are explicit. | **Must** | The service records the failure/fallback state and never labels a fallback house system as Placidus. |
| **CAL-007** | Pythagorean numerology computes the approved core set. | **Must** | Life Path, Expression/Destiny, Soul Urge, Personality, Birthday, and agreed master-number rules match the approved reference set. |
| **CAL-008** | BaZi computes year, month, and day pillars without a birth time and adds the hour pillar when supported. | **Must** | Missing hour data is represented as unavailable, not guessed; conventions are stored with the result. |
| **CAL-009** | BaZi boundary conventions are configuration, not hidden assumptions. | **Must** | Li Chun/year boundary, solar-term month boundary, true-solar-time policy, timezone source, and day-boundary policy are versioned. |
| **CAL-010** | Dreamspell Galactic Signature computes the approved Kin, tone, seal, color, and related fields from the birth date. | **Must** | Reference dates match the approved decoder dataset and terminology is identified as Dreamspell in internal content metadata. |
| **CAL-011** | Each system emits structured observations into a shared trait ontology. | **Must** | Observations include trait, direction, strength, source system, source rule, confidence, and relevant life domains. |
| **CAL-012** | Cross-system agreement and contradiction are preserved. | **Must** | The synthesis layer records convergence and explicit tensions instead of averaging opposing traits into neutral text. |
| **CAL-013** | A compact reading lens is generated for each profile snapshot. | **Must** | The lens contains only approved plain-language strengths, tensions, communication style, decision style, and growth levers; it excludes direct identifiers. |
| **CAL-014** | Profile snapshots are immutable after use in a completed reading or report. | **Must** | Edits create a new snapshot ID; historical artifacts remain reproducible. |
| **CAL-015** | Calculation engines have golden-reference tests and boundary cases. | **Must** | Approved reference cases pass at 100%; DST, leap day, sign/house boundary, solar-term boundary, name normalization, and extreme-latitude cases are included. |
| **CAL-016** | Profile computation meets the latency budget. | **Must** | Cached recomputation completes in under 1 second at p95; uncached full computation completes in under 4 seconds at p95 under expected load. |

**Epic completion criteria**

| **[ ]** Each calculation system matches the approved golden reference set and boundary-case suite. |
| --- |
| **[ ]** Whole Sign/Placidus and BaZi hour-pillar availability follow the actual input capability matrix. |
| **[ ]** The same input and version produce identical profile outputs and reading lens. |
| **[ ]** The reading lens excludes direct identifiers and preserves cross-system contradictions. |
| **[ ]** Every reading and report references an immutable profile snapshot and calculation version. |

## 5.4 Reading catalog and question intake
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **RDG-001** | The reading catalog presents a small, understandable set of reading types. | **Must** | Each card shows title, purpose, card count, approximate experience length, and free/paid entitlement state. |
| **RDG-002** | MVP includes Single Card Focus, Three-Card Direction, Five-Card Crossroads, and Seven-Card Deeper Outlook. | **Must** | All four spreads are fully configured, content-complete, tested, and available through feature flags. |
| **RDG-003** | Spread definitions are data-driven and versioned. | **Must** | Card count, positions, labels, interpretive functions, reversals, animation preset, and result sections can change without rewriting the session engine. |
| **RDG-004** | Users may type a question or choose a general reading where the spread permits it. | **Must** | Question-required spreads block empty submission; general readings use an approved default intent. |
| **RDG-005** | Question input supports optional topic and time-horizon chips. | **Should** | Relationship, career, money, creativity, life direction, and general topics are available; predictive questions can select a bounded horizon. |
| **RDG-006** | Question input is length-limited and private. | **Must** | The UI enforces the configured limit, stores the question encrypted, and never places the raw text in analytics or URLs. |
| **RDG-007** | Questions are classified before the draw for domain, intent, time horizon, and safety risk. | **Must** | Classification is stored separately from the raw question and is used to select content and safety behavior. |
| **RDG-008** | The interface helps users ask actionable questions. | **Must** | Examples encourage user-centered, bounded questions and discourage unverifiable accusations about third parties. |
| **RDG-009** | Reading entitlements are configurable. | **Must** | Admin can set free allowances, prices, credits, or report-only monetization without changing reading code. |
| **RDG-010** | Starting a reading creates a durable session before animation begins. | **Must** | The session has a unique ID, profile snapshot, spread version, entitlement decision, and recoverable initial state. |

**Epic completion criteria**

| **[ ]** All four MVP spreads can be selected, started, and configured without hard-coded page logic. |
| --- |
| **[ ]** Questions are stored privately, classified before the draw, and bounded by clear input rules. |
| **[ ]** Unsafe or inappropriate question patterns are intercepted before immersive animation begins. |
| **[ ]** Entitlement configuration can change without altering spread or draw code. |

## 5.5 Tarot draw and session integrity
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **DRW-001** | Card selection uses a cryptographically secure random source and a tested shuffle algorithm. | **Must** | The draw implementation uses platform CSPRNG, produces no duplicates, and passes property tests for deck integrity. |
| **DRW-002** | The private profile never influences which cards are selected. | **Must** | Automated tests verify that the draw function accepts no profile traits, question meaning, or AI output as selection inputs. |
| **DRW-003** | The final draw is locked and persisted before AI interpretation begins. | **Must** | A reading cannot change cards after generation starts; retries reuse the exact same draw. |
| **DRW-004** | Card orientation is determined independently according to the spread configuration. | **Must** | Reversal enablement and orientation results are persisted with each dealt card. |
| **DRW-005** | The session records deck, card, spread, shuffle, and content versions. | **Must** | Every completed reading is reproducible from stored version references and draw records. |
| **DRW-006** | Redraw is explicit and creates a new reading session. | **Must** | The interface never silently replaces an unfavorable draw; a new draw consumes the appropriate entitlement and links to the prior session only as history. |
| **DRW-007** | Draw creation and payment-dependent consumption are idempotent. | **Must** | Repeated network requests cannot create multiple draws or consume multiple credits for one session. |
| **DRW-008** | Interrupted sessions can resume from the last durable state. | **Must** | Reloading during shuffle, deal, reveal, or generation restores the same cards and correct interaction state. |
| **DRW-009** | The user receives a concise trust explanation of the random draw. | **Should** | A visible help affordance states that profile data shapes interpretation, not card selection. |
| **DRW-010** | A provably fair seed-commitment mode is supported as a future feature flag. | **Could** | The data model can store seed commitment and reveal values without redesigning reading sessions. |

```text
reading_session
  -> entitlement_confirmed
  -> draw_locked
  -> shuffling
  -> dealing
  -> awaiting_reveal
  -> revealing
  -> synthesis_pending
  -> result_ready
  -> complete

error branches: generation_failed | session_expired | payment_required | safety_interruption
```

**Epic completion criteria**

| **[ ]** Draw tests prove that card selection has no profile or AI dependency and cannot contain duplicates. |
| --- |
| **[ ]** Cards, orientations, versions, and position assignments persist before interpretation starts. |
| **[ ]** Refresh, retry, and reconnect always restore the same draw and correct state. |
| **[ ]** A new draw is always a new session and never a silent replacement. |

## 5.6 Immersive reading experience
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **UX-001** | The reading journey is governed by an explicit state machine. | **Must** | Invalid state combinations are impossible; transitions cover preparation, shuffle, cut, deal, reveal, generation, result, retry, and resume. |
| **UX-002** | The shuffle sequence feels tactile and ritualized without delaying users unnecessarily. | **Must** | A default shuffle completes within the configured duration and provides immediate Skip control. |
| **UX-003** | Visual shuffling uses lightweight card shells rather than animating all 78 full card components. | **Must** | Mid-tier mobile devices maintain the minimum animation frame-rate target without memory spikes. |
| **UX-004** | An optional deck-cut interaction can be enabled per spread. | **Should** | The user can drag or tap to cut; skipping the cut does not affect correctness or accessibility. |
| **UX-005** | Cards are dealt into spread-specific positions with stable layout. | **Must** | No card overlaps, clips, or moves unexpectedly across supported viewport sizes and text zoom levels. |
| **UX-006** | Users intentionally reveal cards by tap, click, or keyboard. | **Must** | Each card has visible focus state, Enter/Space activation, screen-reader label, and locked double-trigger prevention. |
| **UX-007** | Each reveal immediately shows deterministic card information. | **Must** | Card name, position, orientation, and concise baseline meaning appear without waiting for the final AI synthesis. |
| **UX-008** | Final synthesis can generate while the user reveals cards. | **Must** | Background generation starts only after the draw is locked and never blocks card interaction. |
| **UX-009** | Reduced-motion and skip-animation modes provide the full experience. | **Must** | The system respects browser preferences, removes large transforms, and preserves all reading content and controls. |
| **UX-010** | Sound is optional, user-controlled, and off by default until explicit interaction. | **Must** | A persistent sound control exists; no audio autoplays on initial page load. |
| **UX-011** | The experience is mobile-first and touch-friendly. | **Must** | Primary controls meet target sizes; safe areas, orientation changes, and common mobile viewport issues are tested. |
| **UX-012** | The visual system is minimal, immersive, and content-led. | **Must** | Screens use a restrained component set, clear hierarchy, high contrast, and no distracting decorative motion during reading text. |
| **UX-013** | Loading and failure states preserve the ritual and the user's trust. | **Must** | The UI never shows a blank card, reshuffles on failure, or loses the question; retry language states that the same cards will be used. |
| **UX-014** | The application supports current desktop and mobile browsers. | **Must** | Critical flows pass on current and previous major versions of Chrome, Safari, Firefox, and Edge, including iOS Safari and Android Chrome. |

### Animation choreography
| **Stage** | **Default behavior** | **Accessible alternative** |
| --- | --- | --- |
| Prepare | Deck enters with subtle depth and ambient movement. | Static deck with immediate Begin control. |
| Shuffle | Short overhand/riffle-inspired 2.5D sequence using lightweight shells. | Progress indicator with no large transforms. |
| Cut | Optional drag/tap interaction where configured. | Skip or keyboard-select cut position. |
| Deal | Cards travel to spread positions in order. | Cards appear sequentially with focus management. |
| Reveal | User flips each card; baseline meaning appears. | Instant reveal with text announcement. |
| Synthesis | Subtle transition from table to reading result. | Immediate content view; no parallax or scale. |

**Epic completion criteria**

| **[ ]** All four spreads render correctly on supported mobile and desktop viewport/device matrices. |
| --- |
| **[ ]** Keyboard, screen reader, reduced-motion, skip, and no-audio modes deliver the complete reading. |
| **[ ]** Animation never changes the locked draw or blocks deterministic card content. |
| **[ ]** Performance and visual-regression thresholds pass on the defined representative devices. |

## 5.7 AI interpretation and safety
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **AI-001** | AI access is isolated behind a provider adapter. | **Must** | Business logic depends on an internal interface and can switch providers/models without changing reading domain code. |
| **AI-002** | The model receives calculated facts; it never computes astrology, numerology, BaZi, Dreamspell, or card selection. | **Must** | Prompt templates contain only approved structured profile observations, locked draw data, curated meanings, and the user question. |
| **AI-003** | The model receives only the minimum relevant profile lens. | **Must** | Raw birth name, exact birth details, account identifiers, and unrelated profile observations are excluded from the normal reading payload. |
| **AI-004** | Question relevance selects profile observations. | **Must** | Career questions prioritize work/decision traits; relationship questions prioritize communication/attachment traits; selection is deterministic and auditable. |
| **AI-005** | Interpretations are grounded in versioned tarot content. | **Must** | Every card-position interpretation includes retrieved upright/reversed meanings, position function, domain tags, and relevant combination rules. |
| **AI-006** | The model returns a strict structured response. | **Must** | Responses validate against the approved JSON schema; malformed output triggers controlled repair or fallback and is never rendered directly. |
| **AI-007** | The reading answers the user's question before expanding into detail. | **Must** | The result begins with a clear central answer/theme, followed by card-by-card reasoning, trajectory, user agency, and reflection. |
| **AI-008** | Future-oriented language is conditional, bounded, and non-deterministic. | **Must** | Output uses likely trajectory/under current conditions language and never guarantees dates, outcomes, pregnancy, death, guilt, infidelity, or financial returns. |
| **AI-009** | The base reading does not expose the hidden profile's raw system labels. | **Must** | Automated checks reject output containing restricted placements, numbers, pillars, Kin labels, or internal confidence scores unless the paid report context explicitly allows them. |
| **AI-010** | The model preserves card meaning while personalizing emphasis. | **Must** | Profile traits cannot reverse or replace the core meaning of a card/position without an explicit alternative interpretation. |
| **AI-011** | The result distinguishes central trajectory, alternate trajectory, and user leverage. | **Must** | Structured output contains all three when the spread supports prediction or decision guidance. |
| **AI-012** | Timing is expressed conservatively. | **Must** | Timing uses the user's selected horizon and broad near/mid/late ranges; exact dates require an explicit supported method and are disabled in MVP. |
| **AI-013** | High-stakes and crisis inputs follow a safety policy. | **Must** | Immediate-danger requests interrupt the tarot flow; medical/legal/financial questions are reframed toward reflection and professional support without deterministic advice. |
| **AI-014** | Third-party private facts are not asserted. | **Must** | Questions about cheating, secret motives, guilt, or diagnosis are reframed toward observable dynamics, communication, boundaries, and the user's choices. |
| **AI-015** | Generation failures have a deterministic fallback. | **Must** | The same locked cards display curated meanings and an actionable retry; the user never receives an empty paid result. |
| **AI-016** | Prompts, models, policies, and schemas are versioned. | **Must** | Each output stores prompt version, model identifier, content version, safety policy version, and response schema version. |
| **AI-017** | Token, latency, and cost budgets are enforced per spread. | **Must** | Maximum input/output sizes, timeout, retry count, and cost alert thresholds are configurable and monitored. |
| **AI-018** | A pre-release evaluation suite measures quality and safety. | **Must** | The approved eval set covers all spreads, domains, profile completeness levels, adversarial questions, and prohibited claims; launch thresholds are met. |

### Reading result contract
```json
{
  "title": "...",
  "directAnswer": "...",
  "centralTheme": "...",
  "cards": [{
    "positionId": "...",
    "cardId": "...",
    "orientation": "upright|reversed",
    "traditionalMeaning": "...",
    "personalizedMeaning": "...",
    "questionConnection": "..."
  }],
  "likelyTrajectory": {
    "summary": "...",
    "conditions": ["..."],
    "alternateTrajectory": "..."
  },
  "userAgency": ["..."],
  "reflectionQuestion": "...",
  "uncertainty": "...",
  "safetyFlags": []
}
```

**Epic completion criteria**

| **[ ]** Structured output validation succeeds at or above the approved threshold across the full evaluation suite. |
| --- |
| **[ ]** No test case asks the model to calculate charts, select cards, reveal restricted profile facts, or guarantee outcomes. |
| **[ ]** Critical high-stakes, crisis, third-party accusation, pregnancy, death, diagnosis, guilt, and financial-return cases follow the approved policy. |
| **[ ]** Fallback output provides a complete usable result from the same cards when the model is unavailable. |
| **[ ]** Every output is reproducible by version references and traceable to approved card/profile inputs. |

## 5.8 Results, follow-up, and longitudinal feedback
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **RES-001** | Results use layered disclosure rather than one long text wall. | **Must** | The first viewport shows title, concise answer, and card overview; deeper card meanings and profile-informed details are expandable. |
| **RES-002** | Every result contains a consistent core structure. | **Must** | Central theme, answer to question, card-by-card interpretation, likely trajectory, alternate path, user agency, reflection prompt, and uncertainty note are present where applicable. |
| **RES-003** | The reading preserves the draw visually. | **Must** | All cards, positions, and orientations shown in results match the persisted draw exactly. |
| **RES-004** | Completed readings are saved to history automatically. | **Must** | A user can reopen the original result; stored content is immutable apart from explicit annotation fields. |
| **RES-005** | Users receive one contextual follow-up question per reading in MVP. | **Must** | The follow-up uses the same cards, profile snapshot, question, and output; it cannot redraw or silently change the initial interpretation. |
| **RES-006** | Follow-up answers are structured and safety-checked. | **Must** | The answer references the existing reading, states uncertainty, and is stored as a child record of the reading session. |
| **RES-007** | Users can rate resonance and usefulness separately. | **Should** | Feedback captures at least resonance, helpfulness, and optional free text; it is never represented as proof of predictive accuracy. |
| **RES-008** | Future-event readings can request an outcome follow-up. | **Should** | The user can opt into a scheduled check-in tied to the stated horizon and can disable reminders at any time. |
| **RES-009** | Outcome feedback preserves the original prediction. | **Must** | The original reading remains unchanged; occurred/partial/did not occur/unclear and behavior-change fields are stored separately. |
| **RES-010** | Sharing is excluded from MVP unless explicitly enabled. | **Could** | No public link is created by default; any future share flow requires deliberate redaction and consent. |

**Epic completion criteria**

| **[ ]** A completed reading can be reopened with identical cards, positions, orientations, and original interpretation. |
| --- |
| **[ ]** One follow-up can be asked without redrawing or overwriting the original result. |
| **[ ]** Resonance, helpfulness, and later outcome data remain distinct metrics. |
| **[ ]** No public sharing artifact exists unless the feature is separately enabled and reviewed. |

## 5.9 Full Profile Report and payments
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **RPT-001** | The Full Profile Report is a distinct one-time purchasable product. | **Must** | A product/price configuration exists and purchase grants access to the report for the current profile snapshot. |
| **RPT-002** | A report preview explains included systems and missing-data limitations. | **Must** | The preview shows section titles and profile completeness without revealing the detailed paid interpretation. |
| **RPT-003** | The report is generated from deterministic calculations plus curated interpretation and AI synthesis. | **Must** | Every report statement is traceable to profile facts/rules or clearly labeled synthesis; AI does not invent chart placements. |
| **RPT-004** | Report sections adapt to missing birth time or birthplace. | **Must** | Unavailable Ascendant, houses, or hour pillar sections are omitted or marked unavailable with a plain explanation; no placeholders are fabricated. |
| **RPT-005** | The report covers the agreed systems and cross-system synthesis. | **Must** | Overview, motivations, relationships, communication, decisions, strengths, tensions, growth, Western astrology, numerology, BaZi, Dreamspell, convergence, contradictions, and reflection sections are present as supported. |
| **RPT-006** | The report is stored as structured content and rendered to web and PDF. | **Must** | Web and PDF derive from the same report JSON and pass content parity checks; the PDF is accessible and printable. |
| **RPT-007** | A purchased report remains tied to its immutable profile snapshot. | **Must** | Updating birth data creates a new profile version without overwriting the purchased report. |
| **RPT-008** | Checkout uses a hosted, secure payment flow. | **Must** | Successful, canceled, failed, and abandoned states return the user to an appropriate screen without exposing payment details to the app. |
| **RPT-009** | Payment webhooks are verified and idempotent. | **Must** | Invalid signatures are rejected; duplicate events do not duplicate orders, entitlements, or report jobs. |
| **RPT-010** | Report generation runs as a durable background job. | **Must** | The job can retry safely, exposes status, and never creates duplicate reports for one paid entitlement. |
| **RPT-011** | Users receive clear fulfillment status and access. | **Must** | The purchase screen shows Preparing, Ready, or Needs Attention; ready reports are accessible from account history and optional email notification. |
| **RPT-012** | Receipts, refunds, and entitlement changes are reconciled. | **Must** | Refunded/charged-back orders update access according to the approved policy and are auditable. |
| **RPT-013** | Report language avoids presenting spiritual systems as clinically validated personality assessment. | **Must** | The report uses reflective/spiritual framing, explains uncertainty, and avoids medical or diagnostic claims. |
| **RPT-014** | Report regeneration policy is configurable. | **Should** | Operations can grant a manual regeneration or revised-report entitlement without database edits. |

**Epic completion criteria**

| **[ ]** A test customer can purchase, receive, open, and download a report without manual database intervention. |
| --- |
| **[ ]** Duplicate, delayed, failed, refunded, and replayed webhook cases produce correct order and entitlement states. |
| **[ ]** Report content reflects missing data honestly and contains no fabricated time-dependent details. |
| **[ ]** Web and PDF outputs match the same structured source and pass accessibility/content-parity review. |
| **[ ]** The report is preserved by profile snapshot and remains available from history under the approved entitlement policy. |

## 5.10 Administration and content operations
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **ADM-001** | Admin access is role-based and separated from normal user access. | **Must** | Only approved roles can access admin routes; every sensitive action is logged. |
| **ADM-002** | Core tarot content is versioned and publishable. | **Must** | Draft and published versions exist for decks, cards, meanings, spreads, and interpretation rules; completed readings retain old versions. |
| **ADM-003** | Prompts and AI policies can be versioned and rolled back. | **Must** | Admins can activate a prior approved prompt/policy version without redeploying application code. |
| **ADM-004** | Products, prices, free allowances, and entitlement rules are configurable. | **Must** | Operations can change commercial configuration without changing reading-domain code. |
| **ADM-005** | Feature flags control systems, spreads, animation variants, models, and payment features. | **Must** | Flags can be changed by environment and support safe rollback. |
| **ADM-006** | Operational dashboards show session, profile, AI, job, and payment health. | **Must** | Admins can locate a record by non-sensitive ID and view status, version, errors, and retry controls. |
| **ADM-007** | Support views mask sensitive birth and question data by default. | **Must** | Just-in-time privileged access requires a reason and creates an audit event; raw data is never visible to analytics-only roles. |
| **ADM-008** | Content and configuration changes require approval in production. | **Should** | At least one reviewer approves publish actions for card meanings, safety policies, and paid report templates. |
| **ADM-009** | Administrators can disable a spread or model instantly. | **Must** | A kill switch removes the item from new sessions while preserving existing sessions and history. |
| **ADM-010** | Admin actions are covered by recovery procedures. | **Must** | Mistaken publication, pricing, entitlement, and prompt changes can be rolled back and audited. |

**Epic completion criteria**

| **[ ]** Authorized staff can publish and roll back content, prompts, spread configuration, product configuration, and feature flags. |
| --- |
| **[ ]** Support can diagnose a failed reading/report using non-sensitive IDs and masked views. |
| **[ ]** Every production-changing admin action is attributable and auditable. |
| **[ ]** Kill switches can prevent new sessions without corrupting existing sessions or history. |

# 6 Content and interpretation model
*The product's differentiation depends on structured, attributable content rather than unbounded generated prose.*

## 6.1 Tarot card content schema
| **Field group** | **Required content** |
| --- | --- |
| Identity | Card ID, name, Arcana, suit/rank, deck/version, image asset, card-back asset, alt text |
| Core meaning | Upright keywords, reversed keywords, archetype, narrative, shadow, agency, caution |
| Domain meaning | Relationship, career, money, creativity, life direction, and general interpretations |
| Event ontology | Initiation, message, invitation, decision, delay, conflict, agreement, return, ending, recognition, completion, and other approved tags |
| Position behavior | How the meaning changes in situation, obstacle, hidden influence, advice, path, outcome, timing, and leverage positions |
| Combination rules | Reinforcement, contradiction, repeated suits/numbers, Major density, court-card behavior, and selected high-value pairings |
| Safety | Literal-death exclusion, medical/legal/financial cautions, third-party fact restrictions, and sensitive phrasing |
| Provenance | Source lineage, author/editor, review status, effective version, localization status |

## 6.2 MVP spread definitions
| **Reading** | **Positions** | **Use case** | **Result depth** |
| --- | --- | --- | --- |
| Single Card - Focus | Current focus | Daily/general orientation or one concise question | Concise answer + one card + agency |
| Three Cards - Direction | Situation; Challenge; Direction | General questions and short-horizon decisions | Direct answer + three cards + trajectory |
| Five Cards - Crossroads | Current path; Hidden influence; Path A; Path B; Leverage | Choice between options or competing approaches | Comparison + conditions + recommendation |
| Seven Cards - Deeper Outlook | Foundation; Present; Incoming influence; Obstacle; External factor; Leverage; Likely outcome | Complex situation and bounded future outlook | Full synthesis + alternate trajectory |

## 6.3 Shared personality trait ontology
| **Domain** | **Examples of internal trait dimensions** |
| --- | --- |
| Motivation | achievement, security, autonomy, belonging, meaning, exploration |
| Emotional processing | immediate vs delayed processing, sensitivity, containment, reassurance needs |
| Communication | directness, diplomacy, analysis, emotional expression, conflict avoidance |
| Decision style | speed, evidence preference, intuition, risk tolerance, certainty seeking |
| Relationships | independence, intimacy, reciprocity, boundaries, loyalty, novelty |
| Work and creation | structure, leadership, collaboration, craft, experimentation, persistence |
| Change response | adaptability, control, caution, impulsivity, recovery, reinvention |
| Growth leverage | deadlines, boundaries, reframing, communication, experimentation, rest, support |

## 6.4 Source hierarchy
1. Deterministic calculation facts and explicit user inputs.
2. Approved system-specific interpretation rules and authored profile observations.
3. Approved tarot card, domain, position, and combination content.
4. Cross-system trait convergence/tension rules.
5. AI synthesis constrained by the structured inputs above.
6. User feedback and later outcomes, retained as research signals rather than automatic truth updates.

> **Collective interpretation safeguard**
>
> Human-authored tradition, professional interpretation, user feedback, user-reported outcome, and AI-generated text must remain separate data classes. AI output must never count as an independent community vote.

# 7 Technical architecture
*A modular monolith keeps delivery fast while an isolated calculation service contains native ephemeris and calendar complexity.*

## 7.1 Recommended stack
| **Layer** | **Recommendation** | **Role** |
| --- | --- | --- |
| Web | Next.js App Router + React + TypeScript | Routes, server actions/API, authenticated product, result rendering |
| Design | Tailwind CSS + accessible component primitives | Tokens, layout, forms, responsive UI |
| Animation | Motion for React + CSS 3D | Shuffle, deal, flip, presence, progressive transitions |
| Workflow | XState | Reading state machine, retries, resume, invalid-state prevention |
| Data | Supabase Postgres + Row-Level Security | Users, profiles, readings, content, reports, entitlements |
| Auth/storage | Supabase Auth + Storage | Passwordless identity and protected report/assets |
| Schema | Drizzle ORM + SQL migrations | Typed data access and versioned migrations |
| Profile engine | Dockerized FastAPI/Python service | Western astrology, numerology, BaZi, Dreamspell, trait synthesis |
| Astronomy | Commercially approved ephemeris implementation | Planetary positions, angles, and houses |
| AI | Provider adapter + structured output | Question classification, reading synthesis, report synthesis |
| Jobs | Trigger.dev or equivalent durable job runner | Report generation, retries, email, follow-up scheduling, deletion |
| Payments | Stripe Checkout/Billing APIs | One-time report purchase and future entitlements |
| Observability | Sentry + privacy-safe logs/metrics | Errors, traces, release health |
| Analytics | PostHog or equivalent | Funnel, retention, experiments without raw PII |
| Testing | Vitest + Playwright + Storybook visual tests | Unit, integration, end-to-end, accessibility, visual regression |
| Hosting | Vercel + Supabase + container host | Web edge/server, database, and profile service |

## 7.2 Logical architecture
```text
[Next.js Web App]
  onboarding | reading scene | results | history | report | admin
                              |
                              v
[Application Services]
  profile orchestrator | reading orchestrator | entitlement | safety
             |                     |                      |
             v                     v                      v
[Profile Engine]       [Postgres/Auth/Storage]    [AI Provider Adapter]
  astrology              profiles/readings          structured readings
  numerology              content/reports            structured reports
  BaZi                    payments/feedback          moderation/classification
  Dreamspell
                              |
                              v
[Durable Jobs + Payments + Email + Observability]
```

## 7.3 Service boundaries
| **Boundary** | **Owns** | **Must not own** |
| --- | --- | --- |
| Web application | UX, auth orchestration, session state, API boundary, entitlement checks, rendering | Astronomical/calendar calculations or direct card meaning invention |
| Profile engine | Normalized calculations, uncertainty, trait observations, snapshot payload | User-facing prose, payment, card selection |
| Tarot domain | Deck/spread content, secure draw, position assignment, deterministic baseline | Birth calculations or AI provider concerns |
| AI adapter | Schema-constrained synthesis, classification, safety integration | Persistent source of truth for calculations, draws, or entitlements |
| Job system | Durable report, email, outcome check-in, deletion, retry workflows | Interactive reading state or unbounded data access |
| Payment provider | Payment instrument and transaction processing | Birth data, questions, tarot content |

## 7.4 Key API contracts
| **Endpoint / action** | **Input** | **Output / guarantee** |
| --- | --- | --- |
| POST /profile/compute | Normalized encrypted-source reference + optional place/time capability | Versioned profile snapshot; deterministic and idempotent |
| POST /readings | User, profile snapshot, spread, question classification, entitlement | Durable session before animation |
| POST /readings/{id}/draw | Session ID + deck/spread versions | Locked draw; idempotent; no profile input |
| POST /readings/{id}/generate | Locked draw + curated meanings + compact lens + question | Validated structured result or deterministic fallback |
| POST /readings/{id}/follow-up | Original context + one follow-up question | Child structured response; no redraw |
| POST /checkout/report | User + profile snapshot + product | Hosted checkout session |
| POST /webhooks/payment | Signed provider event | Idempotent order, entitlement, and job transition |
| POST /reports/{id}/generate | Paid entitlement + profile snapshot | Durable structured report and export status |
| DELETE /profile or /account | Authenticated deletion request | Immediate access revocation + durable deletion workflow |

## 7.5 Core data entities
| **Domain** | **Primary entities** |
| --- | --- |
| Identity and consent | users, user_settings, consents, sessions |
| Birth and profile | birth_profiles, normalized_places, profile_snapshots, profile_components, profile_traits, reading_lenses |
| Tarot content | decks, deck_versions, cards, card_meanings, meaning_sources, spreads, spread_positions, spread_versions |
| Readings | reading_sessions, reading_draws, reading_outputs, reading_questions, followups |
| Commerce | products, prices, orders, payment_events, entitlements |
| Reports | reports, report_sections, report_exports, report_jobs |
| Learning | reading_feedback, outcome_followups, user_annotations |
| Governance | calculation_versions, prompt_versions, policy_versions, feature_flags, audit_events |

## 7.6 Versioning and reproducibility
- A completed reading stores profile snapshot, calculation version, deck version, spread version, card-content version, draw algorithm version, prompt version, model identifier, policy version, and output schema version.
- A completed report stores the same profile/calculation references plus report template, source-content, prompt, model, and export versions.
- Published content is immutable; edits create a new version with an effective date.
- Retries reuse the original session artifacts and idempotency keys.
- Historical artifacts are never silently regenerated after a content, prompt, model, or profile change.

# 8 Privacy, security, trust, and safety
*Birth details and private questions are sensitive even when they are not legally classified as special-category data.*

## 8.1 Security requirements
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **SEC-001** | Raw birth data and private questions receive application-level encryption in addition to platform encryption. | **Must** | Keys are managed outside the database; plaintext values are unavailable in backups, logs, and analytics. |
| **SEC-002** | Authorization is enforced at the database layer. | **Must** | Row-level policies prevent cross-user access to profiles, readings, reports, feedback, and entitlements; tests attempt unauthorized access. |
| **SEC-003** | AI requests are pseudonymized and use the provider's no-retention/no-training controls where available. | **Must** | Payloads exclude direct identifiers and configuration is verified in production before launch. |
| **SEC-004** | No raw PII or question text is sent to product analytics, error tracking, or log aggregation. | **Must** | Automated redaction tests and production sampling confirm compliance. |
| **SEC-005** | Secrets, API keys, encryption keys, and payment credentials use managed secret storage. | **Must** | No production secret exists in source control, client bundles, or user-visible responses. |
| **SEC-006** | Rate limits and abuse controls protect authentication, profile calculation, draw, AI, report, and webhook endpoints. | **Must** | Configured limits return safe errors, preserve paid sessions, and create abuse signals without exposing implementation details. |
| **SEC-007** | Users can delete individual readings, their profile, or their account. | **Must** | Access is revoked immediately; deletion jobs follow the approved retention schedule and provide completion status. |
| **SEC-008** | Users can export their personal data in a readable format. | **Should** | Export includes profile inputs, reading history, reports, consent history, and feedback, excluding protected internal prompts and security logs. |
| **SEC-009** | Data retention is documented by data class. | **Must** | Raw birth data, questions, derived profiles, readings, transactions, logs, and backups each have an owner, purpose, and retention rule. |
| **SEC-010** | Payment data does not transit or persist through application servers beyond provider tokens and metadata. | **Must** | No card number, security code, or bank credential is stored in the application database. |
| **SEC-011** | Backups, restore, and disaster recovery are tested. | **Must** | A documented restore exercise proves recovery of profiles, readings, entitlements, and version references without data mixing. |
| **SEC-012** | Security review covers common web risks and third-party dependencies. | **Must** | Automated scanning, dependency review, authorization testing, webhook testing, and a manual threat-model review have no unresolved critical findings. |
| **SEC-013** | Safety responses do not use negative readings to pressure purchases. | **Must** | No flow ties fear, curses, danger, or urgent spiritual remediation to an upsell. |
| **SEC-014** | Localized crisis-resource configuration can be maintained without code changes. | **Should** | Operations can update region-appropriate support content and emergency messaging. |

## 8.2 Data classification
| **Class** | **Examples** | **Required handling** |
| --- | --- | --- |
| Direct identifiers | Email, display name, encrypted birth name | Strict access, encryption, no analytics/logs, deletion/export |
| Sensitive personal context | Birth date/time/place, questions, notes | Application encryption, minimum retention, masked support access |
| Derived private profile | Placements, numerology, pillars, Kin, trait lens | User-scoped access; minimized AI payload; versioned |
| Reading artifacts | Draw, interpretation, follow-up, feedback | User-scoped; immutable original; delete controls |
| Commercial records | Order ID, product, status, provider customer ID | No payment instrument; retention per approved finance policy |
| Operational telemetry | Status codes, latency, model cost, trace IDs | No raw PII/question/report content |

## 8.3 Safety decision matrix
| **Input type** | **Product behavior** | **Prohibited behavior** |
| --- | --- | --- |
| Ordinary reflective question | Proceed with spread and conditional interpretation. | Guaranteeing outcome or presenting profile as diagnosis. |
| Medical, legal, or financial decision | Reframe toward questions, preparation, and professional support; add context-specific note. | Diagnosis, legal verdict, investment return, or instruction to ignore professionals. |
| Pregnancy, death, crime, guilt | Do not predict; redirect toward wellbeing, evidence, communication, and practical support. | Literal card-based prediction or accusation. |
| Third-party secrets or infidelity | Focus on observable dynamics, boundaries, and user agency. | Claiming private facts about another person. |
| Immediate danger or self-harm | Interrupt the tarot flow and show approved supportive/crisis guidance. | Continuing a dramatic reading or using the situation for monetization. |
| Compulsive repeat reading | Show prior reading, introduce cooldown/friction, and encourage reflection. | Unlimited clarifiers or repeated paid draws driven by anxiety. |

**Privacy and safety release gate**

| **[ ]** Threat model, authorization tests, encryption design, key management, retention schedule, and incident procedure are approved before production launch. |
| --- |
| **[ ]** Production telemetry sampling finds no raw birth data, user question, or report prose in analytics, error tracking, or logs. |
| **[ ]** Safety evaluation passes all launch-blocking scenarios with no critical prohibited claim. |
| **[ ]** Account/profile/reading deletion, data export, and payment-data separation are verified end to end. |
| **[ ]** No content or commerce flow uses fear, curses, danger, or urgent spiritual remediation to drive payment. |

# 9 Non-functional requirements and analytics
*Performance, accessibility, reliability, observability, and measurement are part of the product—not post-launch cleanup.*

## 9.1 Non-functional requirements
| **ID** | **Requirement** | **Priority** | **Acceptance / completion criteria** |
| --- | --- | --- | --- |
| **NFR-001** | Public and authenticated core pages meet modern web performance targets. | **Must** | At p75 on representative mobile traffic: LCP <= 2.5s, INP <= 200ms, and CLS <= 0.10 for landing, catalog, onboarding, and result entry. |
| **NFR-002** | Card animation remains responsive on representative mid-tier mobile devices. | **Must** | Primary shuffle/deal/reveal sequences target 60 fps and do not remain below 30 fps for sustained periods. |
| **NFR-003** | Initial deterministic card content appears immediately after reveal. | **Must** | The reveal interaction does not depend on AI latency and responds within 150ms after the animation trigger on target devices. |
| **NFR-004** | Full reading synthesis meets the latency budget. | **Must** | Standard readings complete within 15 seconds at p95 under expected load; longer reports expose durable status rather than a blocking spinner. |
| **NFR-005** | Service availability and error budgets are defined. | **Must** | MVP target is at least 99.5% monthly availability for authenticated reading flows, excluding planned maintenance. |
| **NFR-006** | The application meets WCAG 2.2 AA for critical flows. | **Must** | Automated and manual audits find no critical violations; keyboard, screen reader, contrast, text zoom, and reduced motion are verified. |
| **NFR-007** | The system is observable end to end. | **Must** | Trace IDs connect web requests, profile calculations, draws, AI generation, jobs, and payment events without logging private content. |
| **NFR-008** | Production alerts cover user-impacting failures. | **Must** | Alerts exist for elevated auth, profile, AI, payment, job, and database errors, plus unusual latency and cost. |
| **NFR-009** | Analytics measures the funnel without collecting sensitive content. | **Must** | Events use IDs, categories, lengths, and status values; they never include birth fields, raw questions, card notes, or report prose. |
| **NFR-010** | The content and UI architecture is localization-ready. | **Should** | User-facing strings are externalized; dates, times, currency, and place formats are locale-aware even though MVP language is English. |
| **NFR-011** | Automated tests protect critical domain behavior. | **Must** | Core calculation, shuffle, state machine, authorization, payment, and output-schema modules meet the agreed coverage threshold and all critical paths have end-to-end tests. |
| **NFR-012** | Releases support controlled rollout and rollback. | **Must** | Database migrations are reversible or forward-fixable; feature flags and previous content/prompt versions support rapid rollback. |

## 9.2 Core analytics events
| **Stage** | **Events** | **Allowed properties** |
| --- | --- | --- |
| Acquisition | landing_view, pricing_view, signup_started | campaign, referrer class, device class, locale |
| Onboarding | consent_completed, profile_started, profile_completed | completeness level, optional-field presence, duration, error code |
| Reading | reading_selected, question_submitted, shuffle_started, draw_locked, card_revealed, result_viewed | spread ID/version, domain category, horizon class, card count, status, latency |
| Engagement | followup_submitted, feedback_submitted, reading_reopened | rating bands, reading age, follow-up status; no raw text |
| Commerce | report_previewed, checkout_started, purchase_completed, report_ready, report_viewed | product, price ID, currency, status, attribution |
| Reliability | profile_failed, generation_failed, fallback_used, payment_failed, job_retried | error class, provider, model/version, trace ID, latency |
| Outcome research | outcome_invited, outcome_submitted | occurred/partial/no/unclear, behavior-change flag, horizon class |

## 9.3 Experimentation rules
- Experiments may change onboarding copy, report preview, animation pacing, layout, and result disclosure hierarchy.
- Experiments may not secretly change draw randomness, safety thresholds, entitlement charges, or the visibility of private profile facts.
- AI prompt/model experiments require offline evaluation before production exposure and must preserve the output schema.
- Every experiment has a primary metric, guardrail metrics, stop conditions, and a maximum exposure window.
- Feedback resonance is never used alone to claim improved predictive validity.

**Non-functional release gate**

| **[ ]** Performance, accessibility, reliability, and observability thresholds pass in a production-like environment. |
| --- |
| **[ ]** Analytics events fire once with approved properties and no sensitive content. |
| **[ ]** Operational dashboards and alerts have named owners and tested response paths. |
| **[ ]** Feature flags and rollback mechanisms are verified during a release rehearsal. |

# 10 Quality assurance and evaluation plan
*The system must prove correctness across calculations, draw integrity, state recovery, AI behavior, commerce, privacy, and accessibility.*

## 10.1 Test layers
| **Layer** | **Coverage** | **Launch evidence** |
| --- | --- | --- |
| Unit | Calculation rules, normalization, trait mapping, shuffle, state transitions, schema validation, entitlement logic | Passing CI suite and agreed critical-module coverage |
| Golden reference | Western astrology, numerology, BaZi, Dreamspell | 100% match to approved reference dataset |
| Property/fuzz | Shuffle uniqueness, idempotency, date/name inputs, state-machine transitions | No invariant violation across configured run count |
| Integration | Web-to-profile service, DB/RLS, AI adapter, jobs, storage, payment webhooks | Passing environment-level suite |
| End to end | New user, core/complete profile, each spread, resume, retry, follow-up, purchase, report, deletion | Passing supported-browser matrix |
| AI evaluation | Grounding, directness, personalization, prohibited claims, restricted profile leakage, schema, fallback | Threshold report signed by product/domain/safety owners |
| Visual/performance | Responsive layouts, card choreography, reduced motion, PDF, Core Web Vitals | Approved visual baselines and device results |
| Accessibility | Keyboard, screen reader, contrast, focus, labels, text zoom, motion, PDF structure | WCAG 2.2 AA audit with no critical issues |
| Security/privacy | Authorization, encryption, secret handling, logs, deletion/export, rate limits, webhooks | Threat-model checklist and no unresolved critical findings |
| User acceptance | Comprehension, trust, ritual quality, report value | Structured beta feedback and signed launch recommendation |

## 10.2 Minimum reference and evaluation datasets
| **Dataset** | **Minimum target** | **Coverage** |
| --- | --- | --- |
| Western astrology | 100 approved charts | DST, historical timezone, sign/house boundaries, high latitude, unknown/approximate time |
| Numerology | 60 approved names/dates | Master numbers, punctuation, diacritics, suffixes, non-Latin handling |
| BaZi | 100 approved cases | Li Chun, solar terms, midnight/23:00 boundary, timezone and solar-time policy |
| Dreamspell | 60 approved dates | Known Kin/tone/seal mappings across centuries and leap dates |
| AI reading eval | At least 300 cases | Four spreads x six domains x completeness levels x safety/adversarial cases |
| Report eval | At least 40 profiles | Core, location-only, approximate, complete, contradictions, non-Latin names |
| Device/browser | At least 10 representative configurations | iOS/Android mid-tier, desktop browsers, reduced motion, text zoom |

## 10.3 AI quality rubric
| **Dimension** | **Pass definition** |
| --- | --- |
| Grounding | Every material interpretation is supported by card/position content or an approved profile observation. |
| Relevance | The answer responds to the user's actual question and selected horizon rather than delivering generic advice. |
| Personalization | Trait influence is noticeable and appropriate without exposing restricted system details. |
| Tarot fidelity | Cards retain their approved semantic range; profile data cannot force an unrelated narrative. |
| Agency | The user receives concrete leverage, conditions, and an alternate path—not only fate-oriented language. |
| Uncertainty | Future statements remain conditional and avoid false precision. |
| Safety | No prohibited diagnosis, prediction, accusation, guarantee, fear-based upsell, or crisis mishandling. |
| Style | Warm, direct, readable, immersive, non-repetitive, and layered for mobile reading. |
| Schema | The response validates without manual repair; all required sections and card IDs match the draw. |

**QA completion gate**

| **[ ]** All Must requirements have a passing test or documented manual acceptance record. |
| --- |
| **[ ]** All four spreads pass complete end-to-end journeys for Core and Complete profiles. |
| **[ ]** Calculation reference datasets pass at 100%; no unresolved boundary discrepancy remains hidden. |
| **[ ]** AI and safety thresholds are approved by product, tarot/profile content, and safety owners. |
| **[ ]** No Sev-1 or Sev-2 defect remains open; any waived lower-severity defect has an owner and target release. |

# 11 Delivery plan and milestone exit criteria
*Milestones are defined by demonstrable outcomes rather than calendar estimates.*

| **Milestone** | **Scope** | **Exit criteria** |
| --- | --- | --- |
| M0 - Product and content foundation | Final flows, terminology, spreads, profile ontology, safety policy, report outline, licensing plan | Decision log approved; no unresolved architecture-blocking question; content work can start. |
| M1 - Experience prototype | Clickable onboarding, catalog, shuffle/deal/reveal, result hierarchy, report preview | Founder/user testing confirms comprehension, ritual quality, mobile usability, and optional-time flow. |
| M2 - Platform foundation | Auth, consent, DB/RLS, encrypted birth storage, design system, feature flags, telemetry | Security baseline and core account/profile skeleton pass integration tests. |
| M3 - Profile engine certified | All five systems, uncertainty, trait synthesis, snapshots, golden tests | Reference datasets pass; domain expert approves conventions and missing-data behavior. |
| M4 - Tarot session complete | Deck content, spreads, secure draw, state machine, immersive UI, deterministic meanings | Each spread completes and resumes correctly without AI. |
| M5 - AI reading quality | Classification, relevance selection, structured synthesis, safety, fallback, evaluation | AI launch thresholds pass; restricted profile leakage and prohibited claims are zero in critical evals. |
| M6 - Commerce and report | Checkout, webhook, entitlement, durable report, web/PDF, history, refund behavior | Test purchase through fulfillment and failure/replay scenarios pass. |
| M7 - Closed beta | Production-like deployment, analytics, support, operations, feedback, privacy workflows | Beta metrics reviewed; critical issues resolved; launch checklist is materially complete. |
| M8 - General availability | Controlled rollout, monitoring, legal/commercial sign-off, incident readiness | Definition of Done below is signed by accountable owners. |

## 11.1 Recommended team responsibilities
| **Capability** | **Accountability** |
| --- | --- |
| Product/founder | Vision, priority, monetization, acceptance, risk decisions, launch go/no-go |
| Product design | Information architecture, interaction, visual system, motion, accessibility, user testing |
| Full-stack engineering | Web app, API, auth, DB, reading domain, history, admin, observability |
| Profile-engine engineering | Calculation services, uncertainty, versioning, reference tests, performance |
| AI/content engineering | Content schemas, retrieval, prompts, structured output, evals, fallback |
| Domain experts | Tarot, Western astrology, numerology, BaZi, Dreamspell conventions and review |
| Illustration/motion/sound | Original deck, card back, symbols, animation assets, optional audio |
| QA/security/privacy | Test strategy, threat model, compliance workflow, launch gates |
| Operations/support | Content publishing, payment/report exceptions, customer support, incident response |

# 12 MVP completion criteria and Definition of Done
*The release is complete only when the product, content, engineering, safety, and operational system all work together.*

## 12.1 Launch-blocking completion checklist
**Release checklist**

| **[ ]** All Must requirements in this PRD pass their acceptance criteria or have a written founder/product waiver with risk owner and remediation date. |
| --- |
| **[ ]** New users can authenticate, consent, create a Core profile with only birth name/date, and complete every MVP reading. |
| **[ ]** Users can optionally add birthplace/time, and the correct capability level is applied without invented precision. |
| **[ ]** Western astrology, numerology, BaZi, and Dreamspell reference suites pass at 100% against approved sources. |
| **[ ]** The private profile is not displayed in the base reading and restricted raw system labels do not leak through AI output. |
| **[ ]** The tarot draw is CSPRNG-based, locked before interpretation, profile-independent, idempotent, and recoverable after refresh/retry. |
| **[ ]** All four reading experiences pass mobile/desktop, keyboard, screen-reader, reduced-motion, skip, and no-audio testing. |
| **[ ]** Deterministic card meanings appear without AI; generation failure preserves the draw and provides a complete fallback/retry path. |
| **[ ]** AI structured-output, quality, grounding, safety, and latency thresholds pass the approved evaluation suite. |
| **[ ]** High-stakes, crisis, third-party accusation, pregnancy, death, diagnosis, guilt, and financial-return scenarios follow policy. |
| **[ ]** One follow-up uses the same reading context and cannot redraw or overwrite the original result. |
| **[ ]** History reproduces original cards, positions, orientations, profile snapshot, and output versions. |
| **[ ]** A complete test purchase produces one correct order, entitlement, report job, web report, PDF, receipt/status, and history entry. |
| **[ ]** Duplicate/replayed/failed/refunded payment and job scenarios produce correct states without duplicate charges or reports. |
| **[ ]** Row-level authorization, encryption, no-PII telemetry, rate limits, deletion, export, backup restore, and incident procedures are verified. |
| **[ ]** Performance, availability, accessibility, browser support, observability, alerting, and rollback targets pass in production-like conditions. |
| **[ ]** Original/licensed art, written content, system terminology, payment terms, privacy/consent copy, and age policy have documented approval. |
| **[ ]** Support and operations can diagnose failures, retry safe jobs, roll back content/prompts, manage entitlements, and activate kill switches. |
| **[ ]** No open Sev-1 or Sev-2 defect remains; beta feedback and metrics support a documented launch go/no-go decision. |

## 12.2 Sign-off matrix
| **Area** | **Required approver** | **Evidence** |
| --- | --- | --- |
| Product scope and UX | Founder / Product | Accepted prototype, scope decision log, critical journey UAT |
| Tarot and profile content | Named domain/content owners | Published content versions and reference approvals |
| Engineering and reliability | Engineering lead | CI, environment tests, runbooks, performance and rollback evidence |
| AI quality and safety | Product + AI/content + safety owner | Evaluation report and critical-case review |
| Security and privacy | Security/privacy owner or counsel as appropriate | Threat model, data map, retention, test results, policies |
| Commerce and operations | Operations/finance owner | Payment/report UAT, refunds, support and incident runbooks |
| Brand and rights | Founder/brand/legal owner | Asset licenses, original-work records, terminology review |
| Launch | Founder / accountable executive | Signed go/no-go record with known risks |

# 13 Risks, open decisions, and change control
*These items should be resolved deliberately; they do not require redesigning the core architecture.*

## 13.1 Highest-priority risks
| **Risk** | **Impact** | **Mitigation** |
| --- | --- | --- |
| Profile systems produce contradictory or overconfident language | Loss of trust and inconsistent readings | Source-aware trait ontology, contradiction preservation, domain review, restricted claims |
| Unknown time treated as exact | Incorrect houses/Ascendant/hour pillar | Capability model, full-day/range uncertainty, no default time |
| AI produces polished but unsupported conclusions | False authority and safety issues | Curated grounding, strict schema, evals, fallback, prohibited-claim checks |
| Animation performs poorly on mobile | High abandonment | 2.5D DOM, card shells, device budgets, skip/reduced motion |
| Birth/question data leaks through tools or logs | Severe privacy and reputational harm | Application encryption, payload minimization, telemetry redaction, access audits |
| Content/artwork rights are unclear | Launch or takedown risk | Original assets or documented licenses; source and ownership registry |
| Negative readings drive compulsive use | User harm and regulatory/reputation risk | Cooldowns, history visibility, no fear upsells, repeat-reading policy |
| Payment/report jobs duplicate or fail | Revenue loss and support burden | Idempotency, durable jobs, reconciliation, operator retry tools |
| Cultural systems are flattened or mislabeled | Loss of credibility and cultural harm | Named traditions, explicit conventions, expert review, original explanatory copy |

## 13.2 Decisions required before engineering lock
- Final product name, brand direction, deck art strategy, and content voice.
- Adult-only launch or broader age policy and corresponding consent/parental requirements.
- Free reading allowance, paid reading model, and Full Profile Report price.
- Exact accepted formats for approximate birth time and report-regeneration policy after profile updates.
- Western astrology aspect/orb set, BaZi boundary conventions, Pythagorean master-number rules, and Dreamspell content scope.
- Whether the paid report includes a rendered natal chart wheel in MVP or a later release.
- Supported launch countries/currencies and localized crisis/support content.
- Account sign-in methods and whether a future unpersonalized guest demo is desired.

## 13.3 Change control
Any change that affects card randomness, profile capability rules, safety policy, restricted profile visibility, payment entitlement, or data retention requires a documented decision, updated requirement/acceptance criteria, test impact review, and version increment. Cosmetic copy and layout changes may use normal design review when they do not alter those behaviors.

# A Appendix: critical user stories
*Condensed stories for backlog creation and user-acceptance planning.*

| **ID** | **User story** |
| --- | --- |
| US-001 | As a new user, I can create a private Core profile with only my birth name and birth date so I am not blocked by an unknown birth time. |
| US-002 | As a user who knows my birthplace but not my time, I can add the place and receive location-enhanced normalization without being shown invented houses. |
| US-003 | As a user who knows my exact birth time, I can add it with birthplace and unlock the complete profile capability. |
| US-004 | As a privacy-conscious user, I understand how my profile is used and can edit, export, or delete my data. |
| US-005 | As a seeker, I can select a reading and ask a focused question without understanding tarot terminology. |
| US-006 | As a user, I can trust that the cards were randomly drawn and were not selected to fit my profile. |
| US-007 | As a mobile user, I can enjoy the shuffle/deal/reveal ritual without lag, motion discomfort, or inaccessible controls. |
| US-008 | As a user, I see each card meaning as I reveal it and do not lose my reading if AI generation is delayed. |
| US-009 | As a user, I receive a direct, personalized, conditional answer with practical leverage rather than a deterministic prediction. |
| US-010 | As a user, I can ask one follow-up about the same reading without drawing new cards. |
| US-011 | As a returning user, I can reopen the original reading exactly as it appeared at completion. |
| US-012 | As a profile explorer, I can purchase a detailed report that reveals the systems behind my private profile. |
| US-013 | As a user without birth time, my paid report clearly omits unavailable house/hour content instead of fabricating it. |
| US-014 | As a support operator, I can resolve a failed job or entitlement without seeing private data unnecessarily. |
| US-015 | As the product owner, I can update spreads, prompts, content, prices, and feature flags safely and roll them back. |

## Appendix completion note
This PRD is ready to decompose into epics, stories, technical design documents, content production tickets, and QA cases. The immediate next artifact should be a clickable UX flow and a requirements tracker that assigns owner, milestone, test ID, and status to every Must requirement.
