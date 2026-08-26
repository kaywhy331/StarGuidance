import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  drawCeremonySchema,
  questionClassificationSchema,
  readingConfigurationSchema,
  readingEntitlementDecisionSchema,
  spreadCapabilitySnapshotSchema,
  spreadPositionSnapshotSchema,
  type DrawCeremony,
  type PersonalizationMode,
  type QuestionClassification,
  type ReadingConfiguration,
  type ReadingEntitlementDecision,
  type ReversalMode,
} from "@starguidance/contracts";
import type { ReadingLensRecord } from "@starguidance/database";
import {
  commitDrawServerSeed,
  createDrawServerSeed,
  type Spread,
} from "@starguidance/tarot-domain";

import type { RequestPersistence } from "./persistence";
import {
  relatedPersonReadingLensSchema,
  type RelatedPersonReadingLens,
} from "./related-person-lens";

export const DRAW_CEREMONY_VERSION = "draw-ceremony-v1" as const;
export const DRAW_CEREMONY_TTL_MS = 2 * 60 * 60 * 1_000;

const privateSpreadSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    purpose: z.string().min(1),
    estimatedMinutes: z.number().int().positive(),
    entitlementClass: z.literal("standard"),
    version: z.string().min(1),
    allowReversals: z.boolean(),
    optionalCut: z.boolean(),
    layout: z
      .object({
        columns: z.number().int().positive(),
        rows: z.number().int().positive(),
        kind: z.enum([
          "centered",
          "horizontal",
          "celtic-cross",
          "horseshoe",
          "relationship",
          "matrix",
          "legacy",
        ]),
      })
      .strict(),
    positions: z.array(spreadPositionSnapshotSchema).min(1).max(10).readonly(),
    capabilities: spreadCapabilitySnapshotSchema,
  })
  .strict();

const privateCeremonySchema = z
  .object({
    version: z.literal(DRAW_CEREMONY_VERSION),
    readingId: z.string().uuid(),
    deckVersion: z.string().min(1),
    userId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    profileSnapshotId: z.string().uuid(),
    readingLens: z
      .object({
        version: z.string().min(1),
        traitIndexes: z.array(z.number().int().nonnegative()).readonly(),
        tensionIndexes: z.array(z.number().int().nonnegative()).readonly().optional(),
      })
      .strict(),
    relatedPersonLens: relatedPersonReadingLensSchema.optional(),
    question: z.string().trim().min(1).max(500),
    questionClassification: questionClassificationSchema,
    entitlementDecision: readingEntitlementDecisionSchema,
    safetyClassification: z.string().min(1),
    continueAsReflection: z.boolean(),
    spread: privateSpreadSchema,
    configuration: readingConfigurationSchema,
    serverSeed: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    serverSeedCommitment: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type PrivateDrawCeremony = z.infer<typeof privateCeremonySchema>;

function capabilitySnapshot(spread: Spread): ReadingConfiguration["capabilities"] {
  return spreadCapabilitySnapshotSchema.parse(
    spread.capabilities ?? {
      trajectoryPositionIds: [],
      alternativePositionGroups: [],
      timingMethod: null,
      linkedPositions: [],
    },
  );
}

export function readingConfiguration(input: {
  spread: Spread;
  reversalMode: ReversalMode;
  personalizationMode: PersonalizationMode;
}): ReadingConfiguration {
  return readingConfigurationSchema.parse({
    version: "reading-configuration-v1",
    reversalMode: input.reversalMode,
    personalizationMode: input.personalizationMode,
    positions: input.spread.positions,
    capabilities: capabilitySnapshot(input.spread),
  });
}

export function issueDrawCeremony(
  persistence: RequestPersistence,
  input: {
    userId: string;
    idempotencyKey: string;
    deckVersion: string;
    profileSnapshotId: string;
    readingLens: ReadingLensRecord;
    relatedPersonLens?: RelatedPersonReadingLens;
    question: string;
    questionClassification: QuestionClassification;
    entitlementDecision: ReadingEntitlementDecision;
    safetyClassification: string;
    continueAsReflection: boolean;
    spread: Spread;
    reversalMode: ReversalMode;
    personalizationMode: PersonalizationMode;
    now?: Date;
  },
): { ceremony: DrawCeremony; privateCeremony: PrivateDrawCeremony } {
  const now = input.now ?? new Date();
  const serverSeed = createDrawServerSeed();
  const serverSeedCommitment = commitDrawServerSeed(serverSeed);
  const configuration = readingConfiguration(input);
  const privateCeremony = privateCeremonySchema.parse({
    version: DRAW_CEREMONY_VERSION,
    readingId: randomUUID(),
    deckVersion: input.deckVersion,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
    profileSnapshotId: input.profileSnapshotId,
    readingLens: input.readingLens,
    ...(input.relatedPersonLens ? { relatedPersonLens: input.relatedPersonLens } : {}),
    question: input.question,
    questionClassification: input.questionClassification,
    entitlementDecision: input.entitlementDecision,
    safetyClassification: input.safetyClassification,
    continueAsReflection: input.continueAsReflection,
    spread: {
      id: input.spread.id,
      name: input.spread.name,
      purpose: input.spread.purpose,
      estimatedMinutes: input.spread.estimatedMinutes,
      entitlementClass: input.spread.entitlementClass,
      version: input.spread.version,
      allowReversals: input.spread.allowReversals,
      optionalCut: input.spread.optionalCut,
      layout: input.spread.layout,
      positions: configuration.positions,
      capabilities: configuration.capabilities,
    },
    configuration,
    serverSeed,
    serverSeedCommitment,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAW_CEREMONY_TTL_MS).toISOString(),
  });
  const token = persistence.encrypt(JSON.stringify(privateCeremony), "draw-ceremony");
  return { privateCeremony, ceremony: publicDrawCeremony(privateCeremony, token) };
}

export function publicDrawCeremony(
  privateCeremony: PrivateDrawCeremony,
  token: string,
): DrawCeremony {
  return drawCeremonySchema.parse({
    version: DRAW_CEREMONY_VERSION,
    sessionId: privateCeremony.readingId,
    token,
    deckVersion: privateCeremony.deckVersion,
    serverSeedCommitment: privateCeremony.serverSeedCommitment,
    expiresAt: privateCeremony.expiresAt,
    question: privateCeremony.question,
    spread: {
      id: privateCeremony.spread.id,
      version: privateCeremony.spread.version,
      name: privateCeremony.spread.name,
      positions: privateCeremony.spread.positions,
    },
    configuration: privateCeremony.configuration,
  });
}

export function readDrawCeremony(
  persistence: RequestPersistence,
  token: string,
  expectedUserId: string,
  now = Date.now(),
): PrivateDrawCeremony {
  const ceremony = privateCeremonySchema.parse(
    JSON.parse(persistence.decrypt(token, "draw-ceremony")),
  );
  if (ceremony.userId !== expectedUserId) throw new Error("DRAW_CEREMONY_OWNER_MISMATCH");
  if (Date.parse(ceremony.expiresAt) <= now) throw new Error("DRAW_CEREMONY_EXPIRED");
  if (commitDrawServerSeed(ceremony.serverSeed) !== ceremony.serverSeedCommitment)
    throw new Error("DRAW_CEREMONY_COMMITMENT_INVALID");
  return ceremony;
}
