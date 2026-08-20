# Tarot draw integrity

The original StarGuidance illustrated deck has 78 unique IDs: 22 Major Arcana and 56 Minor Arcana, with 14 cards in each suit. Every card includes upright/reversed themes, event tags, a reflective prompt, a content version, editorial attribution, and versioned artwork metadata. No copyrighted deck artwork or guidebook copy is included.

- Content version: `starguidance-original-v1`
- Deck version: `starguidance-illustrated-v3`
- Artwork version: `starguidance-celestial-gothic-v3`
- Spread-catalog version: `starguidance-spreads-v2`
- Interpretation-rules version: `interpretation-rules-v1`

Those five release coordinates—deck, card set, meanings, spread catalog, and interpretation rules—are explicit in the governed `content` runtime payload. Durable environments seed a conservative published release. Seed conflict checks fail if any existing deck, card, meaning, spread, or position payload differs under the same version; reseeding never rewrites published content or re-enables a disabled deck/spread/product. A new release is introduced as an immutable reviewed source bundle, then created as a configuration draft, approved by a different operator, and published atomically; an earlier approved release remains rollback-capable. Direct deck/spread activation controls can remove content from new readings immediately without changing historical draws.

`fisher-yates-csprng-v1` calls Node's cryptographic `randomInt` for every Fisher–Yates swap and for each independent reversal decision. Tests assert shuffle bounds, unique cards, Major/Minor/suit counts, spread positions, and immutable same-draw retry/follow-up behavior.

New readings may select only the six current spread IDs. The four retired IDs remain seeded inactive and in the application content catalog solely so an existing locked reading can preserve its original positional meanings and layout. One- and three-card contextual roles are chosen deterministically from the persisted question classification after the draw; this changes interpretation labels, never card selection.

The draw function accepts only card content, deck version, spread configuration, optional time/ID metadata, and an injectable random source for tests. It accepts no profile identifier, traits, birth facts, question, classifier result, prompt, or AI output. Profile snapshot lineage is stored on the reading record outside the shuffle boundary.

The server stores the complete card-position-orientation assignment before interpretation generation. A generation failure changes only generation status. Retry and follow-up operations return the original draw; a redraw requires a new reading session. A normalized repeat of the same question during `READING_REREAD_COOLDOWN_MINUTES` returns a link to the retained reading and its unlock time. Browser tests compare serialized draws before/after recovery, retry, and follow-up.

The shuffle animation renders 15 lightweight shells, not 78 complex cards. Cutting cannot modify the already locked assignment. The sanctuary moves automatically from gathering into dealing; during that brief compatibility phase the reader may mark an optional symbolic cut, but the ritual never waits for a Cut/Skip decision. Any face-down card can then be selected by click, tap, or keyboard. Returning to the spread is required between reveals so the user remains in control of order; there is no convenience action that silently turns the remaining cards. None of these gestures can change the already-persisted assignment, only how it is watched. `{cutTaken, revealedIndexes}` is monotonically validated and persisted on the reading for exact server-backed recovery; per-reading session storage is only a fallback. Completed history entries use the pre-revealed `/reading/[id]` result route. See [Known gaps](KNOWN-GAPS.md) for the remaining manual keyboard/screen-reader/real-device review.

Every card has a unique original v3 SVG face with a card-specific constellation, horizon, symbolic orb, and spatial frame. The immutable v2 route remains readable for historical draws. The shared generated back and sanctuary assets are documented in [ARTWORK-PROVENANCE.md](ARTWORK-PROVENANCE.md). Artwork lookup happens after the draw through the locked `cardId`; artwork metadata, asset loading, profile data, and question text never enter the shuffle function.
