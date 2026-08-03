import { readingResultSchema, type ReadingResult } from "@starguidance/contracts";

import {
  classifyQuestion,
  DeterministicFallbackProvider,
  type ReadingGenerationOutcome,
  type ReadingGenerationInput,
  type ReadingInterpretationProvider,
} from "./index";
import { answerCard, resolveDraw } from "./interpretation";

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

/** Categories where a confident prediction would do real harm. */
const GUARDED_CATEGORIES = new Set([
  "selfHarmCrisis",
  "medical",
  "mentalHealthDiagnosis",
  "physicalDeath",
  "criminalGuilt",
  "pregnancy",
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
  "private facts about anyone who is not present. Read the cards for what this person can see, decide,",
  "prepare for, and ask about — and point them toward qualified help where that is the honest answer.",
  "Stay warm and direct. This is a redirection, not a refusal.",
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
    } catch {
      // A person who asked a question gets a reading either way (AI-015).
      return this.fallback.generateWithProvenance(input);
    }
  }

  private async callProvider(
    input: ReadingGenerationInput,
    signal?: AbortSignal,
  ): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
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
            max_completion_tokens: this.options.maxOutputTokens ?? 2600,
            messages: [
              {
                role: "system",
                content: guarded ? `${READER_VOICE} ${GUARDED_VOICE}` : READER_VOICE,
              },
              { role: "user", content: JSON.stringify(this.buildPayload(input)) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "reading", strict: true, schema: responseSchema() },
            },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`AI_PROVIDER_STATUS_${response.status}`);
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("AI_PROVIDER_EMPTY_RESPONSE");

      const parsed = readingResultSchema.parse(JSON.parse(content));
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
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
