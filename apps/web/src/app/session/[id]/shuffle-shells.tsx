"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { preload } from "react-dom";

import { motionTiming } from "@/lib/motion";

import type { CardHandoffOrigin } from "./stage-flip";
import type { SpreadSlot } from "./tarot-spread-stage";

export const TAROT_DECK_SIZE = 78;
/** A picked shell grows by this much as it settles into its spread position. */
export const CASINO_PICK_SCALE = 1.18;
/** The dealt cards render this back; shells use its WebP twin as a CSS
 * background, so it is fetched while the fan is open to keep the handoff
 * seamless. */
export const CASINO_CARD_BACK_AVIF = "/art/tarot/v2/celestial-gothic-back-v1.avif";
// Visual shells never represent, select, or mutate real card identities. The
// wash moves the whole deck so the count on stage is the count in the deck.
export const SHUFFLE_SHELL_COUNT = TAROT_DECK_SIZE;

/** Horizontal margin of the fan, in percent of the card field. */
export const FAN_MARGIN = 7;
/** Height of the fan's outer cards above the field's bottom edge, in percent. */
export const FAN_BASE = 12;
/** Where the washed pile gathers before it opens (percent from the bottom). */
const GATHER_BOTTOM = FAN_BASE + 9;

type RitualStyle = CSSProperties & Record<`--${string}`, string | number>;

export interface CasinoWashLayout {
  readonly washAX: number;
  readonly washAY: number;
  readonly washBX: number;
  readonly washBY: number;
  readonly washCX: number;
  readonly washCY: number;
  readonly rotationA: number;
  readonly rotationB: number;
  readonly rotationC: number;
  readonly fanLeft: number;
  readonly fanBottom: number;
  readonly fanRotation: number;
}

export interface CasinoPickTarget {
  readonly id: string;
  readonly displayName: string;
  readonly order: number;
  readonly placement: {
    readonly column: number;
    readonly row: number;
    readonly rotation: number;
    readonly layer: number;
  };
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

function noise(seed: number): number {
  return fractional(Math.sin(seed * 12.9898 + 78.233) * 43_758.5453);
}

/** A deterministic visual layout: every card receives three broad planar
 * wash destinations and one place in the final lower-screen fan. Randomness
 * used for the real draw lives exclusively in the tarot domain. */
export function casinoWashLayout(index: number, cycle = 0): CasinoWashLayout {
  if (!Number.isInteger(index) || index < 0 || index >= TAROT_DECK_SIZE)
    throw new RangeError(`Casino wash index must be between 0 and ${TAROT_DECK_SIZE - 1}`);
  const seed = index + cycle * 97;
  const angleA = noise(seed + 1) * Math.PI * 2;
  const angleB = angleA + Math.PI * (0.55 + noise(seed + 2) * 0.8);
  const angleC = angleB + Math.PI * (0.45 + noise(seed + 3) * 0.9);
  const radiusA = 12 + noise(seed + 4) * 31;
  const radiusB = 10 + noise(seed + 5) * 34;
  const radiusC = 11 + noise(seed + 6) * 32;
  const fanRatio = index / (TAROT_DECK_SIZE - 1);
  return {
    washAX: Math.cos(angleA) * radiusA,
    washAY: Math.sin(angleA) * radiusA * 0.58,
    washBX: Math.cos(angleB) * radiusB,
    washBY: Math.sin(angleB) * radiusB * 0.58,
    washCX: Math.cos(angleC) * radiusC,
    washCY: Math.sin(angleC) * radiusC * 0.58,
    rotationA: -95 + noise(seed + 7) * 190,
    rotationB: -120 + noise(seed + 8) * 240,
    rotationC: -105 + noise(seed + 9) * 210,
    // The arch keeps a margin on both sides (so its outer cards, tilted on
    // their bottom pivot, stay on a phone screen) and sits above the bottom
    // edge so the composition is balanced instead of hugging the floor.
    fanLeft: FAN_MARGIN + fanRatio * (100 - FAN_MARGIN * 2),
    fanBottom: FAN_BASE + Math.sin(fanRatio * Math.PI) * 7,
    fanRotation: -11 + fanRatio * 22,
  };
}

/** The grid the dealt spread will use, derived from the ceremony so the fan
 * can measure the real slots before any card identity exists. */
export function spreadLayoutFor(spread: {
  readonly id: string;
  readonly version: string;
  readonly positions: readonly CasinoPickTarget[];
}): { columns: number; rows: number; kind: string } {
  const columns = Math.max(...spread.positions.map(({ placement }) => placement.column), 0) + 1;
  const rows = Math.max(...spread.positions.map(({ placement }) => placement.row), 0) + 1;
  const name = `${spread.id} ${spread.version}`.toLowerCase();
  const kind = name.includes("celtic")
    ? "celtic-cross"
    : name.includes("horseshoe")
      ? "horseshoe"
      : columns === 1 && rows === 1
        ? "centered"
        : rows === 1
          ? "horizontal"
          : "legacy";
  return { columns, rows, kind };
}

const COUNT_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
] as const;

/** "A three-card spread: Situation · Challenge · Guidance" */
export function spreadAnnouncement(positions: readonly { displayName: string }[]): string {
  const count = COUNT_WORDS[positions.length] ?? String(positions.length);
  return `A ${count}-card spread: ${positions.map(({ displayName }) => displayName).join(" · ")}`;
}

/** A uniformly random index among `available`, from the browser's CSPRNG.
 * Selection indexes only choose among positions of the already-committed,
 * server-seeded permutation, so this never influences which cards exist. */
export function randomAvailableIndex(
  available: readonly number[],
  random: (buffer: Uint32Array) => Uint32Array = (buffer) => crypto.getRandomValues(buffer),
): number | undefined {
  if (available.length === 0) return undefined;
  const range = available.length;
  // Rejection sampling keeps every remaining card equally likely.
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const buffer = new Uint32Array(1);
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const value = random(buffer)[0]!;
    if (value < limit) return available[value % range];
  }
  return available[0];
}

/** The next index in `direction` that is not picked, or `from` itself. */
export function nextAvailableIndex(
  from: number,
  direction: number,
  picked: readonly number[],
  size = TAROT_DECK_SIZE,
): number {
  let candidate = from;
  for (let step = 0; step < size; step += 1) {
    candidate = Math.min(size - 1, Math.max(0, candidate + direction));
    if (!picked.includes(candidate)) return candidate;
    if (candidate === 0 || candidate === size - 1) break;
  }
  if (!picked.includes(from)) return from;
  // Search the other way when the edge was reached.
  candidate = from;
  for (let step = 0; step < size; step += 1) {
    candidate = Math.min(size - 1, Math.max(0, candidate - Math.sign(direction || 1)));
    if (!picked.includes(candidate)) return candidate;
    if (candidate === 0 || candidate === size - 1) break;
  }
  return from;
}

export function casinoFanIndex(clientX: number, surfaceLeft: number, surfaceWidth: number): number {
  if (![clientX, surfaceLeft, surfaceWidth].every(Number.isFinite) || surfaceWidth <= 0)
    throw new RangeError("Casino fan hit surface must have finite positive geometry");
  const ratio = Math.min(1, Math.max(0, (clientX - surfaceLeft) / surfaceWidth));
  return Math.round(ratio * (TAROT_DECK_SIZE - 1));
}

export function casinoPickTarget(
  position: CasinoPickTarget,
  positions: readonly CasinoPickTarget[],
): { left: number; bottom: number; rotation: number } {
  const columns = Math.max(...positions.map(({ placement }) => placement.column), 0) + 1;
  const rows = Math.max(...positions.map(({ placement }) => placement.row), 0) + 1;
  const horizontalRatio = columns === 1 ? 0.5 : position.placement.column / (columns - 1);
  const verticalRatio = rows === 1 ? 0.5 : position.placement.row / (rows - 1);
  const width = positions.length >= 8 ? 42 : positions.length >= 5 ? 38 : 30;
  return {
    left: 50 - width / 2 + horizontalRatio * width,
    bottom: 48 + (1 - verticalRatio) * (rows === 1 ? 0 : 26),
    rotation: position.placement.rotation,
  };
}

/** Resolve once every picked shell's flight (its transition and lift
 * animation) has finished, or after `maxWait` on a stalled renderer, so the
 * shells can be measured at rest. */
export async function awaitCasinoPickFlights(
  root: ParentNode = document,
  maxWait = 1_500,
): Promise<void> {
  const flights = [...root.querySelectorAll<HTMLElement>(".casino-card-shell.is-picked")].flatMap(
    (shell) => shell.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
  );
  if (flights.length === 0) return;
  await Promise.race([
    Promise.all(flights),
    new Promise<void>((resolve) => window.setTimeout(resolve, maxWait)),
  ]);
}

/** Where each picked shell currently sits on screen, keyed by the spread
 * position it was picked for. Measure before the deck unmounts so the dealt
 * cards can appear exactly where the reader placed their choices. */
export function measureCasinoPickHandoff(
  positions: readonly CasinoPickTarget[],
  root: ParentNode = document,
): CardHandoffOrigin[] | undefined {
  const origins: CardHandoffOrigin[] = [];
  for (const shell of root.querySelectorAll<HTMLElement>(".casino-card-shell.is-picked")) {
    const order = Number(shell.dataset["pickedOrder"]);
    const position = positions[order];
    if (!position) continue;
    const bounds = shell.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) continue;
    origins.push({
      positionId: position.id,
      centerX: bounds.left + bounds.width / 2,
      centerY: bounds.top + bounds.height / 2,
      // Layout size ignores the shell's rotation; the picked scale is applied
      // by CSS and shows in the bounding box, not the layout box.
      width: shell.offsetWidth * CASINO_PICK_SCALE,
      height: shell.offsetHeight * CASINO_PICK_SCALE,
    });
  }
  return origins.length === positions.length ? origins : undefined;
}

interface FieldTarget {
  readonly left: number;
  readonly bottom: number;
  readonly rotation: number;
}

/** Convert measured spread slots into the field-relative anchors the picked
 * shells use, so a pick lands exactly where the deal will settle. */
export function fieldTargetsForSlots(
  slots: readonly SpreadSlot[],
  positions: readonly CasinoPickTarget[],
  field: { left: number; bottom: number; width: number; height: number },
  shellHeight: number,
): Record<string, FieldTarget> | undefined {
  if (field.width <= 0 || field.height <= 0 || shellHeight <= 0) return undefined;
  // The picked scale grows the shell about a point near its bottom edge,
  // which lifts its visual center slightly above the layout center.
  const lift = (CASINO_PICK_SCALE - 1) * shellHeight * (0.92 - 0.5);
  const targets: Record<string, FieldTarget> = {};
  for (const position of positions) {
    const slot = slots.find(({ positionId }) => positionId === position.id);
    if (!slot) return undefined;
    targets[position.id] = {
      left: ((slot.centerX - field.left) / field.width) * 100,
      bottom: ((field.bottom - (slot.centerY + shellHeight / 2 - lift)) / field.height) * 100,
      rotation: position.placement.rotation,
    };
  }
  return targets;
}

function shellStyle(
  index: number,
  cycle: number,
  selectedOrder: number | undefined,
  positions: readonly CasinoPickTarget[],
  fieldTargets: Record<string, FieldTarget> | undefined,
  field: { width: number; height: number } | undefined,
): RitualStyle {
  const wash = casinoWashLayout(index, cycle);
  const targetPosition = selectedOrder === undefined ? undefined : positions[selectedOrder];
  const target = targetPosition
    ? (fieldTargets?.[targetPosition.id] ?? casinoPickTarget(targetPosition, positions))
    : undefined;
  const pickX = (target?.left ?? wash.fanLeft) - wash.fanLeft;
  const pickY = wash.fanBottom - (target?.bottom ?? wash.fanBottom);
  return {
    "--shell-index": index,
    "--wash-a-x": `${wash.washAX}vw`,
    "--wash-a-y": `${wash.washAY}vh`,
    "--wash-b-x": `${wash.washBX}vw`,
    "--wash-b-y": `${wash.washBY}vh`,
    "--wash-c-x": `${wash.washCX}vw`,
    "--wash-c-y": `${wash.washCY}vh`,
    "--wash-rotation-a": `${wash.rotationA}deg`,
    "--wash-rotation-b": `${wash.rotationB}deg`,
    "--wash-rotation-c": `${wash.rotationC}deg`,
    "--fan-left": `${wash.fanLeft}%`,
    "--fan-bottom": `${wash.fanBottom}%`,
    "--fan-rotation": `${wash.fanRotation}deg`,
    "--target-left": `${target?.left ?? wash.fanLeft}%`,
    "--target-bottom": `${target?.bottom ?? wash.fanBottom}%`,
    "--target-rotation": `${target?.rotation ?? wash.fanRotation}deg`,
    // The fan entrance is a transform from the fan anchor back to the two
    // piles it came from: center stage, then the gathered deck resting just
    // above the middle of where the arch will open.
    "--pile-x": `${50 - wash.fanLeft}cqw`,
    "--pile-y": `calc(${wash.fanBottom - 52}cqh + 50%)`,
    "--corner-x": `${50 - wash.fanLeft}cqw`,
    "--corner-y": `${wash.fanBottom - GATHER_BOTTOM}cqh`,
    "--picked-order": selectedOrder ?? -1,
    // The flight is a transform from the fan anchor. Once the field has been
    // measured, resolve it in pixels from that same measurement: WebKit can
    // resolve container units against a stale size when the target changes
    // during a resize, which leaves the card short of its slot.
    "--pick-x": field ? `${(pickX / 100) * field.width}px` : `${pickX}cqw`,
    "--pick-y": field ? `${(pickY / 100) * field.height}px` : `${pickY}cqh`,
  };
}

export function CasinoWashDeck({
  phase,
  positions,
  reducedMotion,
  selectedIndexes,
  slots,
  onFinishWash,
  onSelect,
  onStir,
  onDeselect,
  onConfirm,
  confirming = false,
}: {
  phase: "washing" | "selecting";
  positions: readonly CasinoPickTarget[];
  reducedMotion: boolean;
  selectedIndexes: readonly number[];
  /** The dealt spread's real slots, measured from a hidden copy of its grid.
   * Picked shells fly there; without it a proportional layout stands in. */
  slots?: readonly SpreadSlot[] | undefined;
  onFinishWash: () => void;
  onSelect: (index: number) => void;
  onStir?: () => void;
  /** Lets a picked card be put back into the fan until the reader confirms. */
  onDeselect?: (index: number) => void;
  /** When present, a full selection waits for an explicit "These are my
   * cards" instead of the caller locking it automatically. */
  onConfirm?: () => void;
  /** The confirmed selection is being kept; picks can no longer change. */
  confirming?: boolean;
}) {
  const [cycle, setCycle] = useState(0);
  const finishWash = useRef(onFinishWash);
  useEffect(() => {
    finishWash.current = onFinishWash;
  }, [onFinishWash]);
  const fieldRef = useRef<HTMLDivElement>(null);
  const [fieldBox, setFieldBox] = useState<{
    left: number;
    bottom: number;
    width: number;
    height: number;
    shellHeight: number;
  }>();
  const [fanOpened, setFanOpened] = useState(false);
  const [pointerHoveredIndex, setPointerHoveredIndex] = useState<number>();
  /** Touch: the card lifted by the first tap, taken by the second. */
  const [armedIndex, setArmedIndex] = useState<number>();
  const [focusIndex, setFocusIndex] = useState(0);
  const pendingFocus = useRef(false);
  const pointerStart = useRef<
    { pointerId: number; y: number; index: number; pointerType: string } | undefined
  >(undefined);
  const suppressSurfaceClick = useRef(false);
  const instructionsId = useId();
  const washFinished = useRef(false);

  useEffect(() => {
    if (phase === "selecting") preload(CASINO_CARD_BACK_AVIF, { as: "image", type: "image/avif" });
  }, [phase]);

  const completeWash = () => {
    if (washFinished.current) return;
    washFinished.current = true;
    finishWash.current();
  };

  // The wash is one continuous scene: the pile scatters, re-stacks, and the
  // stacked deck is handed straight to the fan. "Keep shuffling" restarts it.
  useEffect(() => {
    if (phase !== "washing") return;
    washFinished.current = false;
    const timer = window.setTimeout(
      () => {
        if (washFinished.current) return;
        washFinished.current = true;
        finishWash.current();
      },
      reducedMotion
        ? motionTiming.quietWashHold
        : motionTiming.washHold +
            motionTiming.wash +
            (SHUFFLE_SHELL_COUNT - 1) * motionTiming.washStagger +
            motionTiming.stack,
    );
    return () => window.clearTimeout(timer);
  }, [cycle, phase, reducedMotion]);

  // The field's box is external layout state: observing it reports the
  // initial size at once and again whenever the viewport changes.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (phase !== "selecting" || !field) return;
    const observer = new ResizeObserver(() => {
      const rect = field.getBoundingClientRect();
      const shell = field.querySelector<HTMLElement>(".casino-card-shell");
      setFieldBox({
        left: rect.left,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        shellHeight: shell?.offsetHeight ?? 0,
      });
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [phase]);
  const fieldTargets = useMemo(
    () =>
      phase === "selecting" && slots && fieldBox
        ? fieldTargetsForSlots(slots, positions, fieldBox, fieldBox.shellHeight)
        : undefined,
    [fieldBox, phase, positions, slots],
  );

  useEffect(() => {
    if (phase !== "selecting" || reducedMotion) return;
    const timer = window.setTimeout(
      () => setFanOpened(true),
      motionTiming.gather + motionTiming.fan + (TAROT_DECK_SIZE - 1) * motionTiming.fanStagger,
    );
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);
  const fanReady = phase === "selecting" && (reducedMotion || fanOpened);
  const selectionFull = selectedIndexes.length >= positions.length;
  const canReturn = Boolean(onDeselect) && fanReady && !confirming;

  // After a pick, keyboard focus continues at the next card still in the fan.
  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    const button = fieldRef.current?.querySelector<HTMLButtonElement>(
      `[data-card-index="${focusIndex}"]`,
    );
    if (button && !button.disabled) button.focus();
  }, [focusIndex, selectedIndexes]);

  const select = (index: number) => {
    if (!fanReady || selectedIndexes.includes(index) || selectionFull || confirming) return;
    setArmedIndex(undefined);
    const picked = [...selectedIndexes, index];
    const next = nextAvailableIndex(index, 1, picked);
    const active = document.activeElement;
    if (active instanceof HTMLElement && fieldRef.current?.contains(active))
      pendingFocus.current = true;
    setFocusIndex(next);
    onSelect(index);
  };

  const chooseForMe = () => {
    const available = Array.from({ length: TAROT_DECK_SIZE }, (_, index) => index).filter(
      (index) => !selectedIndexes.includes(index),
    );
    const index = randomAvailableIndex(available);
    if (index !== undefined) select(index);
  };

  const surfaceIndex = (clientX: number, surface: HTMLDivElement) => {
    const bounds = surface.getBoundingClientRect();
    return casinoFanIndex(clientX, bounds.left, bounds.width);
  };

  const moveFocus = (target: number, direction: number) => {
    const clamped = Math.min(TAROT_DECK_SIZE - 1, Math.max(0, target));
    const index = selectedIndexes.includes(clamped)
      ? nextAvailableIndex(clamped, direction, selectedIndexes)
      : clamped;
    pendingFocus.current = true;
    setFocusIndex(index);
  };

  const handleFanKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!fanReady) return;
    const offsets: Record<string, [number, number]> = {
      ArrowRight: [focusIndex + 1, 1],
      ArrowDown: [focusIndex + 1, 1],
      ArrowLeft: [focusIndex - 1, -1],
      ArrowUp: [focusIndex - 1, -1],
      PageDown: [focusIndex + 10, 1],
      PageUp: [focusIndex - 10, -1],
      Home: [0, 1],
      End: [TAROT_DECK_SIZE - 1, -1],
    };
    const move = offsets[event.key];
    if (!move) return;
    event.preventDefault();
    moveFocus(move[0], move[1]);
  };

  const currentPosition = positions[selectedIndexes.length];
  const prompt = !fanReady
    ? "Gathering the deck into a fan…"
    : selectionFull
      ? onConfirm
        ? confirming
          ? "Keeping your chosen cards…"
          : "These are your cards. Tap one to put it back, or keep them."
        : "Keeping your chosen cards…"
      : `Choose the card for ${currentPosition?.displayName ?? `position ${selectedIndexes.length + 1}`} (${selectedIndexes.length + 1} of ${positions.length})`;
  const tabStop = selectedIndexes.includes(focusIndex)
    ? nextAvailableIndex(focusIndex, 1, selectedIndexes)
    : focusIndex;

  return (
    <div
      className={`casino-wash-deck is-${phase} ${fanReady ? "is-ready" : ""} ${
        reducedMotion ? "motion-off" : ""
      } ${canReturn ? "can-return" : ""}`}
      data-selected-count={selectedIndexes.length}
      data-testid="casino-wash-deck"
    >
      <div
        aria-describedby={phase === "selecting" ? instructionsId : undefined}
        aria-hidden={phase === "washing"}
        aria-label={phase === "selecting" ? prompt : undefined}
        className="casino-card-field"
        onKeyDown={phase === "selecting" ? handleFanKeyDown : undefined}
        ref={fieldRef}
        role={phase === "selecting" ? "group" : undefined}
      >
        {Array.from(
          { length: phase === "washing" ? SHUFFLE_SHELL_COUNT : TAROT_DECK_SIZE },
          (_, index) => {
            const selectedOrder = selectedIndexes.indexOf(index);
            const selected = selectedOrder >= 0;
            const style = shellStyle(
              index,
              cycle,
              selected ? selectedOrder : undefined,
              positions,
              fieldTargets,
              fieldTargets ? fieldBox : undefined,
            );
            if (phase === "washing")
              return <i className="casino-card-shell" key={`${cycle}-${index}`} style={style} />;
            const positionName =
              positions[selectedOrder]?.displayName ?? `position ${selectedOrder + 1}`;
            return (
              <button
                aria-label={
                  selected
                    ? canReturn
                      ? `Card ${index + 1}, chosen for ${positionName}. Put it back`
                      : `Card ${index + 1} selected for ${positionName}`
                    : `Choose face-down card ${index + 1}`
                }
                className={`casino-card-shell ${selected ? "is-picked" : ""} ${
                  pointerHoveredIndex === index ? "is-pointer-hovered" : ""
                } ${armedIndex === index ? "is-armed" : ""}`}
                data-card-index={index}
                data-picked-order={selected ? selectedOrder : undefined}
                disabled={selected ? !canReturn : !fanReady || selectionFull || confirming}
                key={index}
                onClick={() => {
                  if (selected) {
                    if (canReturn) onDeselect?.(index);
                    return;
                  }
                  select(index);
                }}
                onFocus={() => {
                  if (!selected) setFocusIndex(index);
                }}
                style={style}
                tabIndex={!selected && index === tabStop ? 0 : -1}
                type="button"
              />
            );
          },
        )}
        {phase === "selecting" && (
          <div
            aria-hidden="true"
            className="casino-fan-hit-surface"
            data-testid="casino-fan-hit-surface"
            onClick={(event) => {
              if (!fanReady) return;
              if (suppressSurfaceClick.current) {
                suppressSurfaceClick.current = false;
                return;
              }
              select(surfaceIndex(event.clientX, event.currentTarget));
            }}
            onPointerCancel={() => {
              pointerStart.current = undefined;
              suppressSurfaceClick.current = false;
              setPointerHoveredIndex(undefined);
            }}
            onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
              if (!event.isPrimary || !fanReady) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              const index = surfaceIndex(event.clientX, event.currentTarget);
              pointerStart.current = {
                pointerId: event.pointerId,
                y: event.clientY,
                index,
                pointerType: event.pointerType,
              };
              if (event.pointerType !== "mouse") setPointerHoveredIndex(index);
            }}
            onPointerLeave={() => setPointerHoveredIndex(undefined)}
            onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
              if (!fanReady) return;
              // Touch browses only while pressed; a mouse browses on hover.
              if (event.pointerType !== "mouse" && !pointerStart.current) return;
              const index = surfaceIndex(event.clientX, event.currentTarget);
              setPointerHoveredIndex((current) => (current === index ? current : index));
            }}
            onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
              const start = pointerStart.current;
              pointerStart.current = undefined;
              if (start?.pointerId !== event.pointerId) return;
              // A flick upward takes the card it started on, on any pointer.
              if (start.y - event.clientY >= 28) {
                suppressSurfaceClick.current = true;
                setPointerHoveredIndex(undefined);
                select(start.index);
                return;
              }
              if (start.pointerType === "mouse") return;
              // Touch and pen: the first release lifts a card, a second tap on
              // that same card takes it — no accidental picks while browsing.
              suppressSurfaceClick.current = true;
              const index = surfaceIndex(event.clientX, event.currentTarget);
              setPointerHoveredIndex(undefined);
              if (armedIndex !== undefined && Math.abs(armedIndex - index) <= 1) select(armedIndex);
              else setArmedIndex(selectedIndexes.includes(index) ? undefined : index);
            }}
          />
        )}
      </div>

      {phase === "washing" ? (
        <div className="casino-wash-actions">
          <p aria-live="polite" className="casino-pick-progress" role="status">
            <strong>{spreadAnnouncement(positions)}</strong>
            <span>Shuffling the deck…</span>
          </p>
          <div className="casino-wash-choices">
            <button
              className="ritual-action is-quiet"
              data-testid="immersive-shuffle-deck"
              onClick={() => {
                washFinished.current = false;
                setCycle((current) => current + 1);
                onStir?.();
              }}
              type="button"
            >
              Keep shuffling
            </button>
            <button className="ritual-action" onClick={completeWash} type="button">
              I’m ready to draw
            </button>
          </div>
        </div>
      ) : (
        <div className="casino-select-actions">
          <p aria-live="polite" className="casino-pick-progress" role="status">
            <strong>{prompt}</strong>
            {fanReady && !selectionFull && (
              <span className="casino-pick-hint">
                <span className="casino-pick-hint--coarse">
                  {armedIndex === undefined
                    ? "Slide along the fan, then tap a card twice to take it"
                    : "Tap the lifted card again to take it"}
                </span>
                <span className="casino-pick-hint--fine">
                  Click a card to take it · arrow keys browse the fan
                </span>
              </span>
            )}
          </p>
          <p className="sr-only" id={instructionsId}>
            Use the arrow keys, Page Up, Page Down, Home, and End to move through the face-down
            cards. Press Enter or Space to take a card.
          </p>
          {fanReady && (
            <div className="casino-select-buttons">
              {!selectionFull && (
                <button
                  className="ritual-action is-quiet"
                  disabled={confirming}
                  onClick={chooseForMe}
                  type="button"
                >
                  Choose for me
                </button>
              )}
              {onConfirm && selectionFull && (
                <button
                  className="ritual-action"
                  data-testid="confirm-selected-cards"
                  disabled={confirming}
                  onClick={onConfirm}
                  type="button"
                >
                  {confirming ? "Keeping your cards…" : "These are my cards"}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
