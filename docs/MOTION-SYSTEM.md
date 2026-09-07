# StarGuidance motion system

Motion should feel like making room for a thought. A scene arrives, a card moves with weight, a meaning becomes clear, and the interface rests. The reader sets the pace.

This document describes the implemented system and the rules for extending it. Timing tokens live in `apps/web/src/lib/motion.ts`; `apps/web/src/app/motion.css` applies them across the app. Existing state machines own the reading lifecycle. Animation never owns a draw, network request, payment, or navigation.

## Movement vocabulary

| Role                     | Duration                                          | Easing / displacement                       | Purpose                                                   |
| ------------------------ | ------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Feedback                 | 160 ms                                            | Settle; at most 2 px                        | Acknowledge hover, press, focus, and field state.         |
| Arrival                  | 320 ms                                            | Settle; opacity, or 6 px for a small panel  | Establish a route, prompt, or opened control.             |
| Section reveal           | 560 ms                                            | Settle; 12 px upward, opacity 0.3 → 1       | Introduce one coherent block of content.                  |
| Card travel              | 620 ms                                            | Settle                                      | Move a selected/dealt card into its position.             |
| Card flip                | 720 ms                                            | Travel; rotateY 0 → 180 degrees             | Give a user-requested reveal physical weight.             |
| Deal interval            | 420 ms                                            | Overlap each 620 ms flight                  | Keep larger spreads from becoming a long wait.            |
| Deal settle              | 620 ms                                            | Last flight completes                       | Make reveal controls available after the last card lands. |
| Ready pause              | 480 ms                                            | No movement                                 | Brief punctuation before the signed-in ready prompt.      |
| Wash                     | 320 ms hold, 3 s pass, 40 ms/shell, 240 ms settle | Planar; scatter from and return to one pile | Shuffle twelve shells and visibly re-stack the deck.      |
| Pile to corner           | 700 ms                                            | Settle; transform from the fan anchor       | Carry the re-stacked pile to the lower left.              |
| Fan arrival              | 960 ms + 2 ms/card                                | Settle; opens from the corner pile          | Open all 78 choices, ready within 1,814 ms of the pile.   |
| Image crossfade          | 560 ms                                            | Travel; opacity only                        | Carry the atmosphere from intake into the reading.        |
| Decorative pointer depth | Spring                                            | stiffness 110, damping 24, mass 0.8         | Maximum ±2° pitch and ±3° yaw on the landing artwork.     |

**Settle:** `cubic-bezier(0.22, 1, 0.36, 1)` — quick intent, a soft landing. **Travel:** `cubic-bezier(0.4, 0, 0.2, 1)` — controlled acceleration and deceleration. Avoid bounce, elastic overshoot, flashing, and dramatic camera moves. Use the spring only for decorative depth.

## Complete journey choreography

### Arrival and navigation

The server sends readable content immediately. A route receives a 320 ms opacity arrival, with no sliding page wrapper and no exit wait. Fixed reading scenes retain the viewport as their containing block. Browser history, native anchor scrolling, and Next.js navigation keep their normal behavior.

The landing composition reads in this order: a short introduction, the invitation to begin, the symbolic card group, then three explanations. A single content-block reveal keeps headings and body text together. No letter splitting, typewriter delay, or text blur. Primary actions remain operable throughout. Reveals run once per mount and cancel when focus enters their content; scrolling backward never replays them. Content remains visible if JavaScript or IntersectionObserver is unavailable.

Forms, account controls, privacy actions, history, and report libraries inherit the short route arrival and shared feedback timing. Validation messages appear immediately and do not shake. No stagger delays typing or a corrective action. Destructive actions keep the existing confirmation behavior without theatrical motion.

### Loading, completion, and failure

| Situation                                      | Behavior                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Route suspended                                | A centered, stable “Opening your space…” status; its entrance has a 160 ms grace period to reduce flashes.                       |
| Profile, history, or report fetch              | Existing semantic loading label plus a small 1.8 s opacity/scale breath. No fabricated progress percentage.                      |
| Submission or draw finalization                | Existing pending/disabled state appears immediately. Card choreography does not determine request timing.                        |
| Reading generation                             | Existing stream/status tells the truth about preparation. No artificial minimum wait for a completed answer.                     |
| Report purchase / background generation        | Existing payment and preparation statuses remain visible until the server confirms readiness. Motion does not imply entitlement. |
| Error, expired session, or safety interruption | Existing readable message and next action immediately; no shake, zoom, flashing, or dramatic transition.                         |
| Retry                                          | Retain the current cards and answer; repeat only the operation that failed.                                                      |

Status text is announced politely through the existing live regions. In reduced motion, the loading symbol is static while its status text remains. Loading may repeat while an actual operation is pending; decorative atmosphere settles within four seconds.

### Threshold and image transitions

Two bounded responsive AVIF/WebP layers carry the sanctuary and starry reading backdrop. The initial image has high fetch priority; the alternate has low priority. Keep the current image visible until the requested replacement loads, then crossfade for 560 ms. A failed alternate image leaves the previous atmosphere intact. Imagery is decorative, and never delays the question or reading controls.

No per-frame blur, saturation, or object-position animation. The existing small phase-dependent background scale uses a 1.2 s settle; it is stationary in reduced motion. The light settles once. Mist, orbital decorations, and particles are static while the user reads.

### Shuffle, fan, cut, deal, reveal

1. **Shuffle:** twelve lightweight visual shells suggest the full deck. The deck rests as one pile at center stage for 320 ms, then each shell leaves the pile 40 ms after the previous one, crosses three planar destinations over 3 s, and returns to the pile, so the deck visibly re-stacks. Stirring (tap or drag the deck) restarts the wash and contributes entropy. There is no gather action: 240 ms after the pile re-stacks the fan takes over on its own. Quiet mode shows the resting pile for 900 ms, still stirrable, then swaps directly to the fan. Visual shell identity has no relationship to card identity or random selection.
2. **Fan:** all 78 real selection indexes remain available. Each fan card begins on the very pile the wash re-stacked, slides with it to the lower-left corner over 700 ms, then opens into the arch over 960 ms with a 2 ms stagger; the whole entrance is a transform from the card's own fan anchor, and selection enables once the last card settles. Each card remains a labeled native button. Pointer position highlights the existing fan choice; touch can tap or drag, and keyboard can activate any choice. A highlight lifts a card without changing its selected identity.
3. **Selection:** a chosen card flies over 620 ms to the exact slot it will occupy once dealt, measured from an invisible copy of the spread grid that uses the dealt layout's own classes; a proportional layout stands in until that measurement exists. Container-relative translations respond to viewport changes without animating layout positions. The input protocol, entropy contribution, optional cut, and server draw lock remain unchanged. The picked cards stay on screen while the draw locks; there is no loading screen, route change, or second deck between selection and the deal.
4. **Optional cut:** preserve the existing intentional cut control and its 720 ms packet separation. Quiet mode swaps directly to the resulting arrangement. Cutting is never required to proceed.
5. **Deal:** the locked spread mounts once and stays mounted through the reading. Each dealt card first appears exactly where its picked shell sat (measured from the fan before it unmounts, matched by spread position) and then travels 620 ms into its slot, each flight beginning 420 ms after the previous card. The final card settles before the next prompt. Guest and signed-in flows use the same tokens; the signed-in flow continues in the same scene and updates the URL with `history.replaceState`. A recovered ritual with no handoff deals from the center of the spread. Existing skip/recovery paths bypass ceremony delays.
6. **Layout glide:** when the surrounding layout changes phase (deal → reflection prompt → reveal choice → interpretation with the transcript), the whole spread keeps its previous position and size and glides 620 ms to the new layout with a FLIP transform instead of jumping. A cinematic reveal settles any glide before measuring the card.
7. **Ready:** the reader explicitly chooses to proceed. The signed-in ready prompt arrives after a short 480 ms pause instead of 2.5 seconds.
8. **Reveal:** a selected card comes forward over 620 ms; its 720 ms flip begins after 100 ms. The scrim changes opacity. Other cards recede without animated blur. The title and position copy arrive promptly. The reader returns to the spread or reveals all; there is no automatic timed advance.
9. **Quiet reveal:** final card placement and face state appear immediately. Keep `rotateY(180deg)` as the face-up state; removing all transforms would hide the result.

### Interpretation and closure

Paragraphs are rendered from the existing validated result contract. A 320 ms passage arrival introduces the current thought; complete text remains readable. Optional narration keeps its existing explicit controls and transcript semantics. Reduced motion exposes complete passage text instead of narration-paced visual word sequencing.

Card associations use a steady border emphasis. They do not pulse while a person is reading. The reader navigates passages with the existing buttons and arrow/Home/End keyboard commands. A final action opens the closure; follow-ups retain the same draw and profile snapshot.

### Scrolling, pinned sections, and reports

Use native smooth scrolling with a 6 rem anchor offset for the header. No wheel interception, scroll-jacking, scroll snapping, custom inertia, or forced pinned marketing sequence. Normal scroll position and browser restoration remain authoritative.

The landing card stage gets only ±12 px of view-linked vertical parallax, on fine-pointer desktop layouts at least 900 px wide and only when CSS scroll timelines are supported. Other browsers receive the same stationary composition. No scroll JavaScript runs for this effect.

The report's existing contents index stays sticky on wide screens and returns to document flow on narrow layouts. Each report section receives one short reveal when it enters view. Anchor destinations are offset below the header. The index never traps scrolling or focus. Printed/exported content has no reveal, sticky choreography, or hidden text.

### Hover, cursor, and touch

Keep the native cursor. No trailing particles, custom cursor, magnetic buttons, or pointer follower over reading text. Buttons rise at most 2 px for fine-pointer hover and settle to a 0.985 scale press. Keyboard focus remains a strong, static outline. Interactive labels and hit targets do not drift.

Only the decorative landing artwork responds to pointer position, with damped depth. It resets on pointer exit or reduced-motion activation, ignores touch events, and does not run on a coarse pointer. Motion values update transforms without React rendering on every frame. Touch uses the same controls and information without depending on hover.

## Accessibility and resilience contract

- One preference spans landing, guest readings, authenticated readings, reports, and ordinary routes. The existing reading preference storage key is retained.
- Device `prefers-reduced-motion: reduce` is a minimum, even if the stored application preference permits motion. Changes take effect live. Controls explain when the device setting is in force.
- Manual quiet mode disables CSS animation, transitions, smooth scrolling, parallax, and the new section/pointer effects. Existing reading logic skips timed rituals.
- A blocked localStorage store falls back to in-memory preference; it must never break a page. Cross-tab storage changes synchronize open views.
- Server HTML starts with reduced motion until browser preferences are known. No JavaScript means readable, static content.
- Hidden documents pause CSS animations. Decorative loops are removed; finite motion cannot continuously consume attention or GPU time. Network/state recovery stays independent of visibility.
- No content is hidden pending intersection or an animation event. Focus cancels an active section reveal. Print cancels section animations and forces all report content visible.
- Sound remains controlled by the existing audio settings. This system introduces no autoplay or new audio dependency.

## Performance and validation

The continuous wash workload drops from 78 shells to 12; the selection fan still exposes 78 buttons. The fan entrance and selected-card flight use transforms instead of animating `left`/`bottom`. Persistent `will-change` hints are removed from resting cards. Artwork uses the existing assets; no generated image or new dependency is needed.

Browser acceptance covers persisted quiet mode, live OS changes, blocked storage, no-JavaScript content, touch exclusion, desktop pointer reset, a bounded/stoppable shuffle, all 78 keyboard choices, selected-card placement after resize, and a revealed card surviving a live motion change. Existing suites cover onboarding, reduced-motion readings, recovery, fixed draws/follow-ups, accessibility, and purchases. See `docs/MOTION-VALIDATION.md` for executed commands and evidence.

Do not infer frame-rate guarantees from CSS property choices or screenshots. A representative low-end mobile hardware trace remains a release check for performance tuning. Unsupported scroll timelines intentionally use the static composition.
