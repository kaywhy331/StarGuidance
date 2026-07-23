import {
  oracleStreamEventSchema,
  readingResultSchema,
  type OracleStreamEvent,
  type ProfileTrait,
  type ReadingResult,
} from "@starguidance/contracts";
import { tarotCards } from "@starguidance/tarot-content";
import type { LockedDraw } from "@starguidance/tarot-domain";

export interface InterpretationProvider<TInput, TOutput> {
  readonly id: string;
  generate(input: TInput, signal?: AbortSignal): Promise<TOutput>;
}

export const FALLBACK_PROVIDER_ID = "deterministic-fallback-v1" as const;

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

export class DeterministicFallbackProvider implements InterpretationProvider<
  ReadingGenerationInput,
  ReadingResult
> {
  readonly id = FALLBACK_PROVIDER_ID;

  async generate(input: ReadingGenerationInput): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const cards = input.draw.assignments.map((assignment) => {
      const card = tarotCards.find(({ id }) => id === assignment.cardId);
      if (!card) throw new Error(`Unknown locked card: ${assignment.cardId}`);
      const themes =
        assignment.orientation === "upright" ? card.uprightThemes : card.reversedThemes;
      return {
        positionId: assignment.positionId,
        cardId: card.id,
        orientation: assignment.orientation,
        traditionalMeaning: `${card.name} highlights ${themes.join(" and ")}.`,
        personalizedMeaning: input.relevantTraitStatements[0]
          ? `In light of your stated pattern—${input.relevantTraitStatements[0]}—consider how this theme changes your available response.`
          : "Notice which part of this theme matches your observable experience and which part does not.",
        questionConnection:
          safety.category === "ordinary"
            ? "Treat this as a perspective on the question, not a guaranteed outcome."
            : safety.guidance,
      };
    });
    return readingResultSchema.parse({
      title: "A pattern to consider",
      directAnswer:
        "The draw suggests slowing down enough to distinguish current conditions from assumptions.",
      centralTheme: cards.map(({ traditionalMeaning }) => traditionalMeaning).join(" "),
      cards,
      synthesis:
        "Taken together, these cards describe a conditional pattern. Keep what matches observable evidence and release what does not.",
      likelyTrajectory: {
        summary: "If current conditions continue, the highlighted pattern may become more visible.",
        conditions: [
          "The present behavior continues",
          "No significant new evidence changes the situation",
        ],
        alternateTrajectory:
          "A different choice, conversation, or new evidence can change the direction.",
      },
      userAgency: [
        "Name one observable fact",
        "Choose one proportionate next action",
        "Revisit the question after new evidence appears",
      ],
      reflectionQuestion:
        "What would you choose if you did not need certainty before taking the next grounded step?",
      disconfirmingEvidence: [
        "Behavior that contradicts the card themes",
        "A material change in circumstances",
      ],
      uncertainty:
        "Tarot is reflective guidance, not factual proof or a guarantee of future events.",
      safetyFlags: safety.category === "ordinary" ? [] : [safety.category],
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
}

export function createOracleStreamEvents(result: ReadingResult): readonly OracleStreamEvent[] {
  const validated = readingResultSchema.parse(result);
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
      heading: "Overall synthesis",
      text: validated.synthesis,
    },
    {
      type: "phase",
      phase: "likelyTrajectory",
      heading: "Likely trajectory",
      text: `${validated.likelyTrajectory.summary} Conditions: ${validated.likelyTrajectory.conditions.join("; ")}.`,
    },
    {
      type: "phase",
      phase: "alternateTrajectory",
      heading: "Alternate trajectory",
      text: validated.likelyTrajectory.alternateTrajectory,
    },
    {
      type: "phase",
      phase: "userAgency",
      heading: "Your agency",
      text: validated.userAgency.join(" · "),
    },
    {
      type: "phase",
      phase: "reflectionPrompt",
      heading: "Reflection prompt",
      text: validated.reflectionQuestion,
    },
    {
      type: "phase",
      phase: "uncertainty",
      heading: "Uncertainty",
      text: `${validated.uncertainty} Disconfirming evidence: ${validated.disconfirmingEvidence.join("; ")}.`,
    },
  ];
  return phases.map((phase, sequence) => oracleStreamEventSchema.parse({ ...phase, sequence }));
}

export class PersistedResultStreamAdapter implements StreamingInterpretationAdapter {
  readonly id = "persisted-result-stream-v1";

  async *streamPersistedResult(result: ReadingResult): AsyncIterable<OracleStreamEvent> {
    for (const event of createOracleStreamEvents(result)) yield event;
    yield { type: "complete" };
  }
}
