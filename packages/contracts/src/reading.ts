import { z } from "zod";

/** Historical v1 payload, retained only for persisted-reading compatibility. */
export const legacyReadingCardResultSchema = z
  .object({
    positionId: z.string().min(1),
    cardId: z.string().min(1),
    orientation: z.enum(["upright", "reversed"]),
    traditionalMeaning: z.string().min(1),
    personalizedMeaning: z.string().min(1),
    questionConnection: z.string().min(1),
  })
  .strict();

export const legacyReadingResultSchema = z
  .object({
    title: z.string().min(1),
    directAnswer: z.string().min(1),
    centralTheme: z.string().min(1),
    cards: z.array(legacyReadingCardResultSchema).min(1).max(10),
    synthesis: z.string().min(1),
    likelyTrajectory: z.object({
      summary: z.string().min(1),
      conditions: z.array(z.string().min(1)).min(1),
      alternateTrajectory: z.string().min(1),
    }),
    userAgency: z.array(z.string().min(1)).min(1),
    reflectionQuestion: z.string().min(1),
    disconfirmingEvidence: z.array(z.string().min(1)).min(1),
    uncertainty: z.string().min(1),
    safetyFlags: z.array(z.string()),
  })
  .strict();

/** Historical narration-first v2 payload. */
export const readingPassageRoleSchema = z.enum([
  "opening",
  "situation",
  "underlyingPattern",
  "development",
  "turningPoint",
  "trajectory",
  "alternative",
  "agency",
  "reflection",
  "closing",
  "safety",
]);

export const readingPassageSchema = z
  .object({
    id: z.string().min(1),
    role: readingPassageRoleSchema,
    text: z.string().min(1),
    cardReferences: z.array(z.string().min(1)).max(10),
  })
  .strict();

export const readingCardThreadSchema = z
  .object({
    positionId: z.string().min(1),
    cardId: z.string().min(1),
    orientation: z.enum(["upright", "reversed"]),
    passageIds: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const readingResultV2Schema = z
  .object({
    schemaVersion: z.literal("reading-result-v2"),
    title: z.string().min(1),
    passages: z.array(readingPassageSchema).min(3).max(24),
    cards: z.array(readingCardThreadSchema).min(1).max(10),
    trajectory: z
      .object({
        likelyPassageId: z.string().min(1),
        conditions: z.array(z.string().min(1)).min(1),
        alternatePassageId: z.string().min(1),
      })
      .strict(),
    userAgency: z.array(z.string().min(1)).min(1),
    reflectionQuestion: z.string().min(1),
    disconfirmingEvidence: z.array(z.string().min(1)).min(1),
    uncertainty: z.string().min(1),
    safetyFlags: z.array(z.string()),
  })
  .strict();

export const readingEvidenceCardSchema = z
  .object({
    positionId: z.string().min(1),
    positionLabel: z.string().min(1),
    cardId: z.string().min(1),
    orientation: z.enum(["upright", "reversed"]),
    coreMeaning: z.string().min(1),
    positionInterpretation: z.string().min(1),
    relationshipNotes: z.array(z.string().min(1)).max(12),
    supportingEvidence: z.array(z.string().min(1)).min(1).max(12),
  })
  .strict();

export const personalizationLensResultSchema = z
  .object({
    label: z.literal("Personalized reflection"),
    observations: z.array(z.string().min(1)).min(1).max(6),
  })
  .strict();

/**
 * Current spread-aware contract. Nullable sections are semantic: null means
 * the configured spread/question does not support that claim.
 */
export const readingResultV3Schema = z
  .object({
    schemaVersion: z.literal("reading-result-v3"),
    directAnswer: z.string().min(1),
    overallPattern: z.string().min(1),
    cards: z.array(readingEvidenceCardSchema).min(1).max(10),
    synthesis: z.string().min(1),
    likelyTrajectory: z.string().min(1).nullable(),
    alternatePath: z.string().min(1).nullable(),
    timing: z.string().min(1).nullable(),
    userAgency: z.string().min(1),
    reflectionPrompt: z.string().min(1),
    uncertaintyNote: z.string().min(1),
    personalizationLens: personalizationLensResultSchema.nullable(),
    safetyFlags: z.array(z.string()),
  })
  .strict()
  .superRefine((result, context) => {
    const positions = new Set(result.cards.map(({ positionId }) => positionId));
    if (positions.size !== result.cards.length)
      context.addIssue({ code: "custom", message: "Reading card positions must be unique." });
    const cards = new Set(result.cards.map(({ cardId }) => cardId));
    if (cards.size !== result.cards.length)
      context.addIssue({ code: "custom", message: "Reading card IDs must be unique." });
  });

export type LegacyReadingResult = z.infer<typeof legacyReadingResultSchema>;

function normalizeV2(value: z.infer<typeof readingResultV2Schema>) {
  const passageById = new Map(value.passages.map((passage) => [passage.id, passage]));
  const opening = value.passages.find(({ role }) => role === "opening" || role === "safety");
  const pattern = value.passages.find(({ role }) =>
    ["underlyingPattern", "development", "turningPoint"].includes(role),
  );
  const likely = passageById.get(value.trajectory.likelyPassageId);
  const alternate = passageById.get(value.trajectory.alternatePassageId);
  return readingResultV3Schema.parse({
    schemaVersion: "reading-result-v3",
    directAnswer: opening?.text ?? value.title,
    overallPattern: pattern?.text ?? opening?.text ?? value.title,
    cards: value.cards.map((card) => {
      const passages = card.passageIds.flatMap((id) => {
        const passage = passageById.get(id);
        return passage ? [passage] : [];
      });
      const interpretation = passages.map(({ text }) => text).join(" ") || value.title;
      return {
        positionId: card.positionId,
        positionLabel: card.positionId.replaceAll("-", " "),
        cardId: card.cardId,
        orientation: card.orientation,
        coreMeaning: passages[0]?.text ?? interpretation,
        positionInterpretation: interpretation,
        relationshipNotes: passages
          .filter(({ cardReferences }) => cardReferences.length > 1)
          .map(({ text }) => text),
        supportingEvidence: [`${card.cardId} in ${card.positionId}`],
      };
    }),
    synthesis:
      value.passages
        .filter(({ role }) => ["development", "turningPoint", "closing"].includes(role))
        .map(({ text }) => text)
        .join(" ") || value.title,
    likelyTrajectory: likely?.text ?? null,
    alternatePath: alternate?.text ?? null,
    timing: null,
    userAgency: value.userAgency.join(" "),
    reflectionPrompt: value.reflectionQuestion,
    uncertaintyNote: value.uncertainty,
    personalizationLens: null,
    safetyFlags: value.safetyFlags,
  });
}

function normalizeLegacy(value: LegacyReadingResult) {
  return readingResultV3Schema.parse({
    schemaVersion: "reading-result-v3",
    directAnswer: value.directAnswer,
    overallPattern: value.centralTheme,
    cards: value.cards.map((card) => ({
      positionId: card.positionId,
      positionLabel: card.positionId.replaceAll("-", " "),
      cardId: card.cardId,
      orientation: card.orientation,
      coreMeaning: card.traditionalMeaning,
      positionInterpretation: card.questionConnection,
      relationshipNotes: [],
      supportingEvidence: [`${card.cardId} in ${card.positionId}`],
    })),
    synthesis: value.synthesis,
    likelyTrajectory: value.likelyTrajectory.summary,
    alternatePath: value.likelyTrajectory.alternateTrajectory,
    timing: null,
    userAgency: value.userAgency.join(" "),
    reflectionPrompt: value.reflectionQuestion,
    uncertaintyNote: value.uncertainty,
    personalizationLens: null,
    safetyFlags: value.safetyFlags,
  });
}

export function normalizeReadingResult(value: unknown): z.infer<typeof readingResultV3Schema> {
  const current = readingResultV3Schema.safeParse(value);
  if (current.success) return current.data;
  const v2 = readingResultV2Schema.safeParse(value);
  if (v2.success) return normalizeV2(v2.data);
  return normalizeLegacy(legacyReadingResultSchema.parse(value));
}

/** Reads persisted v1/v2/v3, always returning the current evidence contract. */
export const readingResultSchema = z.unknown().transform((value, context) => {
  try {
    return normalizeReadingResult(value);
  } catch (error) {
    context.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "Invalid reading result.",
    });
    return z.NEVER;
  }
});

export type ReadingResult = z.infer<typeof readingResultSchema>;

export const followUpResultSchema = z.object({ response: z.string().min(1) }).strict();
export type FollowUpResult = z.infer<typeof followUpResultSchema>;

export function normalizeFollowUpResult(value: unknown): FollowUpResult {
  const current = followUpResultSchema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyReadingResultSchema.parse(value);
  return followUpResultSchema.parse({
    response: [
      legacy.directAnswer,
      legacy.cards.map(({ personalizedMeaning }) => personalizedMeaning).join(" "),
      legacy.synthesis,
      legacy.userAgency.join(" "),
    ].join(" "),
  });
}

export const readingOutputProvenanceSchema = z.object({
  providerId: z.string().min(1),
  promptVersion: z.string().min(1),
  schemaVersion: z.string().min(1),
  contentVersion: z.string().min(1).optional(),
  safetyPolicyVersion: z.string().min(1).optional(),
});
export type ReadingOutputProvenance = z.infer<typeof readingOutputProvenanceSchema>;

export const oraclePhaseSchema = z.enum([
  "directAnswer",
  "overallPattern",
  "cardInterpretation",
  "synthesis",
  "likelyTrajectory",
  "alternatePath",
  "timing",
  "userAgency",
  "personalization",
  "reflectionPrompt",
  "followUp",
  "uncertainty",
]);

export const oracleStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("phase"),
    sequence: z.number().int().nonnegative(),
    phase: oraclePhaseSchema,
    heading: z.string().min(1),
    text: z.string().min(1),
    cardPositionIds: z.array(z.string().min(1)).max(10).optional(),
  }),
  z.object({ type: z.literal("complete") }),
  z.object({ type: z.literal("error"), message: z.string().min(1) }),
]);

export type OraclePhase = z.infer<typeof oraclePhaseSchema>;
export type OracleStreamEvent = z.infer<typeof oracleStreamEventSchema>;
