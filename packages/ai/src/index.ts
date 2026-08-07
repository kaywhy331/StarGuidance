import {
  followUpResultSchema,
  oracleStreamEventSchema,
  readingResultSchema,
  type FollowUpResult,
  type OracleStreamEvent,
  type ProfileTrait,
  type ReadingOutputProvenance,
  type ReadingResult,
} from "@starguidance/contracts";
import type { LockedDraw } from "@starguidance/tarot-domain";

import {
  agencyFrom,
  answerCard,
  disconfirmingFrom,
  drawShape,
  guardedDirectAnswer,
  guardedQuestionConnection,
  personalEmphasis,
  positionalReading,
  questionSubject,
  resolveDraw,
  subjectVoices,
  trajectoryFrom,
} from "./interpretation";

export interface InterpretationProvider<TInput, TOutput> {
  readonly id: string;
  generate(input: TInput, signal?: AbortSignal): Promise<TOutput>;
}

export const FALLBACK_PROVIDER_ID = "deterministic-fallback-v1" as const;
export const FALLBACK_PROMPT_VERSION = "deterministic-fallback-v1" as const;
export const READING_RESULT_SCHEMA_VERSION = "reading-result-v1" as const;

export interface ReadingGenerationOutcome {
  result: ReadingResult;
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
  ["selfHarmCrisis", /\b(kill myself|suicide|end my life|hurt myself)\b/i],
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
        "Pause the reading and connect the person with immediate local crisis or emergency support.",
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

export interface ReadingGenerationInput {
  readonly draw: LockedDraw;
  readonly question: string;
  readonly relevantTraitStatements: readonly string[];
}

export interface FollowUpGenerationInput extends ReadingGenerationInput {
  readonly originalResult: ReadingResult;
}

export interface ReadingLens {
  readonly version: "question-trait-lens-v1";
  readonly traitIndexes: readonly number[];
  readonly statements: readonly string[];
}

const questionDomains: readonly [RegExp, readonly ProfileTrait["domain"][]][] = [
  [
    /\b(work|career|job|business|project|lead|decision)\b/i,
    ["workStyle", "decisionStyle", "riskOrientation", "creativeExpression"],
  ],
  [
    /\b(love|relationship|partner|friend|family|communicat|conflict)\b/i,
    ["relationshipNeeds", "communicationStyle", "conflictResponse", "emotionalProcessing"],
  ],
  [
    /\b(change|move|choice|direction|future|next)\b/i,
    ["stabilityVsChange", "growthLever", "decisionStyle", "coreMotivation"],
  ],
];

export function selectReadingLens(question: string, traits: readonly ProfileTrait[]): ReadingLens {
  const preferred = questionDomains.find(([pattern]) => pattern.test(question))?.[1] ?? [
    "coreMotivation",
    "growthLever",
    "communicationStyle",
  ];
  const ranked = traits
    .map((trait, index) => ({ trait, index }))
    .filter(({ trait }) => trait.stability === "stable")
    .sort((left, right) => {
      const leftRank = preferred.indexOf(left.trait.domain);
      const rightRank = preferred.indexOf(right.trait.domain);
      return (leftRank < 0 ? 99 : leftRank) - (rightRank < 0 ? 99 : rightRank);
    })
    .slice(0, 3);
  return {
    version: "question-trait-lens-v1",
    traitIndexes: ranked.map(({ index }) => index),
    statements: ranked.map(({ trait }) => trait.statement),
  };
}

export class DeterministicFallbackProvider implements ReadingInterpretationProvider {
  readonly id = FALLBACK_PROVIDER_ID;

  async generate(input: ReadingGenerationInput): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const subject = questionSubject(input.question);
    const voice = subjectVoices[subject];
    const resolved = resolveDraw(input.draw);
    const answer = answerCard(input.draw, resolved);
    const traits = input.relevantTraitStatements;

    const cards = resolved.map((entry, index) => ({
      positionId: entry.position.id,
      cardId: entry.card.id,
      orientation: entry.orientation,
      traditionalMeaning: positionalReading(entry, subject, index),
      // A different trait per card. One trait repeated under every card was a
      // large part of why every reading sounded the same.
      personalizedMeaning: personalEmphasis(
        entry,
        traits[index % Math.max(traits.length, 1)],
        subject,
      ),
      questionConnection:
        safety.category === "ordinary"
          ? `${entry.card.reflectivePrompt} Hold that as a perspective on the question, not a verdict on it.`
          : guardedQuestionConnection(safety.category, index, safety.guidance),
    }));

    // AI-007: answer first, then elaborate.
    const directAnswer =
      safety.category === "ordinary"
        ? `On ${voice.about}: the answer sits in the ${answer.position.displayName} position, where ${
            answer.orientation === "reversed"
              ? `${answer.card.name} appears reversed`
              : answer.card.name
          } speaks to ${answer.themes.join(" and ")}. Under current conditions that points toward ${voice.wellPhrase}.`
        : guardedDirectAnswer(
            safety.category,
            voice.about,
            `On ${voice.about}: this reading will not answer that as a matter of fact. ${safety.guidance}`,
          );

    return readingResultSchema.parse({
      title: `${answer.card.name} in ${answer.position.displayName}`,
      directAnswer,
      centralTheme: drawShape(resolved),
      cards,
      synthesis: resolved
        .map(
          (entry) =>
            `${entry.position.displayName}: ${entry.orientation === "reversed" ? `${entry.card.name} reversed` : entry.card.name} — ${entry.themes.join(" and ")}.`,
        )
        .join(" ")
        .concat(
          ` Together these describe a conditional pattern around ${voice.about}, not a fixed result. Keep what matches what you can observe and let go of the rest.`,
        ),
      likelyTrajectory: trajectoryFrom(answer, resolved, subject),
      userAgency: agencyFrom(answer, resolved, traits),
      reflectionQuestion: answer.card.reflectivePrompt,
      disconfirmingEvidence: disconfirmingFrom(resolved),
      uncertainty:
        "Tarot is reflective guidance, not factual proof or a guarantee of future events. This reading describes a pattern under current conditions, and those conditions are yours to change.",
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
    const resolved = resolveDraw(input.draw);
    const answer = answerCard(input.draw, resolved);
    const originalCard = input.originalResult.cards.find(
      ({ positionId }) => positionId === answer.position.id,
    );
    const profileThread = input.relevantTraitStatements[0]
      ? `Your profile’s pattern — ${input.relevantTraitStatements[0]} — meets this card through what the original reading named: ${
          originalCard?.personalizedMeaning ??
          "your response when this pattern appears in real life"
        }`
      : (originalCard?.personalizedMeaning ??
        "The personal thread is how you respond when this pattern appears in real life.");
    return followUpResultSchema.parse({
      response: [
        `Looking again at ${answer.card.name}${
          answer.orientation === "reversed" ? " reversed" : ""
        } in ${answer.position.displayName}, its themes of ${answer.themes.join(" and ")} point toward ${
          subjectVoices[questionSubject(input.question)].wellPhrase
        }.`,
        profileThread,
        `Within the full spread, ${input.originalResult.centralTheme}`,
        `Your clearest alignment now is ${input.originalResult.userAgency[0]}.`,
      ].join(" "),
    });
  }
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
  // The reading itself carries no disclaimer: the standing statement about what
  // tarot is and is not belongs in the site terms, linked from every page,
  // rather than appended to every reading. The `uncertainty` field is still
  // recorded with the result; it is simply not spoken aloud.
  const phases: Omit<Extract<OracleStreamEvent, { type: "phase" }>, "sequence">[] = [
    {
      type: "phase",
      phase: "openingTheme",
      heading: "Opening theme",
      text: `${validated.directAnswer} ${validated.centralTheme}`,
    },
    ...validated.cards.map((card, index) => ({
      type: "phase" as const,
      phase: "cardInterpretation" as const,
      heading: `Card ${index + 1} · ${card.positionId.replaceAll("-", " ")}`,
      text: `${card.traditionalMeaning} ${card.personalizedMeaning} ${card.questionConnection}`,
    })),
    {
      type: "phase",
      phase: "overallSynthesis",
      heading: "From the Stars",
      text: validated.synthesis,
    },
    {
      type: "phase",
      phase: "likelyTrajectory",
      heading: "Fated Path",
      text: `${validated.likelyTrajectory.summary} Conditions: ${validated.likelyTrajectory.conditions.join("; ")}.`,
    },
    {
      type: "phase",
      phase: "alternateTrajectory",
      heading: "Divergent Path",
      text: validated.likelyTrajectory.alternateTrajectory,
    },
    {
      type: "phase",
      phase: "userAgency",
      heading: "Cosmic Alignment",
      text: validated.userAgency.join(" · "),
    },
    {
      type: "phase",
      phase: "reflectionPrompt",
      heading: "Starlit Reflection",
      text: validated.reflectionQuestion,
    },
  ];
  return phases.map((phase, sequence) => oracleStreamEventSchema.parse({ ...phase, sequence }));
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
  readonly id = "persisted-result-stream-v1";

  async *streamPersistedResult(result: ReadingResult): AsyncIterable<OracleStreamEvent> {
    for (const event of createOracleStreamEvents(result)) yield event;
    yield { type: "complete" };
  }

  async *streamPersistedFollowUp(result: FollowUpResult): AsyncIterable<OracleStreamEvent> {
    for (const event of createFollowUpStreamEvents(result)) yield event;
    yield { type: "complete" };
  }
}

import { GroqInterpretationProvider } from "./groq-provider";

export {
  FOLLOW_UP_PROMPT_VERSION,
  GUARDED_CATEGORIES,
  GroqInterpretationProvider,
  PROMPT_VERSION,
  RESPONSE_SCHEMA_VERSION,
  type GroqProviderOptions,
} from "./groq-provider";

/**
 * Chooses the interpretation provider from configuration.
 *
 * `AI_PROVIDER=disabled`, an absent key, or an unapproved safety evaluation
 * yields the deterministic reader. Live narration is a separately approved
 * production gate rather than an accidental consequence of adding a key.
 */
export function createInterpretationProvider(): ReadingInterpretationProvider {
  const selected = process.env.AI_PROVIDER?.trim();
  const apiKey = process.env.AI_PROVIDER_API_KEY?.trim();
  const safetyEvaluationApproved = process.env.AI_SAFETY_EVALUATION_APPROVED === "true";
  if (selected !== "groq" || !apiKey || !safetyEvaluationApproved)
    return new DeterministicFallbackProvider();
  const timeout = Number.parseInt(process.env.AI_PROVIDER_TIMEOUT_MS ?? "", 10);
  const maxOutput = Number.parseInt(process.env.AI_PROVIDER_MAX_OUTPUT_TOKENS ?? "", 10);
  return new GroqInterpretationProvider({
    apiKey,
    model: process.env.AI_PROVIDER_MODEL?.trim() || "openai/gpt-oss-120b",
    ...(process.env.AI_PROVIDER_BASE_URL?.trim()
      ? { baseUrl: process.env.AI_PROVIDER_BASE_URL.trim() }
      : {}),
    ...(Number.isFinite(timeout) ? { timeoutMs: timeout } : {}),
    ...(Number.isFinite(maxOutput) ? { maxOutputTokens: maxOutput } : {}),
  });
}
