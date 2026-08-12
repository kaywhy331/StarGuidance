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
  agencyFrom,
  answerCard,
  disconfirmingFrom,
  guardedDirectAnswer,
  questionSubject,
  resolveDraw,
  subjectVoices,
  trajectoryFrom,
  type QuestionSubject,
  type ResolvedCard,
} from "./interpretation";

export interface InterpretationProvider<TInput, TOutput> {
  readonly id: string;
  generate(input: TInput, signal?: AbortSignal): Promise<TOutput>;
}

export const FALLBACK_PROVIDER_ID = "deterministic-fallback-v1" as const;
export const FALLBACK_PROMPT_VERSION = "deterministic-fallback-v3" as const;
export const READING_RESULT_SCHEMA_VERSION = "reading-result-v2" as const;

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
  ["career", /\b(work|career|job|business|project|lead|role)\b/i],
  ["relationships", /\b(love|relationship|partner|friend|family|communicat|conflict)\b/i],
  ["change", /\b(change|move|choice|direction|transition|future|next)\b/i],
  ["wellbeing", /\b(wellbeing|well-being|balance|rest|energy|habit|stress)\b/i],
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
    const trajectory = trajectoryFrom(answer, resolved, subject);
    const agency = agencyFrom(answer, resolved, traits);
    const openingId = "opening";
    const turningId = "turning-point";
    const likelyId = "likely-trajectory";
    const alternateId = "alternate-trajectory";
    const agencyId = "agency";
    const closingId = "closing";
    const cardPassages = resolved.map((entry, index) => ({
      id: `thread-${index + 1}`,
      role:
        index === resolved.length - 1 && resolved.length > 1
          ? ("development" as const)
          : ("underlyingPattern" as const),
      text: cardNarration(entry, subject, index, safety.category !== "ordinary"),
      cardReferences: [entry.position.id],
    }));
    const shouldCloseWithQuestion = resolved.length === 3 || resolved.length === 9;
    const passages = [
      {
        id: openingId,
        role: safety.category === "ordinary" ? ("opening" as const) : ("safety" as const),
        text:
          safety.category === "ordinary"
            ? openingNarration(answer, subject)
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
        text: turningPointNarration(answer, traits[0], subject),
        cardReferences: [answer.position.id],
      },
      {
        id: likelyId,
        role: "trajectory" as const,
        text: likelyNarration(answer, subject, safety.category !== "ordinary"),
        cardReferences: [answer.position.id],
      },
      {
        id: alternateId,
        role: "alternative" as const,
        text: alternateNarration(resolved, subject),
        cardReferences: [
          (
            resolved.find(({ position }) =>
              ["leverage", "horseshoe-action", "relationship-direction", "card-3"].includes(
                position.id,
              ),
            ) ?? answer
          ).position.id,
        ],
      },
      {
        id: agencyId,
        role: "agency" as const,
        text: agencyNarration(agency),
        cardReferences: [answer.position.id],
      },
      {
        id: closingId,
        role: shouldCloseWithQuestion ? ("reflection" as const) : ("closing" as const),
        text: shouldCloseWithQuestion
          ? answer.card.reflectivePrompt
          : closingNarration(answer, subject),
        cardReferences: [answer.position.id],
      },
    ];

    return readingResultSchema.parse({
      schemaVersion: "reading-result-v2",
      title: narrationTitle(subject, answer),
      passages,
      cards: resolved.map((entry, index) => ({
        positionId: entry.position.id,
        cardId: entry.card.id,
        orientation: entry.orientation,
        passageIds: [
          `thread-${index + 1}`,
          ...(entry.position.id === answer.position.id
            ? [openingId, turningId, likelyId, agencyId, closingId]
            : []),
        ],
      })),
      trajectory: {
        likelyPassageId: likelyId,
        conditions: trajectory.conditions,
        alternatePassageId: alternateId,
      },
      userAgency: agency,
      reflectionQuestion: answer.card.reflectivePrompt,
      disconfirmingEvidence: disconfirmingFrom(resolved),
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
    const resolved = resolveDraw(input.draw, input.questionClassification);
    const answer = answerCard(input.draw, resolved);
    const originalThread = input.originalResult.cards.find(
      ({ positionId }) => positionId === answer.position.id,
    );
    const originalPassage = input.originalResult.passages.find(({ id }) =>
      originalThread?.passageIds.includes(id),
    );
    const trait = naturalTrait(input.relevantTraitStatements[0]);
    return followUpResultSchema.parse({
      response: [
        `Coming back to ${answer.card.name}${answer.orientation === "reversed" ? " reversed" : ""}, the part that matters now is ${answer.themes.join(" and ")}.`,
        originalPassage?.text ??
          "That was already the thread carrying the original reading forward.",
        trait
          ? `Because ${trait}, I think the useful move is to notice the moment that familiar response begins and choose deliberately there.`
          : "I think the useful move is to wait for one observable change, then respond to that rather than to the fear of what might happen.",
        `For now, ${(input.originalResult.userAgency[0] ?? "Keep the next step small enough to revise").replace(/[.?!]+$/, "").replace(/^[A-Z]/, (letter) => letter.toLowerCase())}.`,
      ].join(" "),
    });
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

function namedCard(entry: ResolvedCard): string {
  return entry.orientation === "reversed" ? `${entry.card.name} reversed` : entry.card.name;
}

function narrationTitle(subject: QuestionSubject, answer: ResolvedCard): string {
  if (answer.orientation === "reversed") return "What is waiting beneath the surface";
  return {
    work: "What is beginning to take shape",
    relationship: "The point where the connection changes",
    change: "The next movement is closer than it looks",
    wellbeing: "A quieter way forward",
    general: "What wants your attention now",
  }[subject];
}

function focusPhrase(subject: QuestionSubject): string {
  return {
    work: "the structure around your work",
    relationship: "the way this connection is unfolding",
    change: "this transition",
    wellbeing: "the way you've been carrying your energy",
    general: "the situation around you",
  }[subject];
}

function counterpoint(entry: ResolvedCard): string {
  if (entry.card.suit === "pentacles") return "expansion for its own sake";
  if (entry.card.suit === "wands") return "waiting for perfect certainty";
  if (entry.card.suit === "cups") return "trying to reason your way around what you feel";
  if (entry.card.suit === "swords") return "keeping every possibility open";
  return "forcing an answer before the situation is ready";
}

function openingNarration(answer: ResolvedCard, subject: QuestionSubject): string {
  const focus = focusPhrase(subject);
  const spokenName = answer.card.name.startsWith("The ")
    ? namedCard(answer)
    : `The ${namedCard(answer)}`;
  if (answer.position.displayName === "Yes / No Pivot")
    return answer.orientation === "upright"
      ? `${spokenName} gives this an open, actionable quality rather than a guaranteed yes. ${answer.themes[0]} seems possible around ${answer.themes[1]}, but it still needs your participation. I think the real answer will become visible through what is actually offered, agreed, or acted on next.`
      : `${spokenName} makes this feel obstructed or premature rather than like a clean no. ${answer.themes[0]} is present around ${answer.themes[1]}, but it isn't moving freely yet. Watch what remains delayed or unspoken before you treat the situation as settled.`;
  return answer.orientation === "upright"
    ? `${spokenName} feels like ${focus} is entering a period where ${answer.themes[0]} is going to matter more than ${counterpoint(answer)}. You may find yourself becoming more deliberate about ${answer.themes[1]}, and I don't think that's happening by accident.`
    : `${spokenName} makes me think something around ${focus} is present but not moving cleanly yet. ${answer.themes[0]} may be happening privately before anyone else can see it, especially around ${answer.themes[1]}. I don't think it stays hidden in quite the same way for long.`;
}

function manifestation(subject: QuestionSubject, index: number): string {
  const options: Record<QuestionSubject, readonly string[]> = {
    work: [
      "a conversation about responsibility or timing",
      "an opportunity to strengthen something already underway",
      "a practical choice involving money, workload, or ownership",
    ],
    relationship: [
      "a change in someone's follow-through",
      "a conversation that makes the present dynamic harder to avoid",
      "a boundary, invitation, or decision becoming visible through behavior",
    ],
    change: [
      "one option becoming more concrete than the others",
      "a decision acquiring a real deadline",
      "an opening that asks for action before complete certainty",
    ],
    wellbeing: [
      "a routine showing you what is and isn't sustainable",
      "a need for rest or a firmer boundary becoming difficult to ignore",
      "one small change in how you protect your time and energy",
    ],
    general: [
      "a conversation, invitation, or practical change",
      "something already in motion becoming easier to name",
      "a realization that makes the next choice more concrete",
    ],
  };
  const choices = options[subject];
  return choices[index % choices.length]!;
}

function cardNarration(
  entry: ResolvedCard,
  subject: QuestionSubject,
  index: number,
  guarded: boolean,
): string {
  const movement =
    entry.orientation === "upright"
      ? `${entry.themes[0]} is ready to become more visible`
      : `${entry.themes[0]} is present, but delayed, blocked, or being worked through privately`;
  const event = guarded
    ? "observable evidence, a qualified conversation, or a practical next step"
    : manifestation(subject, index);
  const frames = [
    `You may notice that ${movement}, especially around ${entry.themes[1]}. That seems tied to ${entry.position.interpretiveFunction}, and it may first show itself through ${event}.`,
    `There's also a thread of ${entry.themes.join(" and ")} running underneath this. Because it speaks to ${entry.position.interpretiveFunction}, I wouldn't be surprised if it becomes visible through ${event}.`,
    `The quieter part of this is ${entry.themes.join(" and ")}. It belongs to ${entry.position.interpretiveFunction}; watch for ${event}, because that may be where the meaning stops being abstract.`,
    `Then the energy changes. ${movement}, and it touches ${entry.position.interpretiveFunction}. The first real sign may be ${event}.`,
    `What complicates the picture is ${entry.themes.join(" and ")}. This seems to be shaping ${entry.position.interpretiveFunction}, even if you only recognize it after ${event}.`,
    `What helps is that ${movement}. Since this part of the spread is about ${entry.position.interpretiveFunction}, ${event} could give you something concrete to respond to.`,
  ];
  return frames[index % frames.length]!;
}

function turningPointNarration(
  answer: ResolvedCard,
  trait: string | undefined,
  subject: QuestionSubject,
): string {
  const personal = naturalTrait(trait);
  if (personal)
    return `The interesting part is that ${answer.themes[0]} may eventually create the room for your next risk. Because ${personal}, staying with the tension may become harder than making one clear move. That may be the turning point.`;
  return `The interesting part is that what feels protective now may eventually become the thing that makes movement possible. Watch for the moment when ${manifestation(subject, 2)}; that may be the turning point.`;
}

function likelyNarration(answer: ResolvedCard, subject: QuestionSubject, guarded: boolean): string {
  const event = guarded
    ? "new evidence or advice from the right professional"
    : manifestation(subject, 1);
  return `This feels like it's leading toward ${subjectVoices[subject].wellPhrase}. If the current energy continues, I think you're going to notice ${event}, followed by ${answer.themes[0]} becoming ${answer.orientation === "upright" ? "easier to act on" : "too important to keep postponing"}. It isn't fixed, but it is the clearest direction from where things stand now.`;
}

function alternateNarration(resolved: readonly ResolvedCard[], subject: QuestionSubject): string {
  const lever =
    resolved.find(({ position }) =>
      ["leverage", "horseshoe-action", "relationship-direction", "card-3"].includes(position.id),
    ) ?? resolved.at(-1)!;
  return `There is another route. A direct conversation, a changed boundary, or new evidence could move this away from its present line. If that happens, ${lever.themes[0]} around ${lever.themes[1]} becomes more important than the outcome you expected, and ${manifestation(subject, 0)} may point somewhere more useful.`;
}

function agencyNarration(agency: readonly string[]): string {
  const [first, second] = agency;
  return `Your part is smaller—and more powerful—than controlling the outcome. ${first ?? "Name what you can verify"}. Then ${second?.replace(/^[A-Z]/, (letter) => letter.toLowerCase()) ?? "take one proportionate step and leave room to revise it"}.`;
}

function closingNarration(answer: ResolvedCard, subject: QuestionSubject): string {
  return answer.orientation === "reversed"
    ? `So don't mistake a delay for a final answer. I think ${manifestation(subject, 2)} will show you whether this energy is gathering strength or asking to be released.`
    : `This doesn't feel like an ending. It feels like the point just before ${answer.themes[0]} gives you enough room to let something move again.`;
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
