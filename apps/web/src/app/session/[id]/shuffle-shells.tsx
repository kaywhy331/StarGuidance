"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

export const TAROT_DECK_SIZE = 78;
export const SHUFFLE_SHELL_COUNT = TAROT_DECK_SIZE;

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
    fanLeft: 4 + fanRatio * 92,
    fanBottom: 3.5 + Math.sin(fanRatio * Math.PI) * 8,
    fanRotation: -13 + fanRatio * 26,
  };
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

function shellStyle(
  index: number,
  cycle: number,
  selectedOrder: number | undefined,
  positions: readonly CasinoPickTarget[],
): RitualStyle {
  const wash = casinoWashLayout(index, cycle);
  const targetPosition = selectedOrder === undefined ? undefined : positions[selectedOrder];
  const target = targetPosition ? casinoPickTarget(targetPosition, positions) : undefined;
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
    "--picked-order": selectedOrder ?? -1,
  };
}

export function CasinoWashDeck({
  phase,
  positions,
  reducedMotion,
  selectedIndexes,
  onFinishWash,
  onSelect,
  onStir,
}: {
  phase: "washing" | "selecting";
  positions: readonly CasinoPickTarget[];
  reducedMotion: boolean;
  selectedIndexes: readonly number[];
  onFinishWash: () => void;
  onSelect: (index: number) => void;
  onStir?: () => void;
}) {
  const [cycle, setCycle] = useState(0);
  const [fanOpened, setFanOpened] = useState(false);
  const [pointerHoveredIndex, setPointerHoveredIndex] = useState<number>();
  const pointerStart = useRef<{ pointerId: number; y: number; index: number } | undefined>(
    undefined,
  );
  const suppressSurfaceClick = useRef(false);

  useEffect(() => {
    if (phase !== "selecting" || reducedMotion) return;
    const timer = window.setTimeout(() => setFanOpened(true), 1_850);
    return () => window.clearTimeout(timer);
  }, [phase, reducedMotion]);
  const fanReady = phase === "selecting" && (reducedMotion || fanOpened);

  const select = (index: number) => {
    if (!fanReady || selectedIndexes.includes(index) || selectedIndexes.length >= positions.length)
      return;
    onSelect(index);
  };

  const surfaceIndex = (clientX: number, surface: HTMLDivElement) => {
    const bounds = surface.getBoundingClientRect();
    return casinoFanIndex(clientX, bounds.left, bounds.width);
  };

  return (
    <div
      aria-label={phase === "washing" ? "Casino wash shuffle" : "Choose cards from the fan"}
      className={`casino-wash-deck is-${phase} ${fanReady ? "is-ready" : ""} ${
        reducedMotion ? "motion-off" : ""
      }`}
      data-selected-count={selectedIndexes.length}
      data-testid="casino-wash-deck"
    >
      <div aria-hidden={phase === "washing"} className="casino-card-field">
        {Array.from({ length: TAROT_DECK_SIZE }, (_, index) => {
          const selectedOrder = selectedIndexes.indexOf(index);
          const selected = selectedOrder >= 0;
          const style = shellStyle(index, cycle, selected ? selectedOrder : undefined, positions);
          if (phase === "washing")
            return <i className="casino-card-shell" key={index} style={style} />;
          return (
            <button
              aria-label={
                selected
                  ? `Card ${index + 1} selected for ${positions[selectedOrder]?.displayName ?? `position ${selectedOrder + 1}`}`
                  : `Choose face-down card ${index + 1}`
              }
              className={`casino-card-shell ${selected ? "is-picked" : ""} ${
                pointerHoveredIndex === index ? "is-pointer-hovered" : ""
              }`}
              data-card-index={index}
              disabled={!fanReady || selected || selectedIndexes.length >= positions.length}
              key={index}
              onClick={() => {
                select(index);
              }}
              style={style}
              type="button"
            />
          );
        })}
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
            }}
            onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
              if (!event.isPrimary || !fanReady) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              pointerStart.current = {
                pointerId: event.pointerId,
                y: event.clientY,
                index: surfaceIndex(event.clientX, event.currentTarget),
              };
            }}
            onPointerLeave={() => setPointerHoveredIndex(undefined)}
            onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
              if (!fanReady) return;
              const index = surfaceIndex(event.clientX, event.currentTarget);
              setPointerHoveredIndex((current) => (current === index ? current : index));
            }}
            onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
              const start = pointerStart.current;
              pointerStart.current = undefined;
              if (start?.pointerId === event.pointerId && start.y - event.clientY >= 28) {
                suppressSurfaceClick.current = true;
                select(start.index);
              }
            }}
          />
        )}
      </div>

      {phase === "washing" ? (
        <div className="casino-wash-actions">
          <button
            aria-label="Stir all 78 cards"
            className="casino-stir-surface"
            data-testid="immersive-shuffle-deck"
            onClick={() => {
              setCycle((current) => current + 1);
              onStir?.();
            }}
            type="button"
          >
            <span>Wash again</span>
          </button>
          <button className="casino-gather-action" onClick={onFinishWash} type="button">
            Gather the cards
          </button>
        </div>
      ) : (
        <p aria-live="polite" className="casino-pick-progress">
          {fanReady
            ? `Choose card ${Math.min(selectedIndexes.length + 1, positions.length)} of ${positions.length}`
            : "The deck is gathering and opening into a fan…"}
        </p>
      )}
    </div>
  );
}
