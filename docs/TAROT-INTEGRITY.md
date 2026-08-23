# Tarot consultation and draw integrity

StarGuidance treats the reading ritual as part of draw finalization, not as an animation over cards that were already selected. A reading exists before the ritual, but its final card-position-orientation assignments do not exist until the reader completes or skips shuffling and makes or declines the optional cut.

## Governed content

The original StarGuidance illustrated deck has 78 unique IDs: 22 Major Arcana and 56 Minor Arcana, with 14 cards in each suit. Every card includes upright themes, contextual reversed themes, approved reversal facets, event tags, a reflective prompt, content provenance, and versioned artwork metadata. No copyrighted deck artwork or guidebook copy is included.

- Content version: `starguidance-original-v1`
- Deck version: `starguidance-illustrated-v3`
- Artwork version: `starguidance-celestial-gothic-v3`
- Spread-catalog version: `starguidance-spreads-v3`
- Draw version: `fisher-yates-committed-v2`
- Entropy version: `hmac-sha256-domain-stream-v1`
- Result schema: `reading-result-v3`

Decks, meanings, spread definitions, positions, capability metadata, prompts, and schemas are versioned. Spread positions and their functions are snapshotted when the spread is confirmed, before any card is known, and cannot be reassigned afterward. Older rows remain readable by their version-qualified keys; reseeding refuses to overwrite published content under an existing version.

## Causal draw protocol

The server creates a 32-byte CSPRNG seed when the confirmed question, spread, safety decision, reversal preference, and personalization mode are prepared. It returns only a SHA-256 commitment and keeps the seed inside an authenticated-encryption ceremony token. Preparation returns no card IDs, orientations, or assignments.

After the reader completes or skips the shuffle and chooses a cut, the browser supplies a fresh 32-byte Web Crypto nonce. `finalizeCommittedDraw` verifies the seed commitment, then derives independent HMAC-SHA-256 streams for permutation and orientation from the server seed, client nonce, reading/session ID, deck version, spread ID, and spread version. The question, profile, classifier result, payment state, card meanings, and AI output are absent from this boundary and cannot influence selection.

The permutation stream drives Fisher–Yates with rejection sampling, avoiding modulo bias. A selected cut is then applied as an exact rotation of that shuffled deck; tests prove the offset changes the resulting assignment. Orientation uses a separate domain-separated stream. The first required cards are assigned to the already-snapshotted positions, and the session, complete draw, and interpretation job are persisted atomically before dealing starts. Account readings retain the server seed only as application-encrypted audit material; it is never exposed to the browser or provider. The durable proof stores the commitment, a client-nonce hash, cut index, reversal mode, and algorithm versions rather than the raw client nonce.

Skipping animation advances to finalization immediately but uses the same entropy protocol. A refresh before finalization restores the seed commitment and ritual stage without inventing a draw. A refresh, retry, stream failure, or reconnect after finalization restores the exact locked assignments. Once a draw is locked, shuffle UI events cannot modify it.

The legacy `fisher-yates-csprng-v1` helper remains available only for historical fixtures and low-level compatibility tests. User-facing account and guest creation routes use the committed v2 finalizer.

## Reversals

Every reading snapshots either `reversals_enabled` or `upright_only`; reversals are an optional method, not the only legitimate one. When disabled, all assignments are upright. When enabled and allowed by the spread, orientation is selected securely and persisted.

A reversed card is not interpreted as an automatic opposite or negative. Curated card content supplies only approved contextual facets such as blocked, internalized, delayed, imbalanced, excessive, deficient, avoided, releasing, and recovering. The interpreter may use a facet only when supported by the card, position, question, and surrounding spread.

## Deal, reveal, and result gate

Locked cards deal face down into their canonical positions. The default reveal order follows numbered position order; tap, click, Enter, and Space are supported, along with an explicit Reveal All control and reduced-motion path. A single reveal exposes only card name, persisted orientation, spread-position title, and one concise position-aware baseline meaning. Unrevealed card fronts and identifying DOM attributes are not rendered.

Whole-reading prose may be generated privately after locking, but it is withheld by both the API and UI until every card is revealed and the machine reaches `fullSpreadReady`. The stream then renders a spread-aware result; it never emits a fixed eight-part transcript or invents unsupported sections.

## Interpretation grounding

Before prose is shown, the deterministic reader and live-provider prompt contract perform question analysis, positional analysis, and a whole-spread scan. Each card result records its core curated meaning, position interpretation, relationship notes, and supporting evidence. The scan considers repeated suits/elements, Major Arcana concentration, repeated numbers/ranks, court patterns, reinforcement, conflict, configured movement, and explicitly linked positions. Synthesis connects those observations into one answer rather than repeating dictionary definitions.

`directAnswer`, card evidence, `synthesis`, `userAgency`, `reflectionPrompt`, and `uncertaintyNote` form the stable core. `likelyTrajectory`, `alternatePath`, and `timing` are nullable and may appear only when the snapshotted spread capabilities and question support them. A one-card Focus reading cannot manufacture an alternate trajectory. Crossroads can compare configured paths; Deeper Outlook can discuss only its configured outlook positions. Timing remains null unless an approved timing method is present.

`pure_tarot` sends no profile traits. `personalized_tarot` may send only the minimized plain-language lens relevant to the confirmed question. Profile observations are rendered separately under `Personalized reflection`; they may change emphasis or examples but cannot select cards, change orientation, redefine a position, reverse card meaning, or manufacture a prediction. Raw birth facts and hidden astrology, numerology, BaZi, Dreamspell, or Nine Star Ki labels do not enter the base reading.

Provider output must validate against the exact locked card/position/orientation tuples and spread capabilities. Unsafe, malformed, contradictory, or unsupported output falls back deterministically without changing the draw. Results render as components, never arbitrary provider HTML or Markdown.

## Follow-ups and history

A clarification on the original subject and horizon reuses the same reading ID, cards, positions, orientations, profile snapshot, and original result. A materially different subject, decision, person, or horizon is rejected as a follow-up and must create a new reading session. Dislike, dispute, refresh, retry, or rephrasing never causes a redraw, and MVP adds no clarifier cards.

Authenticated history remains immutable and opens the completed draw directly. Guest recovery uses an encrypted, device-bound receipt and also restores the exact assignments; losing ephemeral reveal progress can return the cards face down, but it cannot invent or replace them. Browser and domain tests compare locked draws across finalization, cut offsets, recovery, retry, and follow-up.

The sanctuary still renders 15 lightweight shuffle shells rather than 78 full cards. Each revealed card resolves its original v3 SVG artwork only after the draw through the locked `cardId`; artwork loading never participates in selection. See [Artwork provenance](ARTWORK-PROVENANCE.md) and [Known gaps](KNOWN-GAPS.md) for rights and remaining manual accessibility/device gates.
