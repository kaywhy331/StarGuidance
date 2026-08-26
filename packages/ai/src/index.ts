import {
  GENERAL_READING_QUESTION,
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
  type ReadingConfiguration,
} from "@starguidance/contracts";
import type { LockedDraw } from "@starguidance/tarot-domain";

import {
  answerCard,
  guardedDirectAnswer,
  guardedQuestionConnection,
  questionSubject,
  resolveDraw,
  subjectVoices,
} from "./interpretation";
import { spokenCardMeaning } from "./card-language";
import {
  agencyNarration,
  agencySteps,
  buildQuestionFrame,
  cardNarration,
  likelyNarration,
  openingNarration,
  overallPatternNarration,
  reflectionQuestion,
  turningPointNarration,
} from "./fallback-narration";
import type { RuntimePromptBundleId } from "./groq-provider";

export { AUTOMATIC_SPREAD_SELECTION_VERSION, recommendSpreadId } from "./spread-selection";

export interface InterpretationProvider<TInput, TOutput> {
  readonly id: string;
  generate(input: TInput, signal?: AbortSignal): Promise<TOutput>;
}

export const FALLBACK_PROVIDER_ID = "deterministic-fallback-v1" as const;
export const FALLBACK_PROMPT_VERSION = "deterministic-fallback-v8" as const;
export const READING_RESULT_SCHEMA_VERSION = "reading-result-v3" as const;

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
    "relationships",
    /\b(love|relationship|partner|friend|family|communicat\w*|conflict|marriage|reconcil\w*|reconnect|break ?up)\b/i,
  ],
  [
    "career",
    /\b(work|career|job|business|project|lead|colleague|coworker|manager|boss|role|position|promot\w*|raise|salary|pay|income|interview|hiring|offer|employment|contract|client|company|team|freelance)\b/i,
  ],
  ["change", /\b(change|move|relocat\w*|choice|direction|transition|future|next)\b/i],
  ["wellbeing", /\b(wellbeing|well-being|balance|rest|energy|habit|stress|burnout|overwhelm)\b/i],
];

export function classifyQuestionContext(
  question: string,
  input: {
    topic?: ReadingTopic;
    horizon?: ReadingHorizon;
    generalReading?: boolean;
  } = {},
): QuestionClassification {
  const generalReading = input.generalReading ?? question.trim() === GENERAL_READING_QUESTION;
  const selectedTopic = input.topic ?? "general";
  const inferredHorizon: ReadingHorizon =
    input.horizon ??
    (/\b(today|tonight|right now|immediate(?:ly)?|next few days?)\b/i.test(question)
      ? "immediate"
      : /\b(week|weeks|next month)\b/i.test(question)
        ? "weeks"
        : /\b(month|months|this year|next year)\b/i.test(question)
          ? "months"
          : "open");
  const topic =
    generalReading || selectedTopic !== "general"
      ? selectedTopic
      : (inferredTopics.find(([, pattern]) => pattern.test(question))?.[0] ?? "general");
  const intent = generalReading
    ? "generalReflection"
    : /\b(choose|choice|decid|which path)\b|\bshould i (?!understand\b)/i.test(question)
      ? "decisionSupport"
      : /\b(plan|prepare|next step|approach)\b/i.test(question)
        ? "planning"
        : /\b(feel|emotion|process|grief|conflict)\b/i.test(question)
          ? "emotionalProcessing"
          : "clarity";
  return questionClassificationSchema.parse({
    version: "question-classification-v1",
    topic,
    horizon: inferredHorizon,
    intent,
    generalReading,
  });
}

export interface QuestionReview {
  readonly encouragedForm: boolean;
  readonly reformulationReason?: "binary" | "deterministic" | "third_party_private";
  readonly suggestedQuestion?: string;
}

/**
 * Reviews form without mutating the question. The caller must show any
 * suggestion and obtain confirmation for the exact wording ultimately used.
 */
export function reviewTarotQuestion(question: string): QuestionReview {
  const normalized = question.trim();
  const safety = classifyQuestion(normalized);
  if (
    safety.category === "thirdPartyPrivateClaim" ||
    /\b(?:what|how) (?:does|is|are) (?:he|she|they) (?:think|feel|want)\b/i.test(normalized)
  )
    return {
      encouragedForm: false,
      reformulationReason: "third_party_private",
      suggestedQuestion:
        "What should I understand about the behavior I can observe, the conversation available to me, and the choices that are mine?",
    };
  if (/\b(?:definitely|guaranteed|exactly when|certain(?:ly)?|for sure)\b/i.test(normalized))
    return {
      encouragedForm: false,
      reformulationReason: "deterministic",
      suggestedQuestion:
        "What should I understand about the current conditions, possible direction, and what I can influence?",
    };
  if (/^(?:will|is|are|does|do|did|can|should|has|have|was|were)\b/i.test(normalized))
    return {
      encouragedForm: false,
      reformulationReason: "binary",
      suggestedQuestion:
        "What should I understand about the situation, its present direction, and my most useful next step?",
    };
  return { encouragedForm: /^(?:what|how)\b/i.test(normalized) };
}

export function classifyFollowUpScope(input: {
  originalQuestion: string;
  originalClassification: QuestionClassification;
  followUpQuestion: string;
}): { sameReading: boolean; reason?: "subject" | "decision" | "person" | "horizon" } {
  const followUp = input.followUpQuestion.trim();
  const referencesSpreadStructure =
    /\b(?:card|spread|position|situation|challenge|direction|focus|path a|path b|foundation|incoming influence|outcome)\b/i.test(
      followUp,
    );
  const inferredTopic = inferredTopics.find(([, pattern]) => pattern.test(followUp))?.[0];
  const namesConcreteChangeSubject = /\b(?:move|relocat\w*|home|transition)\b/i.test(followUp);
  // Generic movement words such as "direction", "future", and "next" describe
  // how the existing subject develops; they do not establish a new life
  // subject. Concrete change language (for example, a move or relocation) can.
  const explicitTopic =
    inferredTopic === "change" && (referencesSpreadStructure || !namesConcreteChangeSubject)
      ? undefined
      : inferredTopic;
  if (
    explicitTopic &&
    input.originalClassification.topic !== "general" &&
    explicitTopic !== input.originalClassification.topic
  )
    return { sameReading: false, reason: "subject" };
  const followUpContext = classifyQuestionContext(followUp);
  const explicitlyNamesHorizon =
    /\b(today|tonight|right now|next few days?|weeks?|months?|this year|next year)\b/i.test(
      followUp,
    );
  if (
    explicitlyNamesHorizon &&
    input.originalClassification.horizon !== "open" &&
    followUpContext.horizon !== input.originalClassification.horizon
  )
    return { sameReading: false, reason: "horizon" };
  if (
    /\b(?:new|different|another) (?:question|topic|decision|person|relationship)\b/i.test(followUp)
  )
    return { sameReading: false, reason: "subject" };
  if (
    /\bwhat about (?:my|the) (?:job|career|relationship|move|home|health|money)\b/i.test(followUp)
  )
    return { sameReading: false, reason: "decision" };
  const originalPeople = new Set(
    input.originalQuestion.match(/\b(?:my (?:partner|friend|boss|manager|ex)|he|she|they)\b/gi) ??
      [],
  );
  const followUpPeople =
    followUp.match(/\b(?:my (?:partner|friend|boss|manager|ex)|he|she|they)\b/gi) ?? [];
  if (
    followUpPeople.some(
      (person) =>
        originalPeople.size > 0 &&
        ![...originalPeople].some((original) => original.toLowerCase() === person.toLowerCase()),
    )
  )
    return { sameReading: false, reason: "person" };
  return { sameReading: true };
}

export interface ReadingGenerationInput {
  readonly draw: LockedDraw;
  readonly configuration: ReadingConfiguration;
  readonly question: string;
  readonly questionClassification: QuestionClassification;
  readonly relevantTraitStatements: readonly string[];
  readonly relatedPersonContext?: readonly {
    readonly mention: string;
    readonly relevantTraitStatements: readonly string[];
  }[];
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
  lens: {
    readonly traitIndexes: readonly number[];
    readonly tensionIndexes?: readonly number[] | undefined;
  },
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
    const resolved = resolveDraw(
      input.draw,
      input.questionClassification,
      input.configuration.positions,
    );
    const answer = answerCard(input.draw, resolved);
    const frame = buildQuestionFrame(input.question, input.questionClassification, subject);
    const guarded = safety.category !== "ordinary";
    const traits =
      input.configuration.personalizationMode === "personalized_tarot"
        ? input.relevantTraitStatements
        : [];
    const named = (entry: (typeof resolved)[number]) =>
      entry.orientation === "reversed" ? `${entry.card.name} reversed` : entry.card.name;
    const meaning = (entry: (typeof resolved)[number]) =>
      spokenCardMeaning(entry.card, entry.orientation);
    const byPosition = new Map(resolved.map((entry) => [entry.position.id, entry]));
    const relationshipRules = input.configuration.capabilities.linkedPositions;
    const cardResults = resolved.map((entry, index) => {
      const relationshipNotes = relationshipRules
        .filter(({ positionIds }) => positionIds.includes(entry.position.id))
        .flatMap((rule) => {
          const linked = rule.positionIds
            .filter((positionId) => positionId !== entry.position.id)
            .flatMap((positionId) => {
              const candidate = byPosition.get(positionId);
              return candidate ? [candidate] : [];
            });
          if (linked.length === 0) return [];
          const relationshipLanguage = {
            sequence: "changes as the reading moves toward",
            compare: "offers a different demand from",
            tension: "pulls against",
            integration: "has to be worked together with",
          }[rule.relationship];
          return [
            `${named(entry)} in ${entry.position.displayName} ${relationshipLanguage} ${linked.map((candidate) => `${named(candidate)} in ${candidate.position.displayName}`).join(" and ")}; the contrast is between ${meaning(entry)} and ${linked.map(meaning).join(" alongside ")}.`,
          ];
        });
      const suitReinforcement =
        entry.card.suit === null
          ? undefined
          : resolved.find(
              (candidate) =>
                candidate.position.id !== entry.position.id &&
                candidate.card.suit === entry.card.suit,
            );
      if (suitReinforcement)
        relationshipNotes.push(
          `${entry.card.name} and ${suitReinforcement.card.name} repeat the ${entry.card.suit} current across ${entry.position.displayName} and ${suitReinforcement.position.displayName}, reinforcing ${entry.card.suit === "cups" ? "emotion and reciprocity" : entry.card.suit === "swords" ? "thought and communication" : entry.card.suit === "wands" ? "initiative and momentum" : "work, resources, and tangible follow-through"}.`,
        );
      const trait = traits.length > 0 ? traits[index % traits.length] : undefined;
      const ordinaryPositionMeaning = cardNarration(entry, frame, index, false, trait);
      return {
        positionId: entry.position.id,
        positionLabel: entry.position.displayName,
        cardId: entry.card.id,
        orientation: entry.orientation,
        coreMeaning:
          entry.orientation === "reversed"
            ? `${meaning(entry)}. The approved reversal facet used here is ${entry.reversalFacet ?? "blocked"}.`
            : `${meaning(entry)}.`,
        positionInterpretation: guarded
          ? guardedQuestionConnection(
              safety.category,
              entry.position.order,
              cardNarration(entry, frame, index, true, trait),
            )
          : ordinaryPositionMeaning,
        relationshipNotes,
        supportingEvidence: [
          `${entry.card.name}: approved ${entry.orientation} themes — ${entry.themes.join(", ")}.`,
          `${entry.position.displayName}: ${entry.position.interpretiveFunction}.`,
          ...(entry.reversalFacet ? [`Approved reversal facet: ${entry.reversalFacet}.`] : []),
        ],
      };
    });

    const directAnswer = guarded
      ? guardedDirectAnswer(
          safety.category,
          voice.about,
          `This reading will not turn the question into a factual prediction. ${safety.guidance}`,
        )
      : openingNarration(answer, frame, traits[0]);

    const overallPattern = overallPatternNarration(resolved, frame);
    const baseSynthesis = turningPointNarration(answer, resolved, frame, traits[1] ?? traits[0]);
    const relatedPerson =
      input.configuration.personalizationMode === "personalized_tarot"
        ? input.relatedPersonContext?.find(({ relevantTraitStatements }) =>
            relevantTraitStatements.some(Boolean),
          )
        : undefined;
    const readerTrait = naturalTrait(traits[0]);
    const otherTrait = naturalTrait(relatedPerson?.relevantTraitStatements[0]);
    const synthesis =
      relatedPerson && otherTrait
        ? `${baseSynthesis} In this connection, ${readerTrait ? `your tendency to ${readerTrait} may meet ` : "you may meet "}${relatedPerson.mention}'s tendency to ${otherTrait}. Treat that as a pattern to compare with observable behavior, not a claim about their private thoughts.`
        : baseSynthesis;

    const trajectoryEntries = input.configuration.capabilities.trajectoryPositionIds.flatMap(
      (positionId) => {
        const entry = byPosition.get(positionId);
        return entry ? [entry] : [];
      },
    );
    const questionSupportsOutlook =
      input.questionClassification.horizon !== "open" ||
      ["planning", "decisionSupport"].includes(input.questionClassification.intent) ||
      input.draw.spreadId === "outlook";
    const likelyTrajectory =
      trajectoryEntries.length > 0 && questionSupportsOutlook
        ? likelyNarration(answer, frame, guarded)
        : null;
    const alternativeGroup = input.configuration.capabilities.alternativePositionGroups[0] ?? [];
    const alternativeEntries = alternativeGroup.flatMap((positionId) => {
      const entry = byPosition.get(positionId);
      return entry ? [entry] : [];
    });
    const alternatePath =
      alternativeEntries.length >= 2
        ? `${named(alternativeEntries[0]!)} asks for ${meaning(alternativeEntries[0]!)}, while ${named(alternativeEntries[1]!)} asks for ${meaning(alternativeEntries[1]!)}. The real branch is which demand fits the life you are prepared to live.`
        : null;
    const timing = input.configuration.capabilities.timingMethod
      ? `The approved ${input.configuration.capabilities.timingMethod.id} timing method gives a window, not an exact date.`
      : null;
    const userAgency = agencyNarration(agencySteps(frame, answer, traits, guarded));
    const personalizationLens =
      input.configuration.personalizationMode === "personalized_tarot" &&
      input.relevantTraitStatements.length > 0
        ? {
            label: "Personalized reflection" as const,
            observations: [
              ...input.relevantTraitStatements.slice(0, 3).map((trait) => trait.trim()),
              ...(input.relatedPersonContext ?? []).flatMap(
                ({ mention, relevantTraitStatements }) =>
                  relevantTraitStatements.slice(0, 1).map((trait) => `${mention}: ${trait.trim()}`),
              ),
            ].slice(0, 3),
          }
        : null;

    return readingResultSchema.parse({
      schemaVersion: "reading-result-v3",
      directAnswer,
      overallPattern,
      cards: cardResults,
      synthesis,
      likelyTrajectory,
      alternatePath,
      timing,
      userAgency,
      reflectionPrompt: reflectionQuestion(frame, answer),
      uncertaintyNote:
        "This is a conditional reading; new evidence and choices can change the direction.",
      personalizationLens,
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
    const resolved = resolveDraw(
      input.draw,
      input.questionClassification,
      input.configuration.positions,
    );
    const answer = answerCard(input.draw, resolved);
    const subject = questionSubject(input.question, input.questionClassification.topic);
    const frame = buildQuestionFrame(input.question, input.questionClassification, subject);
    const originalCard = input.originalResult.cards.find(
      ({ positionId }) => positionId === answer.position.id,
    );
    const trait =
      input.configuration.personalizationMode === "personalized_tarot"
        ? naturalTrait(input.relevantTraitStatements[0])
        : undefined;
    const relatedPerson = input.relatedPersonContext?.find(({ relevantTraitStatements }) =>
      relevantTraitStatements.some(Boolean),
    );
    const relatedTrait = naturalTrait(relatedPerson?.relevantTraitStatements[0]);
    const answerMeaning = spokenCardMeaning(answer.card, answer.orientation);
    const agency = input.originalResult.userAgency
      .replace(/[.?!]+$/, "")
      .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
    return {
      result: followUpResultSchema.parse({
        response: [
          `Looking at ${frame.focus} through the same cards, ${answer.card.name}${answer.orientation === "reversed" ? " reversed" : ""} keeps the emphasis on ${answerMeaning}.`,
          originalCard
            ? `That matters because its ${originalCard.positionLabel} passage already showed: ${originalCard.positionInterpretation}`
            : "That is the same answer-bearing thread the original reading established.",
          trait
            ? `Because ${trait}, the clarification is to notice when that familiar response begins and choose from the evidence instead.`
            : "The clarification is to wait for one observable change, then respond to what actually happens rather than to the fear of what might happen.",
          relatedPerson && relatedTrait
            ? `With ${relatedPerson.mention}, compare that evidence with their possible tendency to ${relatedTrait}; do not assume it explains their private motives.`
            : "Keep the other person's private motives open until their behavior or an honest conversation gives you evidence.",
          `For now, ${agency}.`,
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
  const authored = [
    {
      phase: "directAnswer" as const,
      heading: "Your answer",
      text: validated.directAnswer,
    },
    ...validated.cards.map((card) => ({
      phase: "cardInterpretation" as const,
      heading: card.positionLabel,
      // `positionInterpretation` is the reader-facing passage. The core
      // meaning and relationship evidence remain available in the details
      // drawer, but repeating them here made each card sound like a glossary
      // entry followed by the same reading a second time.
      text: card.positionInterpretation,
      cardPositionIds: [card.positionId],
    })),
    {
      phase: "synthesis" as const,
      heading: "The thread",
      text: `${validated.overallPattern} ${validated.synthesis}`,
      cardPositionIds: validated.cards.map(({ positionId }) => positionId),
    },
    ...(validated.likelyTrajectory
      ? [
          {
            phase: "likelyTrajectory" as const,
            heading: "If this continues",
            text: validated.likelyTrajectory,
          },
        ]
      : []),
    ...(validated.alternatePath
      ? [
          {
            phase: "alternatePath" as const,
            heading: "The other path",
            text: validated.alternatePath,
          },
        ]
      : []),
    ...(validated.timing
      ? [{ phase: "timing" as const, heading: "When to watch", text: validated.timing }]
      : []),
    {
      phase: "userAgency" as const,
      heading: "Your move",
      text: validated.userAgency,
    },
    {
      phase: "reflectionPrompt" as const,
      heading: "Hold this question",
      text: `${validated.reflectionPrompt} ${validated.uncertaintyNote}`,
    },
  ];
  return authored.map((entry, sequence) =>
    oracleStreamEventSchema.parse({ type: "phase", sequence, ...entry }),
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
  readonly id = "persisted-result-stream-v3";

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
