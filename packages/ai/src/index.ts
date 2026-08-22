import {
  followUpResultSchema,
  oracleStreamEventSchema,
  questionClassificationSchema,
  readingResultSchema,
  type FollowUpResult,
  type ProfileLifeDomain,
  type ProfileTension,
  type QuestionClassification,
  type ReadingHorizon,
  type OracleStreamEvent,
  type ReadingTopic,
  type ProfileTrait,
  type ReadingOutputProvenance,
  type ReadingResult,
} from "@starguidance/contracts";
import type { LockedDraw } from "@starguidance/tarot-domain";

import {
  answerCard,
  guardedDirectAnswer,
  questionSubject,
  resolveDraw,
  subjectVoices,
} from "./interpretation";
import {
  agencyNarration as conversationalAgencyNarration,
  agencySteps,
  alternateNarration as conversationalAlternateNarration,
  buildQuestionFrame,
  cardNarration as conversationalCardNarration,
  closingNarration as conversationalClosingNarration,
  disconfirmingEvidence as conversationalDisconfirmingEvidence,
  likelyNarration as conversationalLikelyNarration,
  narrationTitle as conversationalNarrationTitle,
  openingNarration as conversationalOpeningNarration,
  reflectionQuestion as conversationalReflectionQuestion,
  trajectoryConditions,
  turningPointNarration as conversationalTurningPointNarration,
} from "./fallback-narration";
import type { RuntimePromptBundleId } from "./groq-provider";

export interface InterpretationProvider<TInput, TOutput> {
  readonly id: string;
  generate(input: TInput, signal?: AbortSignal): Promise<TOutput>;
}

export const FALLBACK_PROVIDER_ID = "deterministic-fallback-v1" as const;
export const FALLBACK_PROMPT_VERSION = "deterministic-fallback-v4" as const;
export const READING_RESULT_SCHEMA_VERSION = "reading-result-v2" as const;

export interface ReadingGenerationOutcome {
  result: ReadingResult;
  provenance: ReadingOutputProvenance;
}

export interface FollowUpGenerationOutcome {
  result: FollowUpResult;
  provenance: ReadingOutputProvenance;
}

export interface ReadingInterpretationProvider extends InterpretationProvider<
  ReadingGenerationInput,
  ReadingResult
> {
  generateWithProvenance(
    input: ReadingGenerationInput,
    signal?: AbortSignal,
  ): Promise<ReadingGenerationOutcome>;
  generateFollowUpWithProvenance(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpGenerationOutcome>;
  generateFollowUp(input: FollowUpGenerationInput, signal?: AbortSignal): Promise<FollowUpResult>;
}

export type SafetyCategory =
  | "ordinary"
  | "medical"
  | "legal"
  | "financial"
  | "pregnancy"
  | "physicalDeath"
  | "criminalGuilt"
  | "infidelity"
  | "mentalHealthDiagnosis"
  | "thirdPartyPrivateClaim"
  | "selfHarmCrisis"
  | "compulsiveReading";

const rules: readonly [SafetyCategory, RegExp][] = [
  [
    "selfHarmCrisis",
    /\b(?:kill|harm|hurt) myself\b|\b(?:suicid(?:e|al)|self[- ]harm|end (?:it all|my life)|take my own life|i (?:want|need|plan|intend|wish|hope) to die|i wish i could die|i feel like dying|i (?:cannot|can['’]t) go on|(?:do not|don['’]t) want to (?:live|be alive|exist)|better off dead|wish i (?:was|were) dead|no reason to live|planning to overdose)\b/i,
  ],
  ["pregnancy", /\b(pregnan(t|cy)|miscarriage)\b/i],
  ["physicalDeath", /\b(will .* die|death date|going to die)\b/i],
  ["criminalGuilt", /\b(guilty|committed (the )?crime|murdered|stole)\b/i],
  ["infidelity", /\b(cheat(ing|ed)?|affair|unfaithful)\b/i],
  ["medical", /\b(diagnos(e|is)|cancer|medication|medical|doctor|symptom)\b/i],
  ["legal", /\b(lawsuit|court|legal|verdict|custody|sentence)\b/i],
  ["financial", /\b(stock|crypto|investment|return|financial advice|buy or sell)\b/i],
  ["mentalHealthDiagnosis", /\b(narcissist|bipolar|psychopath|mental illness|diagnose)\b/i],
  ["thirdPartyPrivateClaim", /\b(what is (he|she|they) hiding|secret motive|really thinking)\b/i],
  [
    "compulsiveReading",
    /\b(again and again|keep redrawing|one more reading|same question again)\b/i,
  ],
];

export function classifyQuestion(question: string): {
  category: SafetyCategory;
  interrupt: boolean;
  guidance: string;
} {
  const category = rules.find(([, pattern]) => pattern.test(question))?.[0] ?? "ordinary";
  if (category === "selfHarmCrisis")
    return {
      category,
      interrupt: true,
      guidance:
        "If you may act on thoughts of suicide or self-harm, call emergency services now or use one of the crisis resources below. You do not need to handle this alone.",
    };
  if (category === "ordinary")
    return {
      category,
      interrupt: false,
      guidance: "Use conditional, reflective language and preserve user agency.",
    };
  if (category === "compulsiveReading")
    return {
      category,
      interrupt: true,
      guidance: "Retain the prior reading, avoid a redraw, and encourage time for reflection.",
    };
  return {
    category,
    interrupt: false,
    guidance:
      "Do not claim facts or outcomes; reframe toward evidence, preparation, boundaries, choices, and qualified support where relevant.",
  };
}

const inferredTopics: readonly [ReadingTopic, RegExp][] = [
  [
    "career",
    /\b(work|career|job|business|project|lead|colleague|coworker|manager|boss|role|position|promot\w*|raise|salary|pay|income|interview|hiring|offer|employment|contract|client|company|team|freelance)\b/i,
  ],
  [
    "relationships",
    /\b(love|relationship|partner|friend|family|communicat\w*|conflict|marriage|reconcil\w*|reconnect|break ?up)\b/i,
  ],
  ["change", /\b(change|move|relocat\w*|choice|direction|transition|future|next)\b/i],
  ["wellbeing", /\b(wellbeing|well-being|balance|rest|energy|habit|stress|burnout|overwhelm)\b/i],
];

export function classifyQuestionContext(
  question: string,
  input: { topic: ReadingTopic; horizon: ReadingHorizon; generalReading: boolean },
): QuestionClassification {
  const topic =
    input.generalReading || input.topic !== "general"
      ? input.topic
      : (inferredTopics.find(([, pattern]) => pattern.test(question))?.[0] ?? "general");
  const intent = input.generalReading
    ? "generalReflection"
    : /\b(choose|choice|decid|should i|which path)\b/i.test(question)
      ? "decisionSupport"
      : /\b(plan|prepare|next step|approach)\b/i.test(question)
        ? "planning"
        : /\b(feel|emotion|process|grief|conflict)\b/i.test(question)
          ? "emotionalProcessing"
          : "clarity";
  return questionClassificationSchema.parse({
    version: "question-classification-v1",
    topic,
    horizon: input.horizon,
    intent,
    generalReading: input.generalReading,
  });
}

export interface ReadingGenerationInput {
  readonly draw: LockedDraw;
  readonly question: string;
  readonly questionClassification: QuestionClassification;
  readonly relevantTraitStatements: readonly string[];
}

export interface FollowUpGenerationInput extends ReadingGenerationInput {
  readonly originalResult: ReadingResult;
}

export interface ReadingLens {
  readonly version: "question-trait-lens-v2";
  readonly traitIndexes: readonly number[];
  readonly tensionIndexes: readonly number[];
  readonly statements: readonly string[];
}

interface LensFocus {
  readonly topic: ReadingTopic;
  readonly pattern?: RegExp;
  readonly lifeDomain: ProfileLifeDomain;
  readonly traitDomains: readonly ProfileTrait["domain"][];
}

const questionDomains: readonly LensFocus[] = [
  {
    topic: "career",
    pattern: /\b(work|career|job|business|project|lead|decision)\b/i,
    lifeDomain: "career",
    traitDomains: [
      "workStyle",
      "decisionStyle",
      "riskOrientation",
      "creativeExpression",
      "communicationStyle",
    ],
  },
  {
    topic: "relationships",
    pattern: /\b(love|relationship|partner|friend|family|communicat|conflict)\b/i,
    lifeDomain: "relationships",
    traitDomains: [
      "relationshipNeeds",
      "communicationStyle",
      "conflictResponse",
      "emotionalProcessing",
      "socialOrientation",
    ],
  },
  {
    topic: "change",
    pattern: /\b(change|move|choice|direction|future|next)\b/i,
    lifeDomain: "change",
    traitDomains: [
      "stabilityVsChange",
      "growthLever",
      "decisionStyle",
      "coreMotivation",
      "riskOrientation",
    ],
  },
  {
    topic: "wellbeing",
    pattern: /\b(wellbeing|well-being|balance|rest|energy|habit|stress)\b/i,
    lifeDomain: "general",
    traitDomains: ["emotionalProcessing", "stabilityVsChange", "growthLever", "coreMotivation"],
  },
];

const generalFocus: LensFocus = {
  topic: "general",
  lifeDomain: "general",
  traitDomains: ["coreMotivation", "growthLever"],
};

const confidenceRank: Record<ProfileTrait["confidence"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function tensionLensStatement(tension: ProfileTension): string {
  return `Tension to hold: ${tension.sideA} At the same time, ${tension.sideB}`;
}

export function readingLensStatements(
  lens: { readonly traitIndexes: readonly number[]; readonly tensionIndexes?: readonly number[] },
  traits: readonly ProfileTrait[],
  tensions: readonly ProfileTension[] = [],
): readonly string[] {
  return [
    ...lens.traitIndexes.map((index) => traits[index]?.statement),
    ...(lens.tensionIndexes ?? []).map((index) => {
      const tension = tensions[index];
      return tension ? tensionLensStatement(tension) : undefined;
    }),
  ].filter((statement): statement is string => Boolean(statement));
}

export function selectReadingLens(
  question: string,
  traits: readonly ProfileTrait[],
  tensions: readonly ProfileTension[] = [],
  selectedTopic: ReadingTopic = "general",
): ReadingLens {
  const focus =
    (selectedTopic === "general"
      ? questionDomains.find(({ pattern }) => pattern?.test(question))
      : questionDomains.find(({ topic }) => topic === selectedTopic)) ?? generalFocus;
  const relevantTensions = tensions
    .map((tension, index) => ({ tension, index }))
    .filter(({ tension }) => tension.lifeDomains.includes(focus.lifeDomain))
    .filter(({ tension }) =>
      tension.traitIndexes.every((index) => traits[index]?.stability === "stable"),
    )
    .slice(0, 1);
  const traitLimit = relevantTensions.length > 0 ? 2 : 3;
  const ranked = traits
    .map((trait, index) => ({ trait, index }))
    .filter(
      ({ trait }) =>
        trait.stability === "stable" &&
        trait.lifeDomains.includes(focus.lifeDomain) &&
        focus.traitDomains.includes(trait.domain),
    )
    .sort((left, right) => {
      const domainDifference =
        focus.traitDomains.indexOf(left.trait.domain) -
        focus.traitDomains.indexOf(right.trait.domain);
      if (domainDifference !== 0) return domainDifference;
      const confidenceDifference =
        confidenceRank[left.trait.confidence] - confidenceRank[right.trait.confidence];
      if (confidenceDifference !== 0) return confidenceDifference;
      const strengthDifference = right.trait.strength - left.trait.strength;
      return strengthDifference === 0 ? left.index - right.index : strengthDifference;
    })
    .slice(0, traitLimit);
  const tensionStatements = relevantTensions.map(({ tension }) => tensionLensStatement(tension));
  return {
    version: "question-trait-lens-v2",
    traitIndexes: ranked.map(({ index }) => index),
    tensionIndexes: relevantTensions.map(({ index }) => index),
    statements: [...ranked.map(({ trait }) => trait.statement), ...tensionStatements],
  };
}

export class DeterministicFallbackProvider implements ReadingInterpretationProvider {
  readonly id = FALLBACK_PROVIDER_ID;

  async generate(input: ReadingGenerationInput): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const subject = questionSubject(input.question, input.questionClassification.topic);
    const voice = subjectVoices[subject];
    const resolved = resolveDraw(input.draw, input.questionClassification);
    const answer = answerCard(input.draw, resolved);
    const traits = input.relevantTraitStatements;
    const frame = buildQuestionFrame(input.question, input.questionClassification, subject);
    const guarded = safety.category !== "ordinary";
    const agency = agencySteps(frame, answer, traits, guarded);
    const reflection = conversationalReflectionQuestion(frame, answer);
    const openingId = "opening";
    const turningId = "turning-point";
    const likelyId = "likely-trajectory";
    const alternateId = "alternate-trajectory";
    const agencyId = "agency";
    const closingId = "closing";
    const cardPassages = resolved.map((entry, index) => ({
      id: `thread-${index + 1}`,
      role:
        index === 0
          ? ("situation" as const)
          : index === resolved.length - 1
            ? ("development" as const)
            : ("underlyingPattern" as const),
      text: conversationalCardNarration(entry, frame, index, guarded),
      cardReferences: [entry.position.id],
    }));
    const passages = [
      {
        id: openingId,
        role: safety.category === "ordinary" ? ("opening" as const) : ("safety" as const),
        text:
          safety.category === "ordinary"
            ? conversationalOpeningNarration(answer, frame, resolved)
            : guardedDirectAnswer(
                safety.category,
                voice.about,
                `This reading won't turn that into a factual prediction. ${safety.guidance}`,
              ),
        cardReferences: [answer.position.id],
      },
      ...cardPassages,
      {
        id: turningId,
        role: "turningPoint" as const,
        text: conversationalTurningPointNarration(answer, resolved, frame, traits[0]),
        cardReferences: [],
      },
      {
        id: likelyId,
        role: "trajectory" as const,
        text: conversationalLikelyNarration(answer, resolved, frame, guarded),
        cardReferences: [],
      },
      {
        id: alternateId,
        role: "alternative" as const,
        text: conversationalAlternateNarration(resolved, frame, guarded),
        cardReferences: [],
      },
      {
        id: agencyId,
        role: "agency" as const,
        text: conversationalAgencyNarration(agency),
        cardReferences: [],
      },
      {
        id: closingId,
        role: "closing" as const,
        text: conversationalClosingNarration(frame, answer),
        cardReferences: [],
      },
    ];

    return readingResultSchema.parse({
      schemaVersion: "reading-result-v2",
      title: conversationalNarrationTitle(frame, answer),
      passages,
      cards: resolved.map((entry, index) => ({
        positionId: entry.position.id,
        cardId: entry.card.id,
        orientation: entry.orientation,
        passageIds: [
          `thread-${index + 1}`,
          ...(entry.position.id === answer.position.id ? [openingId] : []),
        ],
      })),
      trajectory: {
        likelyPassageId: likelyId,
        conditions: trajectoryConditions(answer, resolved, frame),
        alternatePassageId: alternateId,
      },
      userAgency: agency,
      reflectionQuestion: reflection,
      disconfirmingEvidence: conversationalDisconfirmingEvidence(frame, answer),
      uncertainty:
        "Tarot offers a conditional interpretation, not factual proof or a guarantee. New evidence, choices, and changing conditions can alter the direction described.",
      safetyFlags: safety.category === "ordinary" ? [] : [safety.category],
    });
  }

  async generateWithProvenance(input: ReadingGenerationInput): Promise<ReadingGenerationOutcome> {
    return {
      result: await this.generate(input),
      provenance: {
        providerId: this.id,
        promptVersion: FALLBACK_PROMPT_VERSION,
        schemaVersion: READING_RESULT_SCHEMA_VERSION,
      },
    };
  }

  async generateFollowUp(input: FollowUpGenerationInput): Promise<FollowUpResult> {
    return (await this.generateFollowUpWithProvenance(input)).result;
  }

  async generateFollowUpWithProvenance(
    input: FollowUpGenerationInput,
  ): Promise<FollowUpGenerationOutcome> {
    const resolved = resolveDraw(input.draw, input.questionClassification);
    const answer = answerCard(input.draw, resolved);
    const originalThread = input.originalResult.cards.find(
      ({ positionId }) => positionId === answer.position.id,
    );
    const originalPassage = input.originalResult.passages.find(({ id }) =>
      originalThread?.passageIds.includes(id),
    );
    const trait = naturalTrait(input.relevantTraitStatements[0]);
    return {
      result: followUpResultSchema.parse({
        response: [
          `Coming back to ${answer.card.name}${answer.orientation === "reversed" ? " reversed" : ""}, the part that matters now is ${answer.themes.join(" and ")}.`,
          originalPassage?.text ??
            "That was already the thread carrying the original reading forward.",
          trait
            ? `Because ${trait}, I think the useful move is to notice the moment that familiar response begins and choose deliberately there.`
            : "I think the useful move is to wait for one observable change, then respond to that rather than to the fear of what might happen.",
          `For now, ${(input.originalResult.userAgency[0] ?? "Keep the next step small enough to revise").replace(/[.?!]+$/, "").replace(/^[A-Z]/, (letter) => letter.toLowerCase())}.`,
        ].join(" "),
      }),
      provenance: {
        providerId: this.id,
        promptVersion: FALLBACK_PROMPT_VERSION,
        schemaVersion: "follow-up-result-v1",
      },
    };
  }
}

function naturalTrait(trait: string | undefined): string | undefined {
  if (!trait) return undefined;
  const cleaned = trait
    .replace(/^Tension to hold:\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim();
  return cleaned.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

export class ValidatingProvider implements InterpretationProvider<
  ReadingGenerationInput,
  ReadingResult
> {
  constructor(private readonly provider: InterpretationProvider<ReadingGenerationInput, unknown>) {}
  get id() {
    return this.provider.id;
  }
  async generate(input: ReadingGenerationInput, signal?: AbortSignal) {
    return readingResultSchema.parse(await this.provider.generate(input, signal));
  }
}

export interface StreamingInterpretationAdapter {
  readonly id: string;
  streamPersistedResult(result: ReadingResult): AsyncIterable<OracleStreamEvent>;
  streamPersistedFollowUp(result: FollowUpResult): AsyncIterable<OracleStreamEvent>;
}

export function createOracleStreamEvents(result: ReadingResult): readonly OracleStreamEvent[] {
  const validated = readingResultSchema.parse(result);
  // Uncertainty and audit metadata remain stored on the result, while the
  // spoken stream contains only the ordered narration the reader authored.
  return validated.passages.map((passage, sequence) =>
    oracleStreamEventSchema.parse({
      type: "phase",
      sequence,
      phase: "narration",
      heading: sequence === 0 ? validated.title : "The reading continues",
      text: passage.text,
      passageId: passage.id,
      cardPositionIds: passage.cardReferences,
    }),
  );
}

export function createFollowUpStreamEvents(result: FollowUpResult): readonly OracleStreamEvent[] {
  const validated = followUpResultSchema.parse(result);
  return [
    oracleStreamEventSchema.parse({
      type: "phase",
      sequence: 0,
      phase: "followUp",
      heading: "The Cards Answer",
      text: validated.response,
    }),
  ];
}

export class PersistedResultStreamAdapter implements StreamingInterpretationAdapter {
  readonly id = "persisted-result-stream-v2";

  async *streamPersistedResult(result: ReadingResult): AsyncIterable<OracleStreamEvent> {
    for (const event of createOracleStreamEvents(result)) yield event;
    yield { type: "complete" };
  }

  async *streamPersistedFollowUp(result: FollowUpResult): AsyncIterable<OracleStreamEvent> {
    for (const event of createFollowUpStreamEvents(result)) yield event;
    yield { type: "complete" };
  }
}

import {
  classifyAiProviderBaseUrl,
  DEFAULT_GROQ_FALLBACK_MODELS,
  DEFAULT_GROQ_PRIMARY_MODEL,
  GroqInterpretationProvider,
  normalizedAiProviderBaseUrl,
} from "./groq-provider";

export {
  classifyAiProviderBaseUrl,
  DEFAULT_GROQ_BASE_URL,
  DEFAULT_GROQ_FALLBACK_MODELS,
  DEFAULT_GROQ_PRIMARY_MODEL,
  FOLLOW_UP_PROMPT_VERSION,
  GUARDED_CATEGORIES,
  GroqInterpretationProvider,
  PROMPT_VERSION,
  RESPONSE_SCHEMA_VERSION,
  REVIEWED_GATEWAY_SYSTEM_PROMPTS,
  normalizedAiProviderBaseUrl,
  reviewedFollowUpResponseSchema,
  reviewedReadingResponseSchema,
  type AiProviderEndpointKind,
  type GroqProviderOptions,
} from "./groq-provider";

export interface ConfiguredAiProviderRoute {
  readonly kind: "direct-groq" | "access-gateway" | "invalid";
  readonly transport: "direct" | "tokenpak" | "invalid";
  readonly baseUrl: string;
  readonly accessProtected: boolean;
  readonly invalidEnvironmentVariables: readonly string[];
}

interface ResolvedAiProviderRoute extends ConfiguredAiProviderRoute {
  readonly authorizationToken?: string;
  readonly cloudflareAccessClientId?: string;
  readonly cloudflareAccessClientSecret?: string;
  readonly approvedGatewayHostname?: string;
}

function configuredSecret(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function resolveAiProviderRoute(): ResolvedAiProviderRoute {
  const configuredTransport = process.env.AI_PROVIDER_TRANSPORT?.trim() || "direct";
  const transport =
    configuredTransport === "direct" || configuredTransport === "tokenpak"
      ? configuredTransport
      : "invalid";
  const baseUrl = normalizedAiProviderBaseUrl(process.env.AI_PROVIDER_BASE_URL);
  const kind = classifyAiProviderBaseUrl(baseUrl);
  const directApiKey = configuredSecret("AI_PROVIDER_API_KEY");
  const gatewayKey = configuredSecret("AI_PROVIDER_GATEWAY_KEY");
  const cloudflareAccessClientId = configuredSecret("AI_PROVIDER_CF_ACCESS_CLIENT_ID");
  const cloudflareAccessClientSecret = configuredSecret("AI_PROVIDER_CF_ACCESS_CLIENT_SECRET");
  const approvedGatewayHostname = configuredSecret("AI_PROVIDER_GATEWAY_HOST")?.toLowerCase();
  const gatewayApproved = process.env.AI_PROVIDER_GATEWAY_APPROVED === "true";
  const invalidEnvironmentVariables: string[] = [];

  if (transport === "invalid") invalidEnvironmentVariables.push("AI_PROVIDER_TRANSPORT");
  if (kind === "invalid") invalidEnvironmentVariables.push("AI_PROVIDER_BASE_URL");
  if (kind === "direct-groq") {
    if (transport !== "direct") invalidEnvironmentVariables.push("AI_PROVIDER_TRANSPORT");
    for (const [name, value] of [
      ["AI_PROVIDER_GATEWAY_KEY", gatewayKey],
      ["AI_PROVIDER_CF_ACCESS_CLIENT_ID", cloudflareAccessClientId],
      ["AI_PROVIDER_CF_ACCESS_CLIENT_SECRET", cloudflareAccessClientSecret],
      ["AI_PROVIDER_GATEWAY_HOST", approvedGatewayHostname],
      ["AI_PROVIDER_GATEWAY_APPROVED", gatewayApproved ? "true" : undefined],
    ] as const)
      if (value) invalidEnvironmentVariables.push(name);
  }
  if (kind === "access-gateway") {
    if (transport !== "tokenpak") invalidEnvironmentVariables.push("AI_PROVIDER_TRANSPORT");
    if (directApiKey) invalidEnvironmentVariables.push("AI_PROVIDER_API_KEY");
    if (!gatewayApproved) invalidEnvironmentVariables.push("AI_PROVIDER_GATEWAY_APPROVED");
    if (!gatewayKey || gatewayKey.length < 32)
      invalidEnvironmentVariables.push("AI_PROVIDER_GATEWAY_KEY");
    if (!cloudflareAccessClientId || cloudflareAccessClientId.length < 16)
      invalidEnvironmentVariables.push("AI_PROVIDER_CF_ACCESS_CLIENT_ID");
    if (!cloudflareAccessClientSecret || cloudflareAccessClientSecret.length < 32)
      invalidEnvironmentVariables.push("AI_PROVIDER_CF_ACCESS_CLIENT_SECRET");
    const routeHostname = kind === "access-gateway" ? new URL(baseUrl).hostname.toLowerCase() : "";
    if (
      !approvedGatewayHostname ||
      approvedGatewayHostname.endsWith(".") ||
      approvedGatewayHostname !== routeHostname
    )
      invalidEnvironmentVariables.push("AI_PROVIDER_GATEWAY_HOST");
  }

  return {
    kind,
    transport,
    baseUrl,
    accessProtected: kind === "access-gateway",
    invalidEnvironmentVariables,
    ...(kind === "direct-groq" && directApiKey ? { authorizationToken: directApiKey } : {}),
    ...(kind === "access-gateway" && gatewayKey ? { authorizationToken: gatewayKey } : {}),
    ...(cloudflareAccessClientId ? { cloudflareAccessClientId } : {}),
    ...(cloudflareAccessClientSecret ? { cloudflareAccessClientSecret } : {}),
    ...(approvedGatewayHostname ? { approvedGatewayHostname } : {}),
  };
}

/** Returns only non-secret transport state for readiness and operator checks. */
export function configuredAiProviderRoute(): ConfiguredAiProviderRoute {
  const route = resolveAiProviderRoute();
  return {
    kind: route.kind,
    transport: route.transport,
    baseUrl: route.baseUrl,
    accessProtected: route.accessProtected,
    invalidEnvironmentVariables: route.invalidEnvironmentVariables,
  };
}

export function configuredGroqModelChain(): readonly string[] {
  const primary = process.env.AI_PROVIDER_MODEL?.trim() || DEFAULT_GROQ_PRIMARY_MODEL;
  const configuredFallbacks = process.env.AI_PROVIDER_FALLBACK_MODELS;
  const fallbacks =
    configuredFallbacks === undefined
      ? DEFAULT_GROQ_FALLBACK_MODELS
      : configuredFallbacks
          .split(",")
          .map((model) => model.trim())
          .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

/**
 * Chooses the interpretation provider from configuration.
 *
 * `AI_PROVIDER=disabled`, an absent key, or an unapproved safety evaluation
 * yields the deterministic reader. Live narration is a separately approved
 * production gate rather than an accidental consequence of adding a key.
 */
export interface InterpretationRuntimeOptions {
  enabled?: boolean;
  modelChain?: readonly string[];
  promptBundleId?: RuntimePromptBundleId;
}

export function createInterpretationProvider(
  runtime: InterpretationRuntimeOptions = {},
): ReadingInterpretationProvider {
  const selected = process.env.AI_PROVIDER?.trim();
  const route = resolveAiProviderRoute();
  const safetyEvaluationApproved = process.env.AI_SAFETY_EVALUATION_APPROVED === "true";
  if (
    runtime.enabled === false ||
    selected !== "groq" ||
    !route.authorizationToken ||
    !safetyEvaluationApproved ||
    route.invalidEnvironmentVariables.length > 0
  )
    return new DeterministicFallbackProvider();
  const timeout = Number.parseInt(process.env.AI_PROVIDER_TIMEOUT_MS ?? "", 10);
  const totalTimeout = Number.parseInt(process.env.AI_PROVIDER_TOTAL_TIMEOUT_MS ?? "", 10);
  const maxOutput = Number.parseInt(process.env.AI_PROVIDER_MAX_OUTPUT_TOKENS ?? "", 10);
  const [model, ...fallbackModels] = runtime.modelChain ?? configuredGroqModelChain();
  return new GroqInterpretationProvider({
    apiKey: route.authorizationToken,
    model: model ?? DEFAULT_GROQ_PRIMARY_MODEL,
    fallbackModels,
    baseUrl: route.baseUrl,
    ...(route.approvedGatewayHostname
      ? { approvedGatewayHostname: route.approvedGatewayHostname }
      : {}),
    ...(route.cloudflareAccessClientId
      ? { cloudflareAccessClientId: route.cloudflareAccessClientId }
      : {}),
    ...(route.cloudflareAccessClientSecret
      ? { cloudflareAccessClientSecret: route.cloudflareAccessClientSecret }
      : {}),
    ...(Number.isFinite(timeout) ? { timeoutMs: timeout } : {}),
    ...(Number.isFinite(totalTimeout) ? { totalTimeoutMs: totalTimeout } : {}),
    ...(Number.isFinite(maxOutput) && maxOutput > 0 ? { maxOutputTokens: maxOutput } : {}),
    ...(runtime.promptBundleId ? { promptBundleId: runtime.promptBundleId } : {}),
  });
}

export { RUNTIME_PROMPT_BUNDLES, type RuntimePromptBundleId } from "./groq-provider";
