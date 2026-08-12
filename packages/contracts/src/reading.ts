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
    /** Position IDs are presentation metadata and are never rendered as prose. */
    cardReferences: z.array(z.string().min(1)).max(10),
  })
  .strict();

export const readingCardThreadSchema = z
  .object({
    positionId: z.string().min(1),
    cardId: z.string().min(1),
    orientation: z.enum(["upright", "reversed"]),
    /** Passage IDs carrying this card's interpretation. */
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
  .strict()
  .superRefine((result, context) => {
    const passageIds = new Set(result.passages.map(({ id }) => id));
    if (passageIds.size !== result.passages.length)
      context.addIssue({ code: "custom", message: "Reading passage IDs must be unique." });
    const positions = new Set(result.cards.map(({ positionId }) => positionId));
    if (positions.size !== result.cards.length)
      context.addIssue({ code: "custom", message: "Reading card positions must be unique." });
    for (const card of result.cards)
      for (const passageId of card.passageIds)
        if (!passageIds.has(passageId))
          context.addIssue({
            code: "custom",
            message: `Card thread references unknown passage ${passageId}.`,
          });
    for (const passage of result.passages)
      for (const positionId of passage.cardReferences)
        if (!positions.has(positionId))
          context.addIssue({
            code: "custom",
            message: `Passage references unknown position ${positionId}.`,
          });
    for (const passageId of [
      result.trajectory.likelyPassageId,
      result.trajectory.alternatePassageId,
    ])
      if (!passageIds.has(passageId))
        context.addIssue({
          code: "custom",
          message: `Trajectory references unknown passage ${passageId}.`,
        });
  });

export type LegacyReadingResult = z.infer<typeof legacyReadingResultSchema>;

function legacyPassageId(prefix: string, index?: number): string {
  return index === undefined ? `legacy-${prefix}` : `legacy-${prefix}-${index + 1}`;
}

export function normalizeReadingResult(value: unknown): z.infer<typeof readingResultV2Schema> {
  const current = readingResultV2Schema.safeParse(value);
  if (current.success) return current.data;
  const legacy = legacyReadingResultSchema.parse(value);
  const openingId = legacyPassageId("opening");
  const cardPassages = legacy.cards.map((card, index) => ({
    id: legacyPassageId("card", index),
    role: "situation" as const,
    text: [card.traditionalMeaning, card.personalizedMeaning, card.questionConnection].join(" "),
    cardReferences: [card.positionId],
  }));
  const likelyId = legacyPassageId("trajectory");
  const alternateId = legacyPassageId("alternative");
  const passages = [
    {
      id: openingId,
      role: "opening" as const,
      text: `${legacy.directAnswer} ${legacy.centralTheme}`,
      cardReferences: [] as string[],
    },
    ...cardPassages,
    {
      id: legacyPassageId("synthesis"),
      role: "development" as const,
      text: legacy.synthesis,
      cardReferences: legacy.cards.map(({ positionId }) => positionId),
    },
    {
      id: likelyId,
      role: "trajectory" as const,
      text: `${legacy.likelyTrajectory.summary} This remains most likely while ${legacy.likelyTrajectory.conditions.join("; ")}.`,
      cardReferences: [] as string[],
    },
    {
      id: alternateId,
      role: "alternative" as const,
      text: legacy.likelyTrajectory.alternateTrajectory,
      cardReferences: [] as string[],
    },
    {
      id: legacyPassageId("agency"),
      role: "agency" as const,
      text: legacy.userAgency.join(". "),
      cardReferences: [] as string[],
    },
    {
      id: legacyPassageId("reflection"),
      role: "reflection" as const,
      text: legacy.reflectionQuestion,
      cardReferences: [] as string[],
    },
  ];
  return readingResultV2Schema.parse({
    schemaVersion: "reading-result-v2",
    title: legacy.title,
    passages,
    cards: legacy.cards.map((card, index) => ({
      positionId: card.positionId,
      cardId: card.cardId,
      orientation: card.orientation,
      passageIds: [legacyPassageId("card", index), legacyPassageId("synthesis")],
    })),
    trajectory: {
      likelyPassageId: likelyId,
      conditions: legacy.likelyTrajectory.conditions,
      alternatePassageId: alternateId,
    },
    userAgency: legacy.userAgency,
    reflectionQuestion: legacy.reflectionQuestion,
    disconfirmingEvidence: legacy.disconfirmingEvidence,
    uncertainty: legacy.uncertainty,
    safetyFlags: legacy.safetyFlags,
  });
}

/** Reads both persisted v1 and narration-first v2, always returning v2. */
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

export const followUpResultSchema = z
  .object({
    response: z.string().min(1),
  })
  .strict();

export type FollowUpResult = z.infer<typeof followUpResultSchema>;

/**
 * Converts the former full-reading follow-up payload into the current single
 * response contract. This keeps existing persisted readings readable while
 * ensuring every follow-up renders as one cohesive section.
 */
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
});

export type ReadingOutputProvenance = z.infer<typeof readingOutputProvenanceSchema>;

export const oraclePhaseSchema = z.enum([
  "narration",
  "openingTheme",
  "cardInterpretation",
  "overallSynthesis",
  "likelyTrajectory",
  "alternateTrajectory",
  "userAgency",
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
    passageId: z.string().min(1).optional(),
    cardPositionIds: z.array(z.string().min(1)).max(10).optional(),
  }),
  z.object({ type: z.literal("complete") }),
  z.object({ type: z.literal("error"), message: z.string().min(1) }),
]);

export type OraclePhase = z.infer<typeof oraclePhaseSchema>;
export type OracleStreamEvent = z.infer<typeof oracleStreamEventSchema>;
