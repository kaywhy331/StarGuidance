import {
  followUpResultSchema,
  readingResultSchema,
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
export const PROMPT_VERSION = "reader-voice-v1" as const;
export const RESPONSE_SCHEMA_VERSION = "reading-result-v1" as const;
export const FOLLOW_UP_PROMPT_VERSION = "follow-up-reader-voice-v1" as const;

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

/** Categories where a confident prediction would do real harm. */
const GUARDED_CATEGORIES = new Set([
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
  "You are a practised tarot reader speaking directly to one person who has come to you with a question.",
  "Answer them. Say plainly what you see in the cards and where it is heading. Commit to a reading.",
  "Speak warmly and in the second person, as if across a table. Be specific and concrete.",
  "Every card must be read through the position it landed in — the position changes what the card is saying.",
  "You are given a short lens describing how this person tends to operate. Use it in every card: name how",
  "that pattern meets that card. A reading that would suit anyone is a failed reading.",
  "Do not add disclaimers, caveats about tarot, or meta-commentary. Do not mention being an AI or a model.",
  "Do not restate the question. Do not use the words 'reflective guidance'.",
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
  "Directly name at least one card and the position it occupies in the locked spread.",
  "Connect that card to at least one supplied reader-lens trait and to the original reading.",
  "Stay focused on the follow-up. Do not use headings, lists, disclaimers, or repeat every card.",
].join(" ");

export interface GroqProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxOutputTokens?: number;
}

/** The JSON Schema the model is constrained to. Mirrors readingResultSchema. */
function responseSchema(): Record<string, unknown> {
  const card = {
    type: "object",
    additionalProperties: false,
    required: [
      "positionId",
      "cardId",
      "orientation",
      "traditionalMeaning",
      "personalizedMeaning",
      "questionConnection",
    ],
    properties: {
      positionId: { type: "string" },
      cardId: { type: "string" },
      orientation: { type: "string", enum: ["upright", "reversed"] },
      traditionalMeaning: { type: "string" },
      personalizedMeaning: { type: "string" },
      questionConnection: { type: "string" },
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "directAnswer",
      "centralTheme",
      "cards",
      "synthesis",
      "likelyTrajectory",
      "userAgency",
      "reflectionQuestion",
      "disconfirmingEvidence",
      "uncertainty",
      "safetyFlags",
    ],
    properties: {
      title: { type: "string" },
      directAnswer: { type: "string" },
      centralTheme: { type: "string" },
      cards: { type: "array", items: card },
      synthesis: { type: "string" },
      likelyTrajectory: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "conditions", "alternateTrajectory"],
        properties: {
          summary: { type: "string" },
          conditions: { type: "array", items: { type: "string" } },
          alternateTrajectory: { type: "string" },
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
    const resolved = resolveDraw(input.draw);
    const answer = answerCard(input.draw, resolved);
    return {
      question: input.question,
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
        directAnswer: input.originalResult.directAnswer,
        centralTheme: input.originalResult.centralTheme,
        cards: input.originalResult.cards.map((card) => ({
          positionId: card.positionId,
          cardId: card.cardId,
          orientation: card.orientation,
          personalizedMeaning: card.personalizedMeaning,
          questionConnection: card.questionConnection,
        })),
        synthesis: input.originalResult.synthesis,
        likelyTrajectory: input.originalResult.likelyTrajectory,
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
    const parsed = readingResultSchema.parse(
      await this.requestStructured(
        guarded ? `${READER_VOICE} ${GUARDED_VOICE}` : READER_VOICE,
        this.buildPayload(input),
        "reading",
        responseSchema(),
        this.options.maxOutputTokens ?? 2600,
        signal,
      ),
    );
    if (generatedOutputSafetyViolation(parsed)) throw new ProviderRequestError("unsafe-response");
    // The model may not echo the locked draw faithfully; the draw is
    // authoritative, so card identity and orientation are restored from it.
    const resolved = resolveDraw(input.draw);
    return {
      ...parsed,
      cards: resolved.map((entry, index) => ({
        ...(parsed.cards[index] ?? parsed.cards[0]!),
        positionId: entry.position.id,
        cardId: entry.card.id,
        orientation: entry.orientation,
      })),
      safetyFlags: safety.category === "ordinary" ? parsed.safetyFlags : [safety.category],
    };
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
