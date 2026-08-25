"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";

export const TAROT_DECK_SIZE = 78;
export const SHUFFLE_STREAM_COUNT = 6;
export const SHUFFLE_SHELL_COUNT = TAROT_DECK_SIZE;
const SHELLS_PER_STREAM = SHUFFLE_SHELL_COUNT / SHUFFLE_STREAM_COUNT;

type RitualStyle = CSSProperties & Record<`--${string}`, string | number>;

export interface ShuffleShellLayout {
  readonly stream: number;
  readonly slot: number;
  readonly fieldX: number;
  readonly fieldY: number;
  readonly weaveX: number;
  readonly weaveY: number;
  readonly returnX: number;
  readonly returnY: number;
  readonly mobileFieldX: number;
  readonly mobileFieldY: number;
  readonly mobileWeaveX: number;
  readonly mobileWeaveY: number;
}

/**
 * Places every anonymous shell in one of six planar streams. The integer
 * permutations deliberately avoid circular/spherical coordinates while
 * giving all 78 backs a distinct field and weave destination.
 */
export function shuffleShellLayout(index: number): ShuffleShellLayout {
  if (!Number.isInteger(index) || index < 0 || index >= SHUFFLE_SHELL_COUNT) {
    throw new RangeError(`Shuffle shell index must be between 0 and ${SHUFFLE_SHELL_COUNT - 1}`);
  }
  const stream = Math.floor(index / SHELLS_PER_STREAM);
  const slot = index % SHELLS_PER_STREAM;
  const mobileColumn = index % SHUFFLE_STREAM_COUNT;
  const mobileRow = Math.floor(index / SHUFFLE_STREAM_COUNT);
  const fieldX = -44 + slot * (88 / (SHELLS_PER_STREAM - 1)) + (stream % 2 === 0 ? -1.5 : 1.5);
  const fieldY = -31 + stream * (62 / (SHUFFLE_STREAM_COUNT - 1));
  const weaveSlot = (slot * 5 + stream * 3) % SHELLS_PER_STREAM;
  const returnSlot = (slot * 7 + stream * 2) % SHELLS_PER_STREAM;

  return {
    stream,
    slot,
    fieldX,
    fieldY,
    weaveX: -38 + weaveSlot * (76 / (SHELLS_PER_STREAM - 1)) + (stream - 2.5) * 2,
    weaveY: 29 - stream * (58 / (SHUFFLE_STREAM_COUNT - 1)) + (slot % 2 === 0 ? 4 : -4),
    returnX: -42 + returnSlot * (84 / (SHELLS_PER_STREAM - 1)),
    returnY: -fieldY * 0.58 + ((slot % 3) - 1) * 6,
    mobileFieldX: -38 + mobileColumn * (76 / (SHUFFLE_STREAM_COUNT - 1)),
    mobileFieldY: -39 + mobileRow * (78 / (SHELLS_PER_STREAM - 1)),
    mobileWeaveX: 34 - mobileColumn * (68 / (SHUFFLE_STREAM_COUNT - 1)),
    mobileWeaveY:
      -34 + ((mobileRow * 5 + mobileColumn) % SHELLS_PER_STREAM) * (68 / (SHELLS_PER_STREAM - 1)),
  };
}

export function cutIndexFromRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return TAROT_DECK_SIZE / 2;
  return Math.min(
    TAROT_DECK_SIZE - 1,
    Math.max(1, Math.round(Math.min(1, Math.max(0, ratio)) * TAROT_DECK_SIZE)),
  );
}

function ShuffleShells() {
  return (
    <span
      aria-hidden="true"
      className="sanctuary-shuffle-shells full-deck-possibility-field is-mixing"
      data-shell-count={SHUFFLE_SHELL_COUNT}
    >
      {Array.from({ length: SHUFFLE_STREAM_COUNT }, (_, stream) => (
        <span
          className="shuffle-card-stream"
          data-stream={stream + 1}
          key={stream}
          style={{ "--stream-index": stream } as RitualStyle}
        >
          {Array.from({ length: SHELLS_PER_STREAM }, (_, slot) => {
            const index = stream * SHELLS_PER_STREAM + slot;
            const layout = shuffleShellLayout(index);
            return (
              <i
                data-shell-index={index + 1}
                key={index}
                style={
                  {
                    "--shell-index": index,
                    "--field-x": `${layout.fieldX}vw`,
                    "--field-y": `${layout.fieldY}vh`,
                    "--weave-x": `${layout.weaveX}vw`,
                    "--weave-y": `${layout.weaveY}vh`,
                    "--return-x": `${layout.returnX}vw`,
                    "--return-y": `${layout.returnY}vh`,
                    "--mobile-field-x": `${layout.mobileFieldX}vw`,
                    "--mobile-field-y": `${layout.mobileFieldY}vh`,
                    "--mobile-weave-x": `${layout.mobileWeaveX}vw`,
                    "--mobile-weave-y": `${layout.mobileWeaveY}vh`,
                    "--field-rotation": `${(slot - 6) * 2.4 + (stream - 2.5) * 1.5}deg`,
                    "--weave-rotation": `${((index * 29) % 44) - 22}deg`,
                    "--return-rotation": `${((index * 17) % 34) - 17}deg`,
                  } as RitualStyle
                }
              />
            );
          })}
        </span>
      ))}
    </span>
  );
}

export function ImmersiveShuffleDeck({ onStir }: { onStir?: () => void }) {
  const [cycle, setCycle] = useState(0);
  const control = useRef<HTMLButtonElement>(null);
  const gesture = useRef<
    | {
        pointerId: number;
        startX: number;
        startY: number;
        stirred: boolean;
      }
    | undefined
  >(undefined);
  const suppressNextClick = useRef(false);

  const stir = () => {
    setCycle((current) => current + 1);
    onStir?.();
  };

  // Pointer parallax updates compositor-friendly CSS variables directly so a
  // move does not make React reconcile all 78 presentation shells.
  const setDrift = (x: number, y: number) => {
    control.current?.style.setProperty("--ritual-drift-x", `${x}px`);
    control.current?.style.setProperty("--ritual-drift-y", `${y}px`);
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    setDrift(
      ((event.clientX - bounds.left) / bounds.width - 0.5) * 28,
      ((event.clientY - bounds.top) / bounds.height - 0.5) * 20,
    );
    const currentGesture = gesture.current;
    if (!currentGesture || currentGesture.pointerId !== event.pointerId || currentGesture.stirred)
      return;
    if (
      Math.hypot(event.clientX - currentGesture.startX, event.clientY - currentGesture.startY) < 28
    )
      return;
    currentGesture.stirred = true;
    stir();
  };

  const finishPointerGesture = (event: PointerEvent<HTMLButtonElement>, suppressClick: boolean) => {
    const currentGesture = gesture.current;
    if (!currentGesture || currentGesture.pointerId !== event.pointerId) return;
    suppressNextClick.current = suppressClick && currentGesture.stirred;
    gesture.current = undefined;
    setDrift(0, 0);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <button
      aria-label="Stir all 78 cards"
      className="immersive-shuffle-control"
      data-testid="immersive-shuffle-deck"
      onClick={() => {
        if (suppressNextClick.current) {
          suppressNextClick.current = false;
          return;
        }
        stir();
      }}
      onPointerCancel={(event) => finishPointerGesture(event, false)}
      onPointerDown={(event) => {
        if (!event.isPrimary) return;
        gesture.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          stirred: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerLeave={() => {
        if (!gesture.current) setDrift(0, 0);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => finishPointerGesture(event, true)}
      ref={control}
      type="button"
    >
      <ShuffleShells key={cycle} />
      <span className="immersive-shuffle-cue">
        <strong>78 cards in motion</strong>
        <small>Swipe through the field, tap, click, or press Space to stir again</small>
      </span>
      <span aria-live="polite" className="sr-only">
        {cycle === 0 ? "The full deck is moving." : `Full deck mixed ${cycle} times.`}
      </span>
    </button>
  );
}

function pointerCutIndex(element: HTMLButtonElement, clientY: number) {
  const bounds = element.getBoundingClientRect();
  return cutIndexFromRatio((clientY - bounds.top) / bounds.height);
}

export function ImmersiveCutDeck({
  onCut,
  onNoCut,
  reducedMotion,
}: {
  onCut: (cutIndex: number) => void;
  onNoCut: () => void;
  reducedMotion: boolean;
}) {
  const instructionsId = useId();
  const [cutIndex, setCutIndex] = useState(TAROT_DECK_SIZE / 2);
  const [committed, setCommitted] = useState(false);
  const completionTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (completionTimer.current) window.clearTimeout(completionTimer.current);
    },
    [],
  );

  const commitCut = (nextIndex: number) => {
    if (committed) return;
    setCutIndex(nextIndex);
    setCommitted(true);
    if (reducedMotion) {
      onCut(nextIndex);
      return;
    }
    completionTimer.current = window.setTimeout(() => onCut(nextIndex), 720);
  };

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    const nextIndex =
      event.detail === 0 ? cutIndex : pointerCutIndex(event.currentTarget, event.clientY);
    commitCut(nextIndex);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (committed) return;
    let nextIndex: number | undefined;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = cutIndex - 1;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = cutIndex + 1;
    if (event.key === "PageUp") nextIndex = cutIndex - 5;
    if (event.key === "PageDown") nextIndex = cutIndex + 5;
    if (event.key === "Home") nextIndex = 1;
    if (event.key === "End") nextIndex = TAROT_DECK_SIZE - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setCutIndex(Math.min(TAROT_DECK_SIZE - 1, Math.max(1, nextIndex)));
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (committed) return;
    setCutIndex(pointerCutIndex(event.currentTarget, event.clientY));
  };

  return (
    <div className="immersive-cut-control">
      <button
        aria-describedby={instructionsId}
        aria-label={`Cut the deck at card ${cutIndex} of ${TAROT_DECK_SIZE}`}
        className="immersive-cut-deck"
        data-committed={committed}
        data-testid="ritual-cut-deck"
        disabled={committed}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMove}
        style={{ "--cut-ratio": cutIndex / TAROT_DECK_SIZE } as RitualStyle}
        type="button"
      >
        <span aria-hidden="true" className="immersive-cut-deck__packet is-lower" />
        <span aria-hidden="true" className="immersive-cut-deck__packet is-upper" />
        <span aria-hidden="true" className="immersive-cut-deck__line" />
        <span aria-hidden="true" className="immersive-cut-deck__depth">
          {cutIndex}
        </span>
      </button>
      <p className="immersive-cut-instructions" id={instructionsId}>
        Move across the deck to choose where it separates. Tap, click, or use the arrow keys, then
        press Enter or Space.
      </p>
      <button
        className="immersive-cut-skip"
        disabled={committed}
        onClick={() => {
          if (committed) return;
          setCommitted(true);
          onNoCut();
        }}
        type="button"
      >
        Continue without a cut
      </button>
    </div>
  );
}
