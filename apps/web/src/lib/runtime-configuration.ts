import "server-only";

import {
  configuredGroqModelChain,
  RUNTIME_PROMPT_BUNDLES,
  type InterpretationRuntimeOptions,
  type RuntimePromptBundleId,
} from "@starguidance/ai";
import {
  DECK_VERSION,
  SPREAD_CATALOG_VERSION,
  spreads,
  TAROT_CONTENT_VERSION,
} from "@starguidance/tarot-content";
import { z } from "zod";

import { getRuntimeAdapter, getSystemDatabaseClient } from "./runtime";

export const RUNTIME_CONFIGURATION_DOMAINS = [
  "content",
  "prompts",
  "commerce",
  "features",
  "models",
] as const;
export type RuntimeConfigurationDomain = (typeof RUNTIME_CONFIGURATION_DOMAINS)[number];

const safeVersion = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/i);
const spreadIds = new Set(spreads.map(({ id }) => id));

export const contentConfigurationSchema = z
  .object({
    deckVersion: z.literal(DECK_VERSION),
    cardSetVersion: z.literal(DECK_VERSION),
    tarotContentVersion: z.literal(TAROT_CONTENT_VERSION),
    spreadCatalogVersion: z.literal(SPREAD_CATALOG_VERSION),
    interpretationRulesVersion: z.literal("interpretation-rules-v1"),
    enabledSpreadIds: z.array(z.string().min(1).max(80)).min(1).max(spreads.length),
  })
  .strict()
  .superRefine(({ enabledSpreadIds }, context) => {
    if (new Set(enabledSpreadIds).size !== enabledSpreadIds.length)
      context.addIssue({ code: "custom", message: "Spread IDs must be unique." });
    for (const id of enabledSpreadIds)
      if (!spreadIds.has(id))
        context.addIssue({ code: "custom", message: `Unknown reviewed spread: ${id}` });
  });

export const promptConfigurationSchema = z
  .object({
    bundleId: z.enum([
      "reader-voice-v3",
      "reader-voice-v3-grounded",
      "reader-voice-v4",
      "reader-voice-v4-grounded",
      "reader-voice-v5",
      "reader-voice-v5-grounded",
      "reader-voice-v6",
      "reader-voice-v6-grounded",
    ]),
    safetyPolicyVersion: z.literal("question-safety-v2"),
  })
  .strict();

export const commerceConfigurationSchema = z
  .object({
    readingAccessMode: z.enum(["unlimited", "free-window"]),
    freeAllowance: z.number().int().min(1).max(100),
    allowanceWindowHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 30),
    followUpLimit: z.number().int().min(0).max(10),
    rereadCooldownMinutes: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
    reportProductId: z.literal("profile-report-v1"),
    stripePriceId: safeVersion.optional(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/),
    priceMinor: z.number().int().min(0).max(100_000_000),
  })
  .strict();

export const featureConfigurationSchema = z
  .object({
    profileReportsEnabled: z.boolean(),
    animationsEnabled: z.boolean(),
    animationVariant: z.enum(["immersive-v1", "quiet-v1"]),
    enabledProfileSystems: z
      .array(z.enum(["numerology", "dreamspell", "western", "bazi", "nine-star-ki"]))
      .min(1),
  })
  .strict();

export const modelConfigurationSchema = z
  .object({
    liveAiEnabled: z.boolean(),
    primaryModel: safeVersion,
    fallbackModels: z.array(safeVersion).max(4),
    disabledModels: z.array(safeVersion).max(8),
  })
  .strict()
  .superRefine(({ fallbackModels, disabledModels }, context) => {
    if (new Set(fallbackModels).size !== fallbackModels.length)
      context.addIssue({ code: "custom", message: "Fallback models must be unique." });
    if (new Set(disabledModels).size !== disabledModels.length)
      context.addIssue({ code: "custom", message: "Disabled models must be unique." });
  });

export const runtimeConfigurationSchemas = {
  content: contentConfigurationSchema,
  prompts: promptConfigurationSchema,
  commerce: commerceConfigurationSchema,
  features: featureConfigurationSchema,
  models: modelConfigurationSchema,
} as const;

export type ContentConfiguration = z.infer<typeof contentConfigurationSchema>;
export type PromptConfiguration = z.infer<typeof promptConfigurationSchema>;
export type CommerceConfiguration = z.infer<typeof commerceConfigurationSchema>;
export type FeatureConfiguration = z.infer<typeof featureConfigurationSchema>;
export type ModelConfiguration = z.infer<typeof modelConfigurationSchema>;

export interface RuntimeConfiguration {
  content: ContentConfiguration;
  prompts: PromptConfiguration;
  commerce: CommerceConfiguration;
  features: FeatureConfiguration;
  models: ModelConfiguration;
  versions: Record<RuntimeConfigurationDomain, number | null>;
}

function integerEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function defaultRuntimeConfiguration(): RuntimeConfiguration {
  const [primaryModel = "openai/gpt-oss-120b", ...fallbackModels] = configuredGroqModelChain();
  return {
    content: {
      deckVersion: DECK_VERSION,
      cardSetVersion: DECK_VERSION,
      tarotContentVersion: TAROT_CONTENT_VERSION,
      spreadCatalogVersion: SPREAD_CATALOG_VERSION,
      interpretationRulesVersion: "interpretation-rules-v1",
      enabledSpreadIds: spreads.map(({ id }) => id),
    },
    prompts: { bundleId: "reader-voice-v6", safetyPolicyVersion: "question-safety-v2" },
    commerce: {
      readingAccessMode:
        process.env.READING_ACCESS_MODE === "free-window" ? "free-window" : "unlimited",
      freeAllowance: integerEnvironment("READING_FREE_ALLOWANCE", 3, 1, 100),
      allowanceWindowHours: integerEnvironment("READING_ALLOWANCE_WINDOW_HOURS", 24, 1, 24 * 30),
      followUpLimit: integerEnvironment("READING_FOLLOW_UP_LIMIT", 1, 0, 10),
      rereadCooldownMinutes: integerEnvironment("READING_REREAD_COOLDOWN_MINUTES", 30, 0, 24 * 60),
      reportProductId: "profile-report-v1",
      ...(process.env.STRIPE_PROFILE_REPORT_PRICE_ID
        ? { stripePriceId: process.env.STRIPE_PROFILE_REPORT_PRICE_ID }
        : {}),
      currency: (process.env.PROFILE_REPORT_CURRENCY ?? "USD").toUpperCase(),
      priceMinor: integerEnvironment("PROFILE_REPORT_PRICE_MINOR", 2900, 0, 100_000_000),
    },
    features: {
      profileReportsEnabled: process.env.ENABLE_PROFILE_REPORTS === "true",
      animationsEnabled: true,
      animationVariant: "immersive-v1",
      enabledProfileSystems: ["numerology", "dreamspell"],
    },
    models: {
      liveAiEnabled: true,
      primaryModel,
      fallbackModels,
      disabledModels: [],
    },
    versions: { content: null, prompts: null, commerce: null, features: null, models: null },
  };
}

function approvedModels(): Set<string> {
  const configured = process.env.AI_PROVIDER_ALLOWED_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return new Set(configured?.length ? configured : configuredGroqModelChain());
}

export function assertApprovedModelConfiguration(configuration: ModelConfiguration): void {
  const approved = approvedModels();
  for (const model of [configuration.primaryModel, ...configuration.fallbackModels])
    if (!approved.has(model)) throw new Error("RUNTIME_MODEL_NOT_APPROVED");
}

export function parseRuntimeConfigurationPayload(
  domain: RuntimeConfigurationDomain,
  payload: unknown,
):
  | ContentConfiguration
  | PromptConfiguration
  | CommerceConfiguration
  | FeatureConfiguration
  | ModelConfiguration {
  const parsed = runtimeConfigurationSchemas[domain].parse(payload);
  if (domain === "models") assertApprovedModelConfiguration(parsed as ModelConfiguration);
  return parsed;
}

interface PublishedConfigurationRow {
  domain: RuntimeConfigurationDomain;
  version: number;
  payload: unknown;
}

interface ActiveControlRow {
  target_type: "deck" | "spread" | "product";
  target_id: string;
}

export async function getRuntimeConfiguration(): Promise<RuntimeConfiguration> {
  const configuration = defaultRuntimeConfiguration();
  if (getRuntimeAdapter() !== "supabase") return configuration;
  const client = getSystemDatabaseClient();
  const [rows, activeControls] = await Promise.all([
    client<PublishedConfigurationRow[]>`
      select domain, version, payload
      from runtime_configuration_versions
      where status = 'published'
    `,
    client<ActiveControlRow[]>`
      select 'deck'::text as target_type, version as target_id from decks where active
      union all
      select 'spread'::text, id from spreads where active group by id
      union all
      select 'product'::text, id from products where active
    `,
  ]);
  for (const row of rows) {
    if (!RUNTIME_CONFIGURATION_DOMAINS.includes(row.domain))
      throw new Error("RUNTIME_CONFIGURATION_INVALID");
    const payload = parseRuntimeConfigurationPayload(row.domain, row.payload);
    Object.assign(configuration[row.domain], payload);
    configuration.versions[row.domain] = row.version;
  }
  const activeDecks = new Set(
    activeControls
      .filter(({ target_type }) => target_type === "deck")
      .map(({ target_id }) => target_id),
  );
  const activeSpreads = new Set(
    activeControls
      .filter(({ target_type }) => target_type === "spread")
      .map(({ target_id }) => target_id),
  );
  const activeProducts = new Set(
    activeControls
      .filter(({ target_type }) => target_type === "product")
      .map(({ target_id }) => target_id),
  );
  configuration.content.enabledSpreadIds = activeDecks.has(configuration.content.deckVersion)
    ? configuration.content.enabledSpreadIds.filter((id) => activeSpreads.has(id))
    : [];
  if (!activeProducts.has(configuration.commerce.reportProductId))
    configuration.features.profileReportsEnabled = false;
  return configuration;
}

export function interpretationRuntimeOptions(
  configuration: RuntimeConfiguration,
): InterpretationRuntimeOptions {
  const disabled = new Set(configuration.models.disabledModels);
  const modelChain = [
    configuration.models.primaryModel,
    ...configuration.models.fallbackModels,
  ].filter((model) => !disabled.has(model));
  return {
    enabled: configuration.models.liveAiEnabled && modelChain.length > 0,
    modelChain,
    promptBundleId: configuration.prompts.bundleId as RuntimePromptBundleId,
  };
}

export function profileReportsEnabled(configuration: RuntimeConfiguration): boolean {
  return (
    process.env.ENABLE_PROFILE_REPORTS === "true" &&
    configuration.features.profileReportsEnabled &&
    Boolean(configuration.commerce.stripePriceId || process.env.PAYMENTS_PROVIDER === "local")
  );
}

export const supportedPromptBundleIds = Object.keys(
  RUNTIME_PROMPT_BUNDLES,
) as RuntimePromptBundleId[];
