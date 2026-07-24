# Profile calculations

## Implemented and tested

`pythagorean-v2` always calculates the date-derived Life Path and Birthday values. It calculates Expression, Soul Urge, and Personality when the entered name can be normalized without transliteration. Master numbers 11, 22, and 33 are preserved. Spaces, punctuation, and Latin diacritics are normalized while the encrypted original name remains unchanged. For unsupported writing systems, name-derived values are typed unavailable; the profile still succeeds and the application never asks for or invents a Latin rendering.

`profile-traits-v2` maps deterministic available numerology observations to the shared trait ontology with source rule, source system, calculation version, and stability. It preserves a motivation/expression tension when their mapped families differ and omits name-derived traits when those calculations are unavailable. `question-trait-lens-v1` deterministically selects at most three stable traits relevant to career, relationship, change, or general questions. It never selects cards and never sends raw numerology values into a base tarot reading.

`dreamspell-anchor-1987-07-26-kin34-v1` produces Kin, tone, solar seal, color, and version from the Gregorian date. Its trait is marked uncertain and excluded from the stable reading lens. The implementation status is `implemented_pending_approved_reference_dataset`; production certification requires an approved decoder set and terminology/rights review.

Onboarding accepts one optional birth-time value and one independent optional birth city/country value. It does not ask users to classify time confidence or enter an IANA timezone. A time supplied without birthplace is retained, while calculations requiring historical timezone context remain unavailable. Missing data reduces profile capability rather than blocking tarot.

## Explicitly unavailable

Western astrology, Whole Sign houses, Placidus houses, and BaZi Four Pillars return typed unavailable results. Their feature flags remain off. Activation requires commercially compatible dependencies, explicit boundary/orb/calendar conventions, approved golden reference cases, and domain-expert sign-off. The application does not return placeholder placements, houses, pillars, or fabricated facts.

## Versioning

Updating birth facts creates a new encrypted snapshot version. Readings retain the original snapshot ID and calculation versions; history is never silently reinterpreted. The credential-free adapter retains snapshot history for its process lifetime, while production requires durable Postgres integration.
