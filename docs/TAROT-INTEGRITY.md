# Tarot consultation and draw integrity

StarGuidance treats the reading ritual as part of draw finalization, not as an animation over cards that were already selected. A reading and its server-recommended spread exist before the ritual, but its final card-position-orientation assignments do not exist until the reader completes the casino wash and selects the required anonymous backs.

## Governed content

The original StarGuidance illustrated deck has 78 unique IDs: 22 Major Arcana and 56 Minor Arcana, with 14 cards in each suit. Every card includes upright themes, contextual reversed themes, approved reversal facets, event tags, a reflective prompt, content provenance, and versioned artwork metadata. No copyrighted deck artwork or guidebook copy is included.

- Content version: `starguidance-original-v2`
- Deck version: `starguidance-illustrated-v4`
- Artwork version: `starguidance-celestial-gothic-v3`
- Spread-catalog version: `starguidance-spreads-v3`
- Draw version: `fisher-yates-committed-user-pick-v3`
- Entropy version: `hmac-sha256-domain-stream-v1`
- Result schema: `reading-result-v3`

Decks, meanings, spread definitions, positions, capability metadata, prompts, and schemas are versioned. Spread recommendation can use the question to choose a layout, but positions and their functions are snapshotted before any card is known and cannot be reassigned afterward. Older rows remain readable by their version-qualified keys; reseeding refuses to overwrite published content under an existing version.

## Causal draw protocol

The server creates a 32-byte CSPRNG seed when the question, recommended spread, safety decision, reversal preference, and personalization mode are prepared. It returns only a SHA-256 commitment and keeps the seed inside an authenticated-encryption ceremony token. Preparation returns no card IDs, orientations, or assignments.

Before the visual ritual starts, the browser creates a 32-byte Web Crypto nonce. Every intentional casino wash XORs another independently generated 32-byte Web Crypto contribution into that pending nonce. XOR preserves uniformity when either contribution is uniform, so interaction adds entropy without weakening the secure initial value; gathering immediately remains equally safe. `finalizeCommittedDraw` verifies the seed commitment, then derives independent HMAC-SHA-256 streams for permutation and orientation from the server seed, final client nonce, reading/session ID, deck version, spread ID, and spread version. The question, profile, classifier result, payment state, card meanings, and AI output are absent from this boundary and cannot influence selection.

The permutation stream drives Fisher–Yates with rejection sampling, avoiding modulo bias. The client submits the required number of distinct visual indexes in pick order. Each index addresses an unknown entry in the uniform committed permutation, so any user selection pattern remains a uniform draw without replacement. Out-of-range, duplicate, or incomplete selections are rejected. Orientation uses a separate domain-separated stream. The selected cards are assigned in order to the already-snapshotted positions, and the session, complete draw, minimized relationship lens, and interpretation job are persisted atomically before dealing finishes. Account readings retain the server seed only as application-encrypted audit material; it is never exposed to the browser or provider. The durable proof stores the commitment, a client-nonce hash, selected indexes, reversal mode, and algorithm versions rather than the raw client nonce.

Reduced-motion presentation removes travel effects but still requires the same number of explicit card choices and uses the secure initial nonce. Before finalization, session recovery preserves the seed commitment, ritual stage, pending nonce, wash count, and selected indexes without inventing a draw; a retry also reuses that state rather than silently changing the outcome. A refresh, retry, stream failure, or reconnect after finalization restores the exact locked assignments. Once a draw is locked, wash or selection UI events cannot modify it.

The legacy `fisher-yates-csprng-v1` helper and committed v2 top-of-deck behavior remain available only for historical fixtures and recovery compatibility. New account and guest routes use committed user-pick v3.

## Reversals

Every reading snapshots either `reversals_enabled` or `upright_only`; reversals are an optional method, not the only legitimate one. When disabled, all assignments are upright. When enabled and allowed by the spread, orientation is selected securely and persisted.

A reversed card is not interpreted as an automatic opposite or negative. Curated card content supplies only approved contextual facets such as blocked, internalized, delayed, imbalanced, excessive, deficient, avoided, releasing, and recovering. The interpreter may use a facet only when supported by the card, position, question, and surrounding spread.

## Deal, reveal, and result gate

Locked cards deal face down into their canonical positions. The reader may reveal any remaining position first by tap, click, Enter, or Space, or use the explicit Reveal All and reduced-motion paths. Reveal order changes presentation only: every card-to-position assignment and orientation is already immutable. A single reveal exposes only card name, persisted orientation, spread-position title, and one concise position-aware baseline meaning. Unrevealed card fronts and identifying DOM attributes are not rendered.

Whole-reading prose may be generated privately after locking, but it is withheld by both the API and UI until every card is revealed and the machine reaches `fullSpreadReady`. The stream then renders a spread-aware result; it never emits a fixed eight-part transcript or invents unsupported sections.

## Interpretation grounding

Before prose is shown, the deterministic reader and live-provider prompt contract perform question analysis, positional analysis, and a whole-spread scan. Each card result records its core curated meaning, position interpretation, relationship notes, and supporting evidence. The scan considers repeated suits/elements, Major Arcana concentration, repeated numbers/ranks, court patterns, reinforcement, conflict, configured movement, and explicitly linked positions. Synthesis connects those observations into one answer rather than repeating dictionary definitions.

`directAnswer`, card evidence, `synthesis`, `userAgency`, `reflectionPrompt`, and `uncertaintyNote` form the stable core. `likelyTrajectory`, `alternatePath`, and `timing` are nullable and may appear only when the snapshotted spread capabilities and question support them. A one-card Focus reading cannot manufacture an alternate trajectory. Crossroads can compare configured paths; Deeper Outlook can discuss only its configured outlook positions. Timing remains null unless an approved timing method is present.

`pure_tarot` sends no profile traits. `personalized_tarot` may send only the minimized plain-language lens relevant to the question. If the question explicitly includes an active relationship-profile handle, it may also send at most three stable plain-language traits for that person plus the handle and immutable internal references. A plain name without `@` never activates a profile, and no match is inferred. These observations may change emphasis or examples but cannot select cards, change orientation, redefine a position, reverse card meaning, or manufacture a prediction. Raw names, birth facts, birthplace/time, and hidden astrology, numerology, BaZi, Dreamspell, or Nine Star Ki labels do not enter either minimized lens.

Provider output must validate against the exact locked card/position/orientation tuples and spread capabilities. Unsafe, malformed, contradictory, or unsupported output falls back deterministically without changing the draw. Results render as components, never arbitrary provider HTML or Markdown.

## Follow-ups and history

A clarification on the original subject and horizon reuses the same reading ID, cards, positions, orientations, profile snapshot, and original result. A materially different subject, decision, person, or horizon is rejected as a follow-up and must create a new reading session. Dislike, dispute, refresh, retry, or rephrasing never causes a redraw, and MVP adds no clarifier cards.

Authenticated history remains immutable and opens the completed draw directly. Guest recovery uses an encrypted, device-bound receipt and also restores the exact assignments; losing ephemeral reveal progress can return the cards face down, but it cannot invent or replace them. Browser and domain tests compare locked draws across finalization, cut offsets, recovery, retry, and follow-up.

The sanctuary renders exactly 78 lightweight, anonymous card-back shells in an overlapping casino-wash field. They follow circular planar paths, gather to one stack, move to the lower left, and fan in a shallow arch toward the lower right. These are CSS-only possibility markers, not 78 stateful card-face components: they contain no card IDs, faces, meanings, orientations, or assignments. Hover/focus highlights a border; click, Enter/Space, or an upward swipe chooses a hidden index and deals its eventual locked card into the next position. Each revealed spread card resolves its original v3 SVG artwork only after finalization through the locked `cardId`; artwork loading never participates in selection. See [Artwork provenance](ARTWORK-PROVENANCE.md) and [Known gaps](KNOWN-GAPS.md) for rights and remaining manual accessibility/device gates.
