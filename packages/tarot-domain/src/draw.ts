import { randomInt, randomUUID } from "node:crypto";

import type { DrawAssignment, LockedDraw, Spread, TarotCard } from "./types";

export const SHUFFLE_VERSION = "fisher-yates-csprng-v1" as const;

type SecureRandomInt = (maximumExclusive: number) => number;

const systemRandomInt: SecureRandomInt = (maximumExclusive) => randomInt(maximumExclusive);

export function secureShuffle<T>(
  items: readonly T[],
  random: SecureRandomInt = systemRandomInt,
): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random(index + 1);
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex] as T;
    shuffled[swapIndex] = current as T;
  }
  return shuffled;
}

export function createLockedDraw(input: {
  readonly cards: readonly TarotCard[];
  readonly deckVersion: string;
  readonly spread: Spread;
  readonly profileSnapshotId: string;
  readonly now?: Date;
  readonly id?: string;
  readonly random?: SecureRandomInt;
}): LockedDraw {
  if (new Set(input.cards.map((card) => card.id)).size !== input.cards.length) {
    throw new Error("Deck contains duplicate card IDs");
  }
  if (input.spread.positions.length > input.cards.length)
    throw new Error("Spread exceeds deck size");

  const random = input.random ?? systemRandomInt;
  const shuffled = secureShuffle(input.cards, random);
  const assignments: DrawAssignment[] = input.spread.positions.map((position, order) => ({
    positionId: position.id,
    cardId: (shuffled[order] as TarotCard).id,
    orientation: input.spread.allowReversals && random(2) === 1 ? "reversed" : "upright",
    order,
  }));

  return Object.freeze({
    id: input.id ?? randomUUID(),
    deckVersion: input.deckVersion,
    spreadId: input.spread.id,
    spreadVersion: input.spread.version,
    shuffleVersion: SHUFFLE_VERSION,
    profileSnapshotId: input.profileSnapshotId,
    assignments: Object.freeze(assignments.map((assignment) => Object.freeze(assignment))),
    lockedAt: (input.now ?? new Date()).toISOString(),
  });
}

export function retryLockedDraw(draw: LockedDraw): LockedDraw {
  return draw;
}

export function createFollowUpLineage(draw: LockedDraw, followUpId: string) {
  return Object.freeze({ followUpId, readingId: draw.id, draw });
}
