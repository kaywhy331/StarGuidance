# Profile calculations

## Implemented and tested

`pythagorean-v2` always calculates the date-derived Life Path and Birthday values. It calculates Expression, Soul Urge, and Personality when the entered name can be normalized without transliteration. Master numbers 11, 22, and 33 are preserved. Spaces, punctuation, and Latin diacritics are normalized while the encrypted original name remains unchanged. For unsupported writing systems, name-derived values are typed unavailable; the profile still succeeds and the application never asks for or invents a Latin rendering.

`profile-traits-v3` maps deterministic available numerology observations and original Nine Star Ki editorial observations to the shared trait ontology with source rule, source system, calculation version, and stability. It preserves a motivation/expression tension when their mapped families differ and omits name-derived traits when those calculations are unavailable. Nine Star Ki traits remain uncertain until the convention review below is complete. `question-trait-lens-v1` deterministically selects at most three stable traits relevant to career, relationship, change, or general questions. It never selects cards and never sends raw calculation values into a base tarot reading.

`dreamspell-anchor-1987-07-26-kin34-v1` produces Kin, tone, solar seal, color, and version from the Gregorian date. Its trait is marked uncertain and excluded from the stable reading lens. The implementation status is `implemented_pending_approved_reference_dataset`; production certification requires an approved decoder set and terminology/rights review.

`nine-star-ki-fixed-boundaries-lo-shu-v1` deterministically produces a Principal, Character, and derived Energy star from the Gregorian birth date. The annual sequence uses 1963 as the 1 Water cycle anchor and changes on February 4. Monthly stars use the explicit fixed civil-date boundary table encoded in the module. The optional third star uses the named Lo Shu positional derivation; it is not presented as a separate time-of-birth measurement, and other schools may use a different derivation. Each number retains its traditional five-phase association, while every personality sentence is original StarGuidance editorial copy.

The fixed-date convention is intentionally not described as an exact astronomical solar-term calculation. Its status is `implemented_pending_independent_reference_review`. Activation as a certified component requires an approved convention manifest, independent golden cases around every annual/monthly boundary, review of the third-star derivation, and a rights record confirming that only calculation facts and original prose/assets are shipped. The engine does not call or scrape a consumer Nine Star Ki guide or calculator.

Onboarding accepts one optional birth-time value and one independent optional birth city/country value. It does not ask users to classify time confidence or enter an IANA timezone. A time supplied without birthplace is retained, while calculations requiring historical timezone context remain unavailable. Missing data reduces profile capability rather than blocking tarot.

## Explicitly unavailable

Western astrology, Whole Sign houses, Placidus houses, and BaZi Four Pillars return typed unavailable results. `ENABLE_WESTERN_ASTROLOGY=true` or `ENABLE_BAZI=true` makes the profile engine refuse to start; an environment flag cannot turn the current unavailable contracts into data. The guards may be removed only in the same reviewed change that supplies the validated adapter and every artifact below. The application does not return placeholder placements, houses, pillars, or fabricated facts.

Planetary-angularity mapping is also a versioned, typed component. It currently returns unavailable, with a reason that distinguishes missing birth time, missing validated place context, and an inactive calculation adapter. `ENABLE_PLANETARY_ANGULARITY=true` fails startup until the reviewed adapter is present. The paid report includes this component status but never invents an angular line or place claim.

### Western astrology activation gate

Activation requires one immutable, reviewable release record containing all of the following:

1. **Licensing approval.** Record the exact ephemeris, geocoder, and historical-timezone datasets and versions; their commercial, hosted-service, caching, attribution, and redistribution terms; the approving reviewer; and the approval date. A dependency being installable or source-available is not sufficient approval.
2. **Versioned conventions.** Freeze the zodiac/frame, coordinate model, supported bodies and points, ephemeris time scale and Delta-T policy, node policy, sign-boundary rounding, aspect set, per-aspect/per-body orbs, applying/separating policy, Whole Sign rules, Placidus implementation, Ascendant/Midheaven definitions, high-latitude behavior, and uncertainty tolerances. Freeze the place-to-coordinate and historical IANA-timezone resolution rules, ambiguous/nonexistent local-time behavior, and the date-only 24-hour stability algorithm. Do not infer a timezone from a city label with an unreviewed heuristic.
3. **Independent golden references.** Check at least the PRD's 100 approved charts at 100% within documented numeric tolerances. The set must cover DST and historical offset changes, leap dates, sign/house/aspect boundaries, high latitudes, ambiguous and nonexistent civil times, incomplete location, birth time without place, and date-only cases where the Moon or an aspect changes during the day. Fixtures must name the independent authoritative source, source version, expected output, and dataset digest without including real customer data.
4. **Contract and failure tests.** Prove that planetary positions, aspects, angles, both house systems, calculation status, uncertainty windows, engine/data versions, and source metadata survive schema validation. Missing or ambiguous context, unsupported latitude, dependency errors, and out-of-tolerance results must return a typed unavailable/uncertain result rather than a guessed placement.
5. **Expert sign-off.** A named qualified Western-astrology reviewer must approve the convention manifest, reference results, permitted interpretations, and user-facing uncertainty language for the exact calculation release. Any dependency, dataset, convention, or tolerance change creates a new calculation version and repeats approval.

### BaZi Four Pillars activation gate

Activation requires a versioned convention manifest rather than hidden library defaults. It must state the Gregorian/civil input model, sexagenary-cycle reference, Li Chun versus lunar-new-year year boundary, solar-term month boundaries and astronomical source, day-pillar epoch, midnight versus early/late Zi-hour day boundary, hour-pillar rule, historical timezone source, DST treatment, longitude correction, true-solar-time policy, handling of ambiguous/nonexistent local times, and behavior when time or validated location context is absent.

At least the PRD's 100 independently approved cases must match at 100%. The suite must straddle Li Chun, every relevant solar-term boundary, Gregorian leap dates, midnight and 23:00/Zi-hour boundaries, DST/offset changes, longitude edges, time-without-place, place-without-time, and cases where true-solar-time policy changes a pillar. Each fixture records its approved source, convention version, expected pillars/status, and dataset digest and contains no customer data. Unsupported or boundary-ambiguous inputs fail closed.

A named qualified BaZi reviewer must sign the convention manifest, reference results, tolerances, terminology, and user-facing uncertainty behavior for the exact adapter, dependency, and dataset versions. Changing any of those inputs requires a new calculation version and renewed approval.

### Dreamspell certification and content-rights gate

`dreamspell-anchor-1987-07-26-kin34-v1` remains deterministic but `implemented_pending_approved_reference_dataset`; it is not a certified production interpretation source. Certification requires:

1. An approved decoder dataset with at least the PRD's 60 known dates across centuries, Gregorian leap years/century rules, cycle wrap points, and the documented anchor. Every case must match Kin, Galactic Tone, Solar Seal, and color at 100%, and the dataset must carry a stable version and digest.
2. Source provenance and reviewer approval for the decoder rules. Internal and user-facing language must identify the system as **Dreamspell** and must not present it as the historical Maya calendar or imply institutional/Indigenous endorsement.
3. A rights register for every seal name, description, prompt, glyph, illustration, and other visual/text asset, identifying original authorship, public-domain basis, or a license that permits commercial web/report use and distribution. Attribution and modification requirements must be implemented before release.
4. A named domain reviewer and rights approver signing the exact algorithm, dataset, terminology catalog, editorial copy, and asset manifest. Any change creates a new content/calculation version and repeats the affected approval and reference suite.

Until those artifacts exist, Dreamspell-derived traits remain uncertain and excluded from the stable reading lens, and detailed report copy continues to disclose the pending-certification status.

### Planetary-angularity activation gate

Geographic planetary angularity is astronomical angularity projected onto the Earth, not a promise that a place guarantees luck, romance, hardship, or success. Activation requires an approved Swiss Ephemeris license choice, pinned engine/data files, validated place-to-coordinate and historical-timezone resolution, and independently checked rising, setting, culmination, and anti-culmination lines. The line algorithm must test high declinations, circumpolar gaps, line crossings, antimeridian wrapping, DST and historical offsets. Placidus failure never converts a Whole Sign result into a Placidus result, and no city is assigned to a line through an unreviewed proximity heuristic.

Every map/report statement must retain the body, angle, orb or distance policy, calculation version, map-data version, and original interpretation rule. Interpretations are conditional and written specifically for StarGuidance; third-party map copy, branding, screenshots, and calculator output are not ingested.

### Commercial-use boundary

Historical or public mathematical concepts may be used in paid readings with original editorial treatment, subject to the licenses of the actual code, ephemeris, geocoder, timezone data, map data, and assets used to implement them. Calling the product a reading service does not waive AGPL, professional, trademark, database, content, or hosted-service license terms. A proprietary modern system that forbids the intended use is omitted from the product rather than represented by a dormant adapter or teaser.

### Activation evidence

The production-change PR must link a non-secret manifest recording adapter and dependency versions, convention/content versions, dataset IDs and SHA-256 digests, test command and 100% result, licensing/rights decision IDs, reviewer names/roles and dates, and rollback behavior. CI must run the approved reference fixtures. A configuration change or dashboard toggle by itself is never activation evidence.

## Versioning

Updating birth facts creates a new encrypted snapshot version. Readings retain the original snapshot ID and calculation versions; history is never silently reinterpreted. The credential-free adapter retains snapshot history for its process lifetime, while production requires durable Postgres integration.
