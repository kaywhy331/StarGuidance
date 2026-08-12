import {
  followUpResultSchema,
  readingResultV2Schema,
  type FollowUpResult,
  type ReadingResult,
} from "@starguidance/contracts";

import {
  classifyQuestion,
  DeterministicFallbackProvider,
  FALLBACK_PROVIDER_ID,
  type FollowUpGenerationInput,
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

export interface GroqProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
}

/** The JSON Schema the model is constrained to. Mirrors readingResultSchema. */
function responseSchema(cardCount: number): Record<string, unknown> {
  const card = {
    type: "object",
    additionalProperties: false,
    required: ["positionId", "cardId", "orientation", "passageIds"],
    properties: {
      positionId: { type: "string" },
      cardId: { type: "string" },
      orientation: { type: "string", enum: ["upright", "reversed"] },
      passageIds: { type: "array", items: { type: "string" }, minItems: 1 },
    },
  };
  const passage = {
    type: "object",
    additionalProperties: false,
    required: ["id", "role", "text", "cardReferences"],
    properties: {
      id: { type: "string" },
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
      text: { type: "string" },
      cardReferences: { type: "array", items: { type: "string" }, maxItems: cardCount },
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
      title: { type: "string" },
      passages: { type: "array", items: passage, minItems: 3, maxItems: 24 },
      cards: { type: "array", items: card, minItems: cardCount, maxItems: cardCount },
      trajectory: {
        type: "object",
        additionalProperties: false,
        required: ["likelyPassageId", "conditions", "alternatePassageId"],
        properties: {
          likelyPassageId: { type: "string" },
          conditions: { type: "array", items: { type: "string" } },
          alternatePassageId: { type: "string" },
        },
      },
      userAgency: { type: "array", items: { type: "string" } },
      reflectionQuestion: { type: "string" },
      disconfirmingEvidence: { type: "array", items: { type: "string" } },
      uncertainty: { type: "string" },
      safetyFlags: { type: "array", items: { type: "string" } },
    },
  };
}

function followUpResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["response"],
    properties: { response: { type: "string" } },
  };
}

export class GroqInterpretationProvider implements ReadingInterpretationProvider {
  readonly id: string;
  private readonly fallback = new DeterministicFallbackProvider();

  constructor(private readonly options: GroqProviderOptions) {
    this.id = `groq:${options.model}`;
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
      return {
        result: await this.callProvider(input, signal),
        provenance: {
          providerId: this.id,
          promptVersion: PROMPT_VERSION,
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
          providerId: `${FALLBACK_PROVIDER_ID}:after-groq-${fallbackReason(error)}`,
        },
      };
    }
  }

  async generateFollowUp(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpResult> {
    try {
      return await this.callFollowUpProvider(input, signal);
    } catch {
      return this.fallback.generateFollowUp(input);
    }
  }

  private async callProvider(
    input: ReadingGenerationInput,
    signal?: AbortSignal,
  ): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
    const resolved = resolveDraw(input.draw, input.questionClassification);
    const parsed = readingResultV2Schema.parse(
      await this.requestStructured(
        guarded ? `${READER_VOICE} ${GUARDED_VOICE}` : READER_VOICE,
        this.buildPayload(input),
        "reading",
        responseSchema(resolved.length),
        this.options.maxOutputTokens ?? 4000,
        signal,
      ),
    );
    if (parsed.cards.length !== resolved.length) throw new ProviderRequestError("invalid-response");
    if (generatedOutputSafetyViolation(parsed)) throw new ProviderRequestError("unsafe-response");
    // The model may not echo the locked draw faithfully; the draw is
    // authoritative, so card identity and orientation are restored from it.
    const positionMap = new Map(
      parsed.cards.map((card, index) => [card.positionId, resolved[index]!.position.id]),
    );
    return readingResultV2Schema.parse({
      ...parsed,
      passages: parsed.passages.map((passage) => ({
        ...passage,
        cardReferences: passage.cardReferences.map(
          (positionId) => positionMap.get(positionId) ?? positionId,
        ),
      })),
      cards: resolved.map((entry, index) => ({
        ...parsed.cards[index]!,
        positionId: entry.position.id,
        cardId: entry.card.id,
        orientation: entry.orientation,
      })),
      safetyFlags: safety.category === "ordinary" ? parsed.safetyFlags : [safety.category],
    });
  }

  private async callFollowUpProvider(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
    const system = `${READER_VOICE} ${FOLLOW_UP_VOICE}${guarded ? ` ${GUARDED_VOICE}` : ""}`;
    const parsed = followUpResultSchema.parse(
      await this.requestStructured(
        system,
        this.buildFollowUpPayload(input),
        "follow_up",
        followUpResponseSchema(),
        Math.min(this.options.maxOutputTokens ?? 900, 1_200),
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
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    try {
      const response = await fetch(
        `${(this.options.baseUrl ?? "https://api.groq.com/openai/v1").replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: this.options.model,
            temperature: 0.85,
            max_completion_tokens: maxOutputTokens,
            messages: [
              { role: "system", content: system },
              { role: "user", content: JSON.stringify(payload) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: schemaName, strict: true, schema },
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const reason: FallbackReason =
          response.status === 401 || response.status === 403
            ? "authentication"
            : response.status === 429
              ? "rate-limited"
              : response.status >= 500
                ? "provider-unavailable"
                : "request-rejected";
        throw new ProviderRequestError(reason);
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
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
