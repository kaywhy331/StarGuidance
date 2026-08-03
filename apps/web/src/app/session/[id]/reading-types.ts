import type { ReadingResult } from "@starguidance/contracts";
import type { LockedDraw, TarotArtwork } from "@starguidance/tarot-domain";

export interface DealtCardView {
  cardId: string;
  name: string;
  orientation: "upright" | "reversed";
  positionId: string;
  positionName: string;
  artwork: TarotArtwork;
}

export interface ReadingPayload {
  id: string;
  /** The immutable profile snapshot this reading was drawn against. */
  profileSnapshotId: string;
  draw: LockedDraw;
  cards: DealtCardView[];
  result?: ReadingResult;
  generationStatus: "pending" | "ready" | "failed";
  followUps: { id: string; result: ReadingResult }[];
}
