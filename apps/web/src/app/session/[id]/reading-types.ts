import type { SafetyCategory } from "@starguidance/ai";
import type {
  FollowUpResult,
  QuestionClassification,
  ReadingEntitlementDecision,
  ReadingOutputProvenance,
  ReadingResult,
  ReadingConfiguration,
  StoredRitualProgress,
} from "@starguidance/contracts";
import type { LockedDraw, TarotArtwork } from "@starguidance/tarot-domain";

export interface DealtCardView {
  cardId: string;
  name: string;
  orientation: "upright" | "reversed";
  themes: readonly string[];
  baselineMeaning: string;
  positionId: string;
  positionName: string;
  positionDescription: string;
  placement: {
    column: number;
    row: number;
    rotation: number;
    layer: number;
  };
  spreadLayout: {
    columns: number;
    rows: number;
    kind: string;
  };
  artwork: TarotArtwork;
}

export interface ReadingPersonalization {
  lensVersion: string;
  snapshotVersion: number;
  completeness: "core" | "locationEnhanced" | "complete";
  traits: readonly {
    domain: string;
    sourceSystem: string;
    stability: "stable" | "uncertain" | "unavailable";
    confidence: "low" | "medium" | "high";
    calculationVersion: string;
  }[];
  tensionCount: number;
  rawBirthDataSharedWithNarrator: false;
}

export interface ReadingPayload {
  id: string;
  /** Decrypted only for the owning reader so the ritual can return their
   * private question to them. It is never placed in a URL or analytics. */
  question: string;
  /** The immutable profile snapshot this reading was drawn against. */
  profileSnapshotId: string;
  personalization?: ReadingPersonalization;
  draw: LockedDraw;
  configuration: ReadingConfiguration;
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
  outcomeFeedbackSubmitted: boolean;
  createdAt: string;
}
