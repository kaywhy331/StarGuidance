import type { SafetyCategory } from "@starguidance/ai";
import type {
  FollowUpResult,
  ReadingOutputProvenance,
  ReadingResult,
} from "@starguidance/contracts";
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
  outputProvenance?: ReadingOutputProvenance;
  generationStatus: "pending" | "ready" | "failed";
  /** The category `classifyQuestion()` (@starguidance/ai) assigned at creation. */
  safetyClassification?: SafetyCategory;
  followUps: { id: string; result: FollowUpResult }[];
}
