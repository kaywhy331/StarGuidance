# Tarot draw integrity

The original StarGuidance typographic deck contains 78 unique IDs: 22 Major Arcana and 56 Minor Arcana, with 14 cards in each suit. Every card has upright/reversed themes, event tags, a reflective prompt, content version, and editorial attribution. No copyrighted deck art or guidebook copy is included.

`fisher-yates-csprng-v1` uses Node's cryptographic `randomInt` for every Fisher–Yates swap. Reversal bits are requested independently after shuffling. The production draw API accepts deck/spread versions and a profile snapshot ID; it accepts no profile traits, question, or AI output. Tests assert algorithm bounds, uniqueness, counts, spread ordering, and same-object retry/follow-up behavior.

The complete card-position assignment is frozen and the database permits only one locked draw per reading. Generation failures and follow-ups reference the same reading and draw. A redraw is a new reading session.
