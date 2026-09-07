"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Viewport-space box of a card as the reader last saw it. Positions are
 * matched by spread position id, never by card identity, so the handoff can
 * only ever move artwork that the server already locked. */
export interface CardHandoffOrigin {
  readonly positionId: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

export interface FlipBox {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
}

export interface FlipDelta {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

const FLIP_X = "--stage-flip-x";
const FLIP_Y = "--stage-flip-y";
const FLIP_SCALE = "--stage-flip-scale";
const FLIP_START_CLASS = "is-flip-start";

export function flipBox(rect: DOMRect): FlipBox {
  return {
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    width: rect.width,
  };
}

/** The transform that makes `after` look exactly like `before`. Transitioning
 * it back to identity is one continuous glide between the two layouts. */
export function flipDelta(before: FlipBox, after: FlipBox): FlipDelta {
  const scale = after.width > 0 && before.width > 0 ? before.width / after.width : 1;
  return { x: before.centerX - after.centerX, y: before.centerY - after.centerY, scale };
}

export function flipIsNoticeable({ x, y, scale }: FlipDelta): boolean {
  return Math.abs(x) >= 0.5 || Math.abs(y) >= 0.5 || Math.abs(scale - 1) >= 0.005;
}

function setFlip(element: HTMLElement, delta: FlipDelta) {
  element.style.setProperty(FLIP_X, `${delta.x}px`);
  element.style.setProperty(FLIP_Y, `${delta.y}px`);
  element.style.setProperty(FLIP_SCALE, String(delta.scale));
}

function clearFlip(element: HTMLElement) {
  element.style.removeProperty(FLIP_X);
  element.style.removeProperty(FLIP_Y);
  element.style.removeProperty(FLIP_SCALE);
}

/** Jump an in-flight stage glide to its resting layout. The cinematic reveal
 * measures card geometry; a moving stage would send the focused card to the
 * wrong center. */
export function settleStageFlip(stage: HTMLElement | null | undefined) {
  if (!stage) return;
  stage.classList.add(FLIP_START_CLASS);
  clearFlip(stage);
  void stage.getBoundingClientRect();
  stage.classList.remove(FLIP_START_CLASS);
}

/** Whenever `layoutKey` changes, keep the stage visually where it was and let
 * its transform transition carry it to the new layout. Interrupted glides
 * continue from wherever they are. */
export function useStageFlip(
  stageRef: RefObject<HTMLElement | null>,
  layoutKey: string,
  enabled: boolean,
) {
  const lastBox = useRef<FlipBox | undefined>(undefined);
  const lastKey = useRef(layoutKey);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const keyChanged = lastKey.current !== layoutKey;
    lastKey.current = layoutKey;
    if (!keyChanged || !enabled || !lastBox.current) return;
    settleStageFlip(stage);
    const delta = flipDelta(lastBox.current, flipBox(stage.getBoundingClientRect()));
    if (!flipIsNoticeable(delta)) return;
    stage.classList.add(FLIP_START_CLASS);
    setFlip(stage, delta);
    void stage.getBoundingClientRect();
    stage.classList.remove(FLIP_START_CLASS);
    clearFlip(stage);
  }, [enabled, layoutKey, stageRef]);

  // Runs after the glide above so it records how the stage currently looks,
  // which is the right origin if the next layout change interrupts a glide.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    lastBox.current = flipBox(stage.getBoundingClientRect());
  });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const record = () => {
      lastBox.current = flipBox(stage.getBoundingClientRect());
    };
    const settled = (event: TransitionEvent) => {
      if (event.target === stage && event.propertyName === "transform") record();
    };
    window.addEventListener("resize", record);
    stage.addEventListener("transitionend", settled);
    return () => {
      window.removeEventListener("resize", record);
      stage.removeEventListener("transitionend", settled);
    };
  }, [stageRef]);
}
