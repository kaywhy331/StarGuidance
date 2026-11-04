import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";

import type { DrawAssignment, LockedDraw, ReversalMode, Spread, TarotCard } from "./types";

export const SHUFFLE_VERSION = "fisher-yates-csprng-v1" as const;
export const COMMITTED_SHUFFLE_VERSION = "fisher-yates-committed-v2" as const;
export const USER_PICK_SHUFFLE_VERSION = "fisher-yates-committed-user-pick-v3" as const;
export const DRAW_ENTROPY_VERSION = "hmac-sha256-domain-stream-v1" as const;
export const DRAW_SEED_BYTES = 32;

type SecureRandomInt = (maximumExclusive: number) => number;

const systemRandomInt: SecureRandomInt = (maximumExclusive) => randomInt(maximumExclusive);

function canonicalBytes(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error(`${label} must be canonical base64url`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== DRAW_SEED_BYTES || decoded.toString("base64url") !== value)
    throw new Error(`${label} must encode exactly ${DRAW_SEED_BYTES} bytes`);
  return decoded;
}

function digest(domain: string, value: Buffer): string {
  return createHash("sha256")
    .update(`starguidance:${domain}:v1\0`, "utf8")
    .update(value)
    .digest("base64url");
}

/** Creates the secret half of a pre-shuffle commitment. Never expose this value. */
export function createDrawServerSeed(): string {
  return randomBytes(DRAW_SEED_BYTES).toString("base64url");
}

/** Public commitment that can be displayed before the ritual begins. */
export function commitDrawServerSeed(serverSeed: string): string {
  return digest("tarot-server-seed", canonicalBytes(serverSeed, "serverSeed"));
}

export function hashDrawClientNonce(clientNonce: string): string {
  return digest("tarot-client-nonce", canonicalBytes(clientNonce, "clientNonce"));
}

function deriveStreamKey(input: {
  serverSeed: Buffer;
  clientNonce: Buffer;
  sessionId: string;
  deckVersion: string;
  spreadId: string;
  spreadVersion: string;
  domain: "shuffle" | "orientation";
}): Buffer {
  const context = [
    DRAW_ENTROPY_VERSION,
    input.domain,
    input.sessionId,
    input.deckVersion,
    input.spreadId,
    input.spreadVersion,
    input.clientNonce.toString("base64url"),
  ].join("\0");
  return createHmac("sha256", input.serverSeed).update(context, "utf8").digest();
}

/**
 * Deterministic HMAC stream with rejection sampling. The rejection boundary
 * removes modulo bias, so it is safe to drive Fisher-Yates for any deck size.
 */
function streamRandomInt(key: Buffer): SecureRandomInt {
  let counter = 0;
  let block = Buffer.alloc(0);
  let offset = 0;
  const nextUint32 = () => {
    if (offset + 4 > block.length) {
      const encodedCounter = Buffer.alloc(8);
      encodedCounter.writeBigUInt64BE(BigInt(counter));
      counter += 1;
      block = createHmac("sha256", key)
        .update("starguidance:tarot-random-stream:v1\0", "utf8")
        .update(encodedCounter)
        .digest();
      offset = 0;
    }
    const value = block.readUInt32BE(offset);
    offset += 4;
    return value;
  };
  return (maximumExclusive) => {
    if (!Number.isSafeInteger(maximumExclusive) || maximumExclusive <= 0)
      throw new Error("Random bound must be a positive safe integer");
    const range = 0x1_0000_0000;
    const accepted = Math.floor(range / maximumExclusive) * maximumExclusive;
    let value = nextUint32();
    while (value >= accepted) value = nextUint32();
    return value % maximumExclusive;
  };
}

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
    assignments: Object.freeze(assignments.map((assignment) => Object.freeze(assignment))),
    lockedAt: (input.now ?? new Date()).toISOString(),
  });
}

/**
 * Finalizes a draw only after the client ritual supplies its nonce and cut.
 * Question, profile, payment, classifier, meanings, and AI data are
 * deliberately absent from this signature, making them impossible selection
 * inputs at the domain boundary.
 */
export function finalizeCommittedDraw(input: {
  readonly cards: readonly TarotCard[];
  readonly deckVersion: string;
  readonly spread: Spread;
  readonly sessionId: string;
  readonly serverSeed: string;
  readonly serverSeedCommitment: string;
  readonly clientNonce: string;
  readonly cutIndex: number;
  readonly selectedIndexes?: readonly number[];
  readonly reversalMode: ReversalMode;
  readonly now?: Date;
}): LockedDraw {
  if (new Set(input.cards.map((card) => card.id)).size !== input.cards.length)
    throw new Error("Deck contains duplicate card IDs");
  if (input.spread.positions.length > input.cards.length)
    throw new Error("Spread exceeds deck size");
  if (
    !Number.isInteger(input.cutIndex) ||
    input.cutIndex < 0 ||
    input.cutIndex >= input.cards.length
  )
    throw new Error("Cut index must be within the deck");
  const selectedIndexes =
    input.selectedIndexes ?? input.spread.positions.map((_, positionIndex) => positionIndex);
  if (selectedIndexes.length !== input.spread.positions.length)
    throw new Error("Selected card count must match the spread");
  if (
    new Set(selectedIndexes).size !== selectedIndexes.length ||
    selectedIndexes.some(
      (selectedIndex) =>
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= input.cards.length,
    )
  )
    throw new Error("Selected card positions must be unique and within the deck");

  const serverSeed = canonicalBytes(input.serverSeed, "serverSeed");
  const clientNonce = canonicalBytes(input.clientNonce, "clientNonce");
  if (commitDrawServerSeed(input.serverSeed) !== input.serverSeedCommitment)
    throw new Error("Server seed does not match its pre-shuffle commitment");

  const common = {
    serverSeed,
    clientNonce,
    sessionId: input.sessionId,
    deckVersion: input.deckVersion,
    spreadId: input.spread.id,
    spreadVersion: input.spread.version,
  };
  const shuffled = secureShuffle(
    input.cards,
    streamRandomInt(deriveStreamKey({ ...common, domain: "shuffle" })),
  );
  const cutDeck =
    input.cutIndex === 0
      ? shuffled
      : [...shuffled.slice(input.cutIndex), ...shuffled.slice(0, input.cutIndex)];
  const orientationRandom = streamRandomInt(deriveStreamKey({ ...common, domain: "orientation" }));
  const assignments: DrawAssignment[] = input.spread.positions.map((position, order) => ({
    positionId: position.id,
    cardId: (cutDeck[selectedIndexes[order] as number] as TarotCard).id,
    orientation:
      input.reversalMode === "reversals_enabled" &&
      input.spread.allowReversals &&
      orientationRandom(2) === 1
        ? "reversed"
        : "upright",
    order,
  }));

  return Object.freeze({
    id: input.sessionId,
    deckVersion: input.deckVersion,
    spreadId: input.spread.id,
    spreadVersion: input.spread.version,
    shuffleVersion: input.selectedIndexes ? USER_PICK_SHUFFLE_VERSION : COMMITTED_SHUFFLE_VERSION,
    assignments: Object.freeze(assignments.map((assignment) => Object.freeze(assignment))),
    proof: Object.freeze({
      entropyVersion: DRAW_ENTROPY_VERSION,
      serverSeedCommitment: input.serverSeedCommitment,
      clientNonceHash: hashDrawClientNonce(input.clientNonce),
      cutIndex: input.cutIndex,
      reversalMode: input.reversalMode,
      ...(input.selectedIndexes
        ? { selectedIndexes: Object.freeze([...input.selectedIndexes]) }
        : {}),
    }),
    lockedAt: (input.now ?? new Date()).toISOString(),
  });
}

export function retryLockedDraw(draw: LockedDraw): LockedDraw {
  return draw;
}

export function createFollowUpLineage(draw: LockedDraw, followUpId: string) {
  return Object.freeze({ followUpId, readingId: draw.id, draw });
}
