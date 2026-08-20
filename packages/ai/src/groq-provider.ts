import {
  followUpResultSchema,
  readingResultV2Schema,
  type FollowUpResult,
  type ReadingResult,
} from "@starguidance/contracts";
import { z } from "zod";

import {
  classifyQuestion,
  DeterministicFallbackProvider,
  FALLBACK_PROVIDER_ID,
  type FollowUpGenerationInput,
  type FollowUpGenerationOutcome,
  type ReadingGenerationOutcome,
  type ReadingGenerationInput,
  type ReadingInterpretationProvider,
} from "./index";
import { answerCard, resolveDraw } from "./interpretation";
import { generatedOutputSafetyViolation } from "./output-safety";

/**
 * A live interpretation provider, spoken in the voice of a reader.
 *
 * The model never chooses cards. It receives the already-locked draw, the
 * curated meanings for those cards, the position each landed in, the question,
 * and the minimised trait lens — nothing else. Raw birth name, exact birth
 * details and account identifiers are deliberately absent from the payload
 * (AI-002, AI-003), and the draw cannot change as a result of anything the
 * model returns.
 *
 * Output is schema-constrained and validated. Anything that fails validation,
 * times out, or errors falls back to the deterministic reading rather than
 * showing a person a broken or empty result (AI-015).
 */
export const PROMPT_VERSION = "reader-voice-v3" as const;
export const RESPONSE_SCHEMA_VERSION = "reading-result-v2" as const;
export const FOLLOW_UP_PROMPT_VERSION = "follow-up-reader-voice-v3" as const;
export const DEFAULT_GROQ_PRIMARY_MODEL = "openai/gpt-oss-120b" as const;
export const DEFAULT_GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
] as const;
export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1" as const;

const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 40_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_600;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const JSON_OBJECT_MODELS = new Set(["llama-3.3-70b-versatile"]);
const GPT_OSS_MODEL_PREFIX = "openai/gpt-oss-";

type StructuredOutputMode = "strict-json-schema" | "json-object";

type FallbackReason =
  | "request-timeout"
  | "authentication"
  | "rate-limited"
  | "provider-unavailable"
  | "request-rejected"
  | "invalid-response"
  | "unsafe-response"
  | "network-error"
  | "unknown";

class ProviderRequestError extends Error {
  constructor(readonly reason: FallbackReason) {
    super(`AI_PROVIDER_${reason.toUpperCase().replaceAll("-", "_")}`);
  }
}

function fallbackReason(error: unknown): FallbackReason {
  if (error instanceof ProviderRequestError) return error.reason;
  if (error instanceof SyntaxError) return "invalid-response";
  if (error instanceof TypeError) return "network-error";
  if (error instanceof Error && error.name === "ZodError") return "invalid-response";
  return "unknown";
}

/**
 * Categories where a confident prediction would do real harm. Exported so
 * apps/web's reading UI can pause for the same categories before the deck is
 * even shuffled (see reading-scene.tsx), rather than only shaping the voice
 * of a result that already exists.
 */
export const GUARDED_CATEGORIES = new Set([
  "selfHarmCrisis",
  "medical",
  "legal",
  "financial",
  "mentalHealthDiagnosis",
  "physicalDeath",
  "criminalGuilt",
  "pregnancy",
  "infidelity",
  "thirdPartyPrivateClaim",
]);

const READER_VOICE = [
  "You are a conversational divination narrator speaking as an intuitive continuation of an existing conversation.",
  "Use the locked cards to understand what appears to be happening in the person's life and where it may be heading; do not explain tarot academically.",
  "Internally reason through the current situation, underlying pattern, remembered personal tendencies, likely next development, observable manifestation, tension, turning point, and direction afterward. Never expose that structure.",
  "Write ordered spoken passages with no headings inside their text. The passages must join into one continuous narration, not a structured report.",
  "Sound warm, perceptive, calm, thoughtful, slightly mysterious, and natural. Use contractions, varied sentence length, and occasional short sentences for emphasis.",
  "Include meaningful conditional prediction. Favor concrete plausible manifestations such as a conversation, decision, opportunity, changed behavior, obstacle, work or financial development, or realization.",
  "Use phrases such as 'I think you're going to notice', 'you may soon find', 'I wouldn't be surprised if', 'watch for', and 'the turning point may come when' where natural—not mechanically.",
  "Silently integrate only relevant readerLens statements. Never announce a profile, personal lens, astrology, numerology, or what you know about the person.",
  "Preserve each card's orientation, supplied traditional themes, and positional function, including both constructive and shadow expressions. The profile may change emphasis but never card meaning.",
  "For relationship material, never claim another person's private thoughts, motives, or feelings. Speak only through observable behavior, possible signals held with uncertainty, direct communication, boundaries, evidence, and the user's choices.",
  "Do not name every card or every position. Name the answer-bearing card once near the opening when natural, then let the interpretation become the person's story.",
  "Never write or imply visible sections such as 'Traditional current', 'Your personal lens', 'Connection to your question', 'The advice is', 'Likely trajectory', or 'Alternate trajectory'.",
  "Do not sound like a tarot encyclopedia, therapist, horoscope generator, academic report, or mystical performance. Do not manufacture drama.",
  "Include tension, contradiction, reversal, foreshadowing, hidden significance, or unresolved curiosity where the draw genuinely supports it.",
  "Vary the ending: prediction, realization, foreshadowing, gentle warning, reflection, or an open question. Do not always end with a question.",
  "The supplied questionContext.topic is authoritative; infer from wording only when it is general.",
  "Echo every supplied positionId, cardId, and orientation exactly. Use only supplied position IDs in cardReferences.",
  "Return unique passage IDs; passageIds and trajectory passage IDs must reference passages in the same response.",
  "Every required prose string and every list the schema marks as non-empty must contain a meaningful value.",
  "Do not restate or quote the raw question. Do not mention being an AI. Do not put a disclaimer in the spoken passages; uncertainty is stored separately.",
].join(" ");

const GUARDED_VOICE = [
  "This question touches something where a confident prediction could cause real harm.",
  "Do not diagnose, do not predict death, illness, pregnancy, guilt, or a verdict, and do not assert",
  "infidelity, private facts about anyone who is not present, investment returns, guaranteed employment,",
  "or any guaranteed outcome. Read the cards for what this person can see, decide,",
  "prepare for, and ask about — and point them toward qualified help where that is the honest answer.",
  "Stay warm and direct. This is a redirection, not a refusal.",
].join(" ");

const FOLLOW_UP_VOICE = [
  "Answer the follow-up as one cohesive response, never as a second full reading.",
  "Refer naturally to one relevant card when useful, without mechanically naming its position.",
  "Silently carry forward the original narration and relevant reader-lens trait.",
  "Stay focused on the follow-up. Do not use headings, lists, disclaimers, or repeat the spread.",
].join(" ");

export const REVIEWED_GATEWAY_SYSTEM_PROMPTS = Object.freeze({
  reading: READER_VOICE,
  guardedReading: `${READER_VOICE} ${GUARDED_VOICE}`,
  followUp: `${READER_VOICE} ${FOLLOW_UP_VOICE}`,
  guardedFollowUp: `${READER_VOICE} ${FOLLOW_UP_VOICE} ${GUARDED_VOICE}`,
});

const GROUNDED_VOICE = [
  "Keep the narration especially concrete and economical.",
  "Prefer observable signals, explicit choices, and near-term conditions over abstract symbolism.",
  "Leave room for ambiguity without weakening the direct answer.",
].join(" ");

export const RUNTIME_PROMPT_BUNDLES = Object.freeze({
  "reader-voice-v3": {
    readingVersion: PROMPT_VERSION,
    followUpVersion: FOLLOW_UP_PROMPT_VERSION,
    ...REVIEWED_GATEWAY_SYSTEM_PROMPTS,
  },
  "reader-voice-v3-grounded": {
    readingVersion: "reader-voice-v3-grounded",
    followUpVersion: "follow-up-reader-voice-v3-grounded",
    reading: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading} ${GROUNDED_VOICE}`,
    guardedReading: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.guardedReading} ${GROUNDED_VOICE}`,
    followUp: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.followUp} ${GROUNDED_VOICE}`,
    guardedFollowUp: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.guardedFollowUp} ${GROUNDED_VOICE}`,
  },
});

export type RuntimePromptBundleId = keyof typeof RUNTIME_PROMPT_BUNDLES;

export interface GroqProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModels?: readonly string[];
  readonly baseUrl?: string;
  readonly approvedGatewayHostname?: string;
  readonly cloudflareAccessClientId?: string;
  readonly cloudflareAccessClientSecret?: string;
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxOutputTokens?: number;
  readonly promptBundleId?: RuntimePromptBundleId;
}

export type AiProviderEndpointKind = "direct-groq" | "access-gateway" | "invalid";

export function normalizedAiProviderBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_GROQ_BASE_URL).replace(/\/+$/, "");
}

/**
 * Classifies the only two network paths this adapter may use.
 *
 * A custom origin is deliberately narrow: an HTTPS hostname with an exact
 * `/v1` base path. Loopback, IP literals, userinfo, query strings, fragments,
 * and local-only names are rejected before fetch can turn a configuration
 * typo into SSRF. DNS and egress policy remain mandatory at the gateway host.
 */
export function classifyAiProviderBaseUrl(baseUrl?: string): AiProviderEndpointKind {
  const normalized = normalizedAiProviderBaseUrl(baseUrl);
  if (normalized === DEFAULT_GROQ_BASE_URL) return "direct-groq";

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const localHostname =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".") ||
      hostname.includes(":") ||
      /^\d+(?:\.\d+){3}$/.test(hostname);
    if (
      url.protocol !== "https:" ||
      !hostname.includes(".") ||
      localHostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/v1"
    )
      return "invalid";
    return "access-gateway";
  } catch {
    return "invalid";
  }
}

function validateTransportOptions(options: GroqProviderOptions): AiProviderEndpointKind {
  const endpointKind = classifyAiProviderBaseUrl(options.baseUrl);
  const accessClientId = options.cloudflareAccessClientId?.trim();
  const accessClientSecret = options.cloudflareAccessClientSecret?.trim();
  const approvedGatewayHostname = options.approvedGatewayHostname?.trim().toLowerCase();
  if (endpointKind === "invalid") throw new Error("AI_PROVIDER_BASE_URL_INVALID");
  if (
    endpointKind === "direct-groq" &&
    (accessClientId || accessClientSecret || approvedGatewayHostname)
  )
    throw new Error("AI_PROVIDER_ACCESS_CREDENTIALS_FOR_DIRECT_GROQ");
  if (
    endpointKind === "access-gateway" &&
    (!accessClientId ||
      !accessClientSecret ||
      !approvedGatewayHostname ||
      new URL(normalizedAiProviderBaseUrl(options.baseUrl)).hostname.toLowerCase() !==
        approvedGatewayHostname)
  )
    throw new Error("AI_PROVIDER_ACCESS_CREDENTIALS_INCOMPLETE");
  return endpointKind;
}

async function readBoundedProviderJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > MAX_PROVIDER_RESPONSE_BYTES)
      throw new ProviderRequestError("invalid-response");
  }
  if (!response.body) throw new ProviderRequestError("invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROVIDER_RESPONSE_BYTES) throw new ProviderRequestError("invalid-response");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueModelChain(primary: string, fallbacks: readonly string[] = []): readonly string[] {
  return [...new Set([primary, ...fallbacks].map((model) => model.trim()).filter(Boolean))];
}

function structuredOutputMode(model: string): StructuredOutputMode {
  return JSON_OBJECT_MODELS.has(model) ? "json-object" : "strict-json-schema";
}

function shouldTryFallback(error: unknown): boolean {
  // Every candidate uses the same Groq credential. Retrying another model on
  // an authentication failure only adds latency and cannot recover the call.
  return fallbackReason(error) !== "authentication";
}

type ResolvedDraw = ReturnType<typeof resolveDraw>;

function exactCardSchema(entry: ResolvedDraw[number]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["positionId", "cardId", "orientation", "passageIds"],
    properties: {
      positionId: { type: "string", enum: [entry.position.id], minLength: 1 },
      cardId: { type: "string", enum: [entry.card.id], minLength: 1 },
      orientation: { type: "string", enum: [entry.orientation] },
      passageIds: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
      },
    },
  };
}

/** The JSON Schema the model is constrained to. Mirrors readingResultSchema. */
export function reviewedReadingResponseSchema(resolved: ResolvedDraw): Record<string, unknown> {
  const cardCount = resolved.length;
  const positionIds = resolved.map(({ position }) => position.id);
  const exactCards = resolved.map(exactCardSchema);
  const passage = {
    type: "object",
    additionalProperties: false,
    required: ["id", "role", "text", "cardReferences"],
    properties: {
      id: { type: "string", minLength: 1 },
      role: {
        type: "string",
        enum: [
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
        ],
      },
      text: { type: "string", minLength: 1 },
      cardReferences: {
        type: "array",
        items: { type: "string", enum: positionIds },
        maxItems: cardCount,
      },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "title",
      "passages",
      "cards",
      "trajectory",
      "userAgency",
      "reflectionQuestion",
      "disconfirmingEvidence",
      "uncertainty",
      "safetyFlags",
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["reading-result-v2"] },
      title: { type: "string", minLength: 1 },
      passages: { type: "array", items: passage, minItems: 3, maxItems: 24 },
      cards: {
        type: "array",
        items: exactCards.length === 1 ? exactCards[0] : { anyOf: exactCards },
        minItems: cardCount,
        maxItems: cardCount,
      },
      trajectory: {
        type: "object",
        additionalProperties: false,
        required: ["likelyPassageId", "conditions", "alternatePassageId"],
        properties: {
          likelyPassageId: { type: "string", minLength: 1 },
          conditions: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
          },
          alternatePassageId: { type: "string", minLength: 1 },
        },
      },
      userAgency: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
      },
      reflectionQuestion: { type: "string", minLength: 1 },
      disconfirmingEvidence: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
      },
      uncertainty: { type: "string", minLength: 1 },
      safetyFlags: { type: "array", items: { type: "string" } },
    },
  };
}

// The public contract deliberately adds relational refinements (unique passage
// IDs and valid cross-references) on top of this structural shape. Parse the
// provider's authored content first, then rebuild only that internal metadata
// before applying the complete contract. Prose, safety fields, card identity,
// and card orientation are never repaired or invented here.
const providerReadingResultSchema = z.object(readingResultV2Schema.shape).strict();

function canonicalizeProviderReading(value: unknown, resolved: ResolvedDraw): ReadingResult {
  const parsed = providerReadingResultSchema.parse(value);
  if (parsed.cards.length !== resolved.length) throw new ProviderRequestError("invalid-response");

  const parsedByPosition = new Map(parsed.cards.map((card) => [card.positionId, card]));
  for (const entry of resolved) {
    const echoed = parsedByPosition.get(entry.position.id);
    if (!echoed || echoed.cardId !== entry.card.id || echoed.orientation !== entry.orientation)
      throw new ProviderRequestError("invalid-response");
  }

  const orderedCards = resolved.map((entry) => ({
    ...parsedByPosition.get(entry.position.id)!,
    // Re-assert the locked tuple so no later refactor can make provider
    // metadata authoritative over the persisted draw.
    positionId: entry.position.id,
    cardId: entry.card.id,
    orientation: entry.orientation,
  }));
  const fullyValid = readingResultV2Schema.safeParse({ ...parsed, cards: orderedCards });
  if (fullyValid.success) return fullyValid.data;

  // At this point every authored field has passed the structural contract and
  // every card has echoed the locked draw exactly. Only relational metadata
  // covered by readingResultV2Schema.superRefine can be invalid. Repair only
  // links that have unambiguous authored evidence; never attach arbitrary
  // prose to a card or trajectory to make a response pass validation.
  const expectedPositionIds = resolved.map(({ position }) => position.id);
  const expectedPositionSet = new Set(expectedPositionIds);
  const positionByCardId = new Map(resolved.map(({ card, position }) => [card.id, position.id]));
  const passageIds = new Set(parsed.passages.map(({ id }) => id));
  if (passageIds.size !== parsed.passages.length)
    throw new ProviderRequestError("invalid-response");

  const passages = parsed.passages.map((passage) => {
    return {
      ...passage,
      cardReferences: [
        ...new Set(
          passage.cardReferences
            .map((reference) =>
              expectedPositionSet.has(reference) ? reference : positionByCardId.get(reference),
            )
            .filter((positionId): positionId is string => Boolean(positionId)),
        ),
      ],
    };
  });

  const trajectoryPassageId = (requested: string, role: "trajectory" | "alternative"): string => {
    if (passageIds.has(requested)) return requested;
    const roleMatches = passages.filter((passage) => passage.role === role);
    if (roleMatches.length !== 1) throw new ProviderRequestError("invalid-response");
    return roleMatches[0]!.id;
  };

  const cards = orderedCards.map((card) => {
    const directPassageIds = card.passageIds.filter((passageId) => passageIds.has(passageId));
    const reciprocalPassageIds = passages
      .filter(({ cardReferences }) => cardReferences.includes(card.positionId))
      .map(({ id }) => id);
    const authoredPassageIds = [...new Set([...directPassageIds, ...reciprocalPassageIds])];
    if (authoredPassageIds.length === 0) throw new ProviderRequestError("invalid-response");
    return {
      ...card,
      passageIds: authoredPassageIds,
    };
  });

  return readingResultV2Schema.parse({
    ...parsed,
    passages,
    cards,
    trajectory: {
      ...parsed.trajectory,
      likelyPassageId: trajectoryPassageId(parsed.trajectory.likelyPassageId, "trajectory"),
      alternatePassageId: trajectoryPassageId(parsed.trajectory.alternatePassageId, "alternative"),
    },
  });
}

export function reviewedFollowUpResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["response"],
    properties: { response: { type: "string", minLength: 1 } },
  };
}

export class GroqInterpretationProvider implements ReadingInterpretationProvider {
  readonly id: string;
  private readonly fallback = new DeterministicFallbackProvider();
  private readonly models: readonly string[];
  private readonly baseUrl: string;
  private readonly endpointKind: AiProviderEndpointKind;
  private readonly transportId: "direct" | "gateway";
  private readonly cloudflareAccessClientId: string | undefined;
  private readonly cloudflareAccessClientSecret: string | undefined;
  private readonly authorizationToken: string;
  private readonly promptBundle: (typeof RUNTIME_PROMPT_BUNDLES)[RuntimePromptBundleId];

  constructor(private readonly options: GroqProviderOptions) {
    this.endpointKind = validateTransportOptions(options);
    this.authorizationToken = options.apiKey.trim();
    this.transportId = this.endpointKind === "access-gateway" ? "gateway" : "direct";
    this.baseUrl = normalizedAiProviderBaseUrl(options.baseUrl);
    this.cloudflareAccessClientId = options.cloudflareAccessClientId?.trim();
    this.cloudflareAccessClientSecret = options.cloudflareAccessClientSecret?.trim();
    this.models = uniqueModelChain(options.model, options.fallbackModels);
    this.promptBundle = RUNTIME_PROMPT_BUNDLES[options.promptBundleId ?? PROMPT_VERSION];
    const transport = this.endpointKind === "access-gateway" ? "groq-gateway" : "groq";
    this.id = `${transport}:${this.models[0] ?? options.model}`;
  }

  /** The payload sent to the provider. Exposed so tests can assert what leaves. */
  buildPayload(input: ReadingGenerationInput) {
    const resolved = resolveDraw(input.draw, input.questionClassification);
    const answer = answerCard(input.draw, resolved);
    return {
      question: input.question,
      questionContext: input.questionClassification,
      spreadId: input.draw.spreadId,
      answerPositionId: answer.position.id,
      cards: resolved.map((entry) => ({
        positionId: entry.position.id,
        positionName: entry.position.displayName,
        positionMeans: entry.position.interpretiveFunction,
        cardId: entry.card.id,
        card: entry.card.name,
        arcana: entry.card.arcana,
        orientation: entry.orientation,
        themes: entry.themes,
      })),
      readerLens: input.relevantTraitStatements,
    };
  }

  buildFollowUpPayload(input: FollowUpGenerationInput) {
    return {
      ...this.buildPayload(input),
      originalReading: {
        title: input.originalResult.title,
        passages: input.originalResult.passages,
        cards: input.originalResult.cards,
        trajectory: input.originalResult.trajectory,
        userAgency: input.originalResult.userAgency,
      },
    };
  }

  async generate(input: ReadingGenerationInput, signal?: AbortSignal): Promise<ReadingResult> {
    return (await this.generateWithProvenance(input, signal)).result;
  }

  async generateWithProvenance(
    input: ReadingGenerationInput,
    signal?: AbortSignal,
  ): Promise<ReadingGenerationOutcome> {
    try {
      const generated = await this.withModelFallback(
        (model, mode, timeoutMs) => this.callProvider(input, model, mode, timeoutMs, signal),
        signal,
      );
      return {
        result: generated.value,
        provenance: {
          providerId:
            this.transportId === "gateway"
              ? `groq-gateway:${generated.model}`
              : `groq:${generated.model}`,
          promptVersion: this.promptBundle.readingVersion,
          schemaVersion: RESPONSE_SCHEMA_VERSION,
        },
      };
    } catch (error) {
      // A person who asked a question gets a reading either way (AI-015).
      const generated = await this.fallback.generateWithProvenance(input);
      return {
        ...generated,
        provenance: {
          ...generated.provenance,
          // The output remains deterministic, while this fixed identifier says
          // why the configured live path did not produce it. It contains no
          // response body, request data, credential, URL or exception text.
          providerId:
            this.transportId === "gateway"
              ? `${FALLBACK_PROVIDER_ID}:after-groq-gateway-${fallbackReason(error)}`
              : `${FALLBACK_PROVIDER_ID}:after-groq-${fallbackReason(error)}`,
        },
      };
    }
  }

  async generateFollowUp(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpResult> {
    return (await this.generateFollowUpWithProvenance(input, signal)).result;
  }

  async generateFollowUpWithProvenance(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpGenerationOutcome> {
    try {
      const generated = await this.withModelFallback(
        (model, mode, timeoutMs) =>
          this.callFollowUpProvider(input, model, mode, timeoutMs, signal),
        signal,
      );
      return {
        result: generated.value,
        provenance: {
          providerId:
            this.transportId === "gateway"
              ? `groq-gateway:${generated.model}`
              : `groq:${generated.model}`,
          promptVersion: this.promptBundle.followUpVersion,
          schemaVersion: "follow-up-result-v1",
        },
      };
    } catch (error) {
      const generated = await this.fallback.generateFollowUpWithProvenance(input);
      return {
        ...generated,
        provenance: {
          ...generated.provenance,
          providerId:
            this.transportId === "gateway"
              ? `${FALLBACK_PROVIDER_ID}:after-groq-gateway-${fallbackReason(error)}`
              : `${FALLBACK_PROVIDER_ID}:after-groq-${fallbackReason(error)}`,
        },
      };
    }
  }

  private async withModelFallback<T>(
    attempt: (model: string, mode: StructuredOutputMode, timeoutMs: number) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ value: T; model: string }> {
    const attemptTimeoutMs = positiveTimeout(this.options.timeoutMs, DEFAULT_ATTEMPT_TIMEOUT_MS);
    const totalTimeoutMs = positiveTimeout(this.options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
    const deadline = Date.now() + totalTimeoutMs;
    let lastError: unknown = new ProviderRequestError("unknown");

    for (const model of this.models) {
      if (signal?.aborted) throw new ProviderRequestError("request-timeout");
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new ProviderRequestError("request-timeout");
      try {
        return {
          value: await attempt(
            model,
            structuredOutputMode(model),
            Math.min(attemptTimeoutMs, remainingMs),
          ),
          model,
        };
      } catch (error) {
        lastError = error;
        if (signal?.aborted || !shouldTryFallback(error)) throw error;
      }
    }
    throw lastError;
  }

  private async callProvider(
    input: ReadingGenerationInput,
    model: string,
    mode: StructuredOutputMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
    const resolved = resolveDraw(input.draw, input.questionClassification);
    const parsed = canonicalizeProviderReading(
      await this.requestStructured(
        guarded ? this.promptBundle.guardedReading : this.promptBundle.reading,
        this.buildPayload(input),
        "reading",
        reviewedReadingResponseSchema(resolved),
        this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        model,
        mode,
        timeoutMs,
        signal,
      ),
      resolved,
    );
    if (generatedOutputSafetyViolation(parsed)) throw new ProviderRequestError("unsafe-response");
    return readingResultV2Schema.parse({
      ...parsed,
      safetyFlags: safety.category === "ordinary" ? parsed.safetyFlags : [safety.category],
    });
  }

  private async callFollowUpProvider(
    input: FollowUpGenerationInput,
    model: string,
    mode: StructuredOutputMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<FollowUpResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
    const system = guarded ? this.promptBundle.guardedFollowUp : this.promptBundle.followUp;
    const parsed = followUpResultSchema.parse(
      await this.requestStructured(
        system,
        this.buildFollowUpPayload(input),
        "follow_up",
        reviewedFollowUpResponseSchema(),
        Math.min(this.options.maxOutputTokens ?? 900, 1_200),
        model,
        mode,
        timeoutMs,
        signal,
      ),
    );
    if (generatedOutputSafetyViolation(parsed)) throw new ProviderRequestError("unsafe-response");
    return parsed;
  }

  private async requestStructured(
    system: string,
    payload: unknown,
    schemaName: string,
    schema: Record<string, unknown>,
    maxOutputTokens: number,
    model: string,
    mode: StructuredOutputMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    const modelSystem =
      mode === "json-object"
        ? `${system} Return only one JSON object matching this JSON Schema exactly: ${JSON.stringify(schema)}`
        : system;
    const responseFormat =
      mode === "json-object"
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: { name: schemaName, strict: true, schema },
          };

    try {
      const headers = new Headers({
        authorization: `Bearer ${this.authorizationToken}`,
        "content-type": "application/json",
      });
      if (this.endpointKind === "access-gateway") {
        headers.set("CF-Access-Client-Id", this.cloudflareAccessClientId ?? "");
        headers.set("CF-Access-Client-Secret", this.cloudflareAccessClientSecret ?? "");
      }
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.85,
          max_completion_tokens: maxOutputTokens,
          ...(model.startsWith(GPT_OSS_MODEL_PREFIX)
            ? { reasoning_effort: "low", include_reasoning: false }
            : {}),
          messages: [
            { role: "system", content: modelSystem },
            { role: "user", content: JSON.stringify(payload) },
          ],
          response_format: responseFormat,
        }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const reason: FallbackReason =
          response.status === 401
            ? "authentication"
            : response.status === 429
              ? "rate-limited"
              : response.status >= 500
                ? "provider-unavailable"
                : "request-rejected";
        throw new ProviderRequestError(reason);
      }
      const body = (await readBoundedProviderJson(response)) as {
        choices?: {
          finish_reason?: string | null;
          message?: { content?: string };
        }[];
      };
      const choice = body.choices?.[0];
      if (choice?.finish_reason !== undefined && choice.finish_reason !== "stop")
        throw new ProviderRequestError("invalid-response");
      const content = choice?.message?.content;
      if (!content) throw new ProviderRequestError("invalid-response");

      return JSON.parse(content) as unknown;
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderRequestError("request-timeout");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
