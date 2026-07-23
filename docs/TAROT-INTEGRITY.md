# Tarot draw integrity

The original StarGuidance illustrated deck has 78 unique IDs: 22 Major Arcana and 56 Minor Arcana, with 14 cards in each suit. Every card includes upright/reversed themes, event tags, a reflective prompt, a content version, editorial attribution, and versioned artwork metadata. No copyrighted deck artwork or guidebook copy is included.

- Content version: `starguidance-original-v1`
- Deck version: `starguidance-illustrated-v2`
- Artwork version: `starguidance-celestial-gothic-v2`

`fisher-yates-csprng-v1` calls Node's cryptographic `randomInt` for every Fisher–Yates swap and for each independent reversal decision. Tests assert shuffle bounds, unique cards, Major/Minor/suit counts, spread positions, and immutable same-draw retry/follow-up behavior.

The draw function accepts only card content, deck version, spread configuration, optional time/ID metadata, and an injectable random source for tests. It accepts no profile identifier, traits, birth facts, question, classifier result, prompt, or AI output. Profile snapshot lineage is stored on the reading record outside the shuffle boundary.

The server stores the complete card-position-orientation assignment before interpretation generation. A generation failure changes only generation status. Retry and follow-up operations return the original draw; a redraw requires a new reading session. Browser tests compare serialized draws before/after recovery, retry, and follow-up.

The shuffle animation renders nine lightweight shells, not 78 complex cards. Cutting is optional ritual UI and cannot modify the already locked assignment.

Every card has a unique original SVG face. The shared generated back and sanctuary assets are documented in [ARTWORK-PROVENANCE.md](ARTWORK-PROVENANCE.md). Artwork lookup happens after the draw through the locked `cardId`; artwork metadata, asset loading, profile data, and question text never enter the shuffle function.
