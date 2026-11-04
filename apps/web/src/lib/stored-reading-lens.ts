import "server-only";

import { readingLensStatements } from "@starguidance/ai";
import type { ProfileSnapshot } from "@starguidance/contracts";
import type { StoredReading } from "@starguidance/database";

import type { RequestPersistence } from "./persistence";

/** The immutable profile snapshot an account reading was drawn against. A
 * saved guest reading has none. */
export async function storedReadingSnapshot(
  persistence: RequestPersistence,
  userId: string,
  reading: Pick<StoredReading, "profileSnapshotId">,
): Promise<ProfileSnapshot | undefined> {
  if (!reading.profileSnapshotId) return undefined;
  return (await persistence.repositories.profileSnapshots.get(userId, reading.profileSnapshotId))
    ?.snapshot;
}

/**
 * The private lens statements a stored reading may give its narrator. Account
 * readings select traits from their snapshot; a saved guest reading keeps the
 * birthday statements it was read with. Pure Tarot uses none.
 */
export function storedReadingLensStatements(
  reading: Pick<StoredReading, "configuration" | "readingLens" | "source">,
  snapshot: Pick<ProfileSnapshot, "traits" | "tensions"> | undefined,
): readonly string[] {
  if (reading.configuration.personalizationMode !== "personalized_tarot") return [];
  if (reading.source === "guest_trial") return reading.readingLens.statements ?? [];
  return snapshot
    ? readingLensStatements(reading.readingLens, snapshot.traits, snapshot.tensions)
    : [];
}
