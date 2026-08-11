import type { SafetyCategory } from "@starguidance/ai";
import type {
  FollowUpResult,
  QuestionClassification,
  ReadingEntitlementDecision,
  ReadingOutputProvenance,
  ReadingResult,
  StoredRitualProgress,
} from "@starguidance/contracts";
import type { LockedDraw, TarotArtwork } from "@starguidance/tarot-domain";

export interface DealtCardView {
  cardId: string;
  name: string;
  orientation: "upright" | "reversed";
  themes: readonly string[];
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
  questionClassification: QuestionClassification;
  entitlementDecision: ReadingEntitlementDecision;
  ritualProgress?: StoredRitualProgress;
  expiresAt: string;
  sessionExpired: boolean;
  /** The category `classifyQuestion()` (@starguidance/ai) assigned at creation. */
  safetyClassification?: SafetyCategory;
  followUps: { id: string; result: FollowUpResult }[];
  followUpLimit: number;
  followUpsRemaining: number;
  feedbackSubmitted: boolean;
  createdAt: string;
}
