import { z } from "zod";

export const readingCardResultSchema = z.object({
  positionId: z.string().min(1),
  cardId: z.string().min(1),
  orientation: z.enum(["upright", "reversed"]),
  traditionalMeaning: z.string().min(1),
  personalizedMeaning: z.string().min(1),
  questionConnection: z.string().min(1),
});

export const readingResultSchema = z.object({
  title: z.string().min(1),
  directAnswer: z.string().min(1),
  centralTheme: z.string().min(1),
  cards: z.array(readingCardResultSchema).min(1).max(7),
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
});

export type ReadingResult = z.infer<typeof readingResultSchema>;
