import type { ReadingTopic } from "@starguidance/contracts";
import { findSpread, resolveSpreadPositions, tarotCards } from "@starguidance/tarot-content";
import type { LockedDraw, SpreadPosition, TarotCard } from "@starguidance/tarot-domain";

/**
 * Composes a reading from the material a draw actually carries.
 *
 * The earlier fallback returned the same sentences for every question, spread
 * and profile: only the card names changed. It read as vague because it was —
 * the question was never consulted, the position a card landed in was ignored,
 * and one profile trait was repeated under every card.
 *
 * Everything here is deterministic and derived. Nothing is invented about the
 * person, and the raw question text is never copied into the result: readings
 * are persisted, questions are encrypted separately, and echoing one into the
 * other would quietly widen what is stored in the clear. The question shapes
 * the reading through its subject and its trait lens instead.
 */

/** The subject a question is about, inferred from its wording. */
export type QuestionSubject = "work" | "relationship" | "change" | "wellbeing" | "general";

interface SubjectVoice {
  /** Opens a sentence: "On {about}: ...". */
  readonly about: string;
  /**
   * Sits mid-sentence: "what {noun} has to contend with". Kept separate because
   * `about` already begins with "what", and reusing it produced "what what you
   * asked about ... has to contend with".
   */
  readonly noun: string;
  /** What "moving well" tends to look like in this area. */
  readonly wellPhrase: string;
}

const subjectVoices: Record<QuestionSubject, SubjectVoice> = {
  work: {
    about: "what you asked about your work and direction",
    noun: "your work and direction",
    wellPhrase: "the work becoming clearer to steer rather than heavier to carry",
  },
  relationship: {
    about: "what you asked about this relationship",
    noun: "this relationship",
    wellPhrase: "more honesty in the exchange, and less guessing at the other person",
  },
  change: {
    about: "what you asked about this change and what comes next",
    noun: "this change",
    wellPhrase: "a next step that is yours rather than one the circumstances chose",
  },
  wellbeing: {
    about: "what you asked about your wellbeing and inner balance",
    noun: "your wellbeing and inner balance",
    wellPhrase: "more room to respond with steadiness instead of running on depletion",
  },
  general: {
    about: "the question you brought",
    noun: "the question you brought",
    wellPhrase: "the situation becoming legible enough to act on",
  },
};

const subjectPatterns: readonly [RegExp, QuestionSubject][] = [
  [/\b(work|career|job|business|project|lead|colleague|manager|role)\b/i, "work"],
  [/\b(love|relationship|partner|friend|family|communicat|conflict|marriage)\b/i, "relationship"],
  [/\b(change|move|choice|decide|direction|future|next|should i)\b/i, "change"],
];

const selectedTopicSubjects: Partial<Record<ReadingTopic, QuestionSubject>> = {
  career: "work",
  relationships: "relationship",
  change: "change",
  wellbeing: "wellbeing",
};

/** The selected reading area is authoritative; wording is inference-only for General. */
export function questionSubject(
  question: string,
  selectedTopic: ReadingTopic = "general",
): QuestionSubject {
  const selectedSubject = selectedTopicSubjects[selectedTopic];
  if (selectedSubject) return selectedSubject;
  return subjectPatterns.find(([pattern]) => pattern.test(question))?.[1] ?? "general";
}

/**
 * The slot whose card carries the reading's answer.
 *
 * A reading has to answer before it elaborates, so one position is treated as
 * the answer-bearing one and named first. Which slot that is depends on what
 * the spread was designed to do.
 */
const answerPositionBySpread: Record<string, string> = {
  "one-card": "card-1",
  "three-card": "card-3",
  "celtic-cross": "celtic-outcome",
  horseshoe: "horseshoe-outcome",
  relationship: "relationship-direction",
  "nine-card-matrix": "matrix-future-integration",
  focus: "focus",
  direction: "direction",
  crossroads: "leverage",
  outlook: "outcome",
};

export interface ResolvedCard {
  readonly card: TarotCard;
  readonly position: SpreadPosition;
  readonly orientation: "upright" | "reversed";
  readonly themes: readonly string[];
}

export function resolveDraw(
  draw: LockedDraw,
  context?: { topic: string; intent: string; generalReading: boolean },
): readonly ResolvedCard[] {
  const spread = findSpread(draw.spreadId);
  if (!spread) throw new Error(`Unknown spread in locked draw: ${draw.spreadId}`);
  const positions = resolveSpreadPositions(spread, context);
  return draw.assignments.map((assignment) => {
    const card = tarotCards.find(({ id }) => id === assignment.cardId);
    if (!card) throw new Error(`Unknown locked card: ${assignment.cardId}`);
    const position = positions.find(({ id }) => id === assignment.positionId);
    if (!position) throw new Error(`Unknown position in locked draw: ${assignment.positionId}`);
    return {
      card,
      position,
      orientation: assignment.orientation,
      themes: assignment.orientation === "upright" ? card.uprightThemes : card.reversedThemes,
    };
  });
}

export function answerCard(draw: LockedDraw, resolved: readonly ResolvedCard[]): ResolvedCard {
  const wanted = answerPositionBySpread[draw.spreadId];
  return resolved.find(({ position }) => position.id === wanted) ?? resolved[0]!;
}

function named(entry: ResolvedCard): string {
  return entry.orientation === "reversed" ? `${entry.card.name} reversed` : entry.card.name;
}

function themeList(entry: ResolvedCard): string {
  return entry.themes.join(" and ");
}

/**
 * Describes the shape of the whole draw rather than each card in turn.
 *
 * Whether a spread is mostly Major Arcana, or leans into one suit, changes what
 * the reading is about at all — larger forces versus daily mechanics, feeling
 * versus resources. Saying so is what makes two readings of the same spread
 * read differently.
 */
export function drawShape(resolved: readonly ResolvedCard[]): string {
  const majors = resolved.filter(({ card }) => card.arcana === "major").length;
  const reversed = resolved.filter(({ orientation }) => orientation === "reversed").length;
  const suitCounts = new Map<string, number>();
  for (const { card } of resolved)
    if (card.suit) suitCounts.set(card.suit, (suitCounts.get(card.suit) ?? 0) + 1);
  const dominant = [...suitCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const parts: string[] = [];
  if (resolved.length === 1) {
    parts.push(
      majors === 1
        ? "A single Major Arcana card answers this, which points at something larger than the day."
        : "A single Minor Arcana card answers this, which keeps the question close to practical ground.",
    );
  } else if (majors >= Math.ceil(resolved.length / 2)) {
    parts.push(
      `${majors} of ${resolved.length} cards are Major Arcana, so this is bigger than one decision — it is a chapter rather than an errand.`,
    );
  } else if (majors === 0) {
    parts.push(
      "No Major Arcana appears, which suggests this turns on ordinary, workable details rather than fate.",
    );
  } else {
    parts.push(
      `${majors} of ${resolved.length} cards are Major Arcana, so larger currents and practical detail are both in play.`,
    );
  }

  if (dominant && dominant[1] > 1) {
    const suitDomain = suitDomains[dominant[0]];
    if (suitDomain) parts.push(`The draw leans toward ${suitDomain}.`);
  }
  if (reversed > 0)
    parts.push(
      reversed === resolved.length
        ? "Every card is reversed, which reads as energy that is present but blocked, internal, or not yet expressed."
        : `${reversed} card${reversed === 1 ? " is" : "s are"} reversed, marking where the movement is inward or stalled.`,
    );
  return parts.join(" ");
}

const suitDomains: Record<string, string> = {
  wands: "initiative and creative energy",
  cups: "emotion and relationship",
  swords: "thought, truth, and communication",
  pentacles: "resources, work, and the material world",
};

/**
 * Ties a card to the slot it landed in and to what was asked.
 *
 * This is the sentence that was missing. Without it a reading lists card
 * meanings; with it the reading explains why this card, in this place, bears on
 * this question.
 */
/**
 * Sentence frames, chosen by the card's place in the spread.
 *
 * Identical scaffolding under every card is the same defect as identical
 * readings, only smaller: three cards that all begin "In the X position" and
 * end with the same clause read as a form letter no matter how apt each card
 * is. Varying by index keeps the composition deterministic and reproducible
 * while letting the reading sound spoken.
 */
const positionalFrames: readonly ((entry: ResolvedCard, voice: SubjectVoice) => string)[] = [
  (entry) =>
    `${named(entry)} falls in ${entry.position.displayName} — ${entry.position.interpretiveFunction}. ` +
    `That card carries ${themeList(entry)}, and here it describes the ground you are standing on rather than what you hope for.`,
  (entry, voice) =>
    `Then ${entry.position.displayName}: ${named(entry)}, ${themeList(entry)}. ` +
    `This is ${entry.position.interpretiveFunction}, so it marks what ${voice.noun} has to contend with, not what it should become.`,
  (entry, voice) =>
    `In ${entry.position.displayName} sits ${named(entry)} — ${themeList(entry)}. ` +
    `Because this position shows ${entry.position.interpretiveFunction}, it is the part of ${voice.noun} that is still open to you.`,
  (entry) =>
    `${entry.position.displayName} holds ${named(entry)}: ${themeList(entry)}. ` +
    `Read it as ${entry.position.interpretiveFunction} — one thread of the whole, not the whole.`,
];

export function positionalReading(
  entry: ResolvedCard,
  subject: QuestionSubject,
  index = 0,
): string {
  const frame = positionalFrames[index % positionalFrames.length]!;
  return frame(entry, subjectVoices[subject]);
}

/**
 * Personalises emphasis without overriding the card.
 *
 * AI-010 requires that a profile trait shift emphasis rather than reverse
 * meaning, so the trait is offered as a lens on the card rather than as a
 * replacement for it. Each card draws a different trait: repeating one under
 * every card was a large part of why readings felt generic.
 */
export function personalEmphasis(
  entry: ResolvedCard,
  trait: string | undefined,
  subject: QuestionSubject,
  index = 0,
): string {
  if (!trait)
    return (
      `Notice which part of ${themeList(entry)} matches what you can actually observe here, ` +
      "and which part is inference you have added."
    );
  const voice = subjectVoices[subject];
  const frames = [
    `Your own pattern meets this directly: ${trait} ${entry.card.name} does not change because of that — but where it lands for you does.`,
    `Set that against how you tend to work: ${trait} The card keeps its meaning; what shifts is the cost of ignoring it.`,
    `This is worth naming, because ${trait} Read ${entry.card.name} through that, and ${voice.wellPhrase} asks something specific of you.`,
  ];
  return frames[index % frames.length]!;
}

export function trajectoryFrom(
  answer: ResolvedCard,
  resolved: readonly ResolvedCard[],
  subject: QuestionSubject,
): {
  readonly summary: string;
  readonly conditions: string[];
  readonly alternateTrajectory: string;
} {
  const friction = resolved.find(({ position }) =>
    ["challenge", "obstacle", "hidden-influence"].includes(position.id),
  );
  const lever = resolved.find(({ position }) => position.id === "leverage");
  const voice = subjectVoices[subject];

  const conditions = [
    `The pattern in the ${answer.position.displayName} position — ${themeList(answer)} — continues as it is now`,
  ];
  if (friction)
    conditions.push(
      `${named(friction)} in the ${friction.position.displayName} position stays unaddressed`,
    );
  conditions.push("No new evidence changes what you currently believe about this");

  return {
    summary:
      `If nothing shifts, this moves toward ${themeList(answer)} — ` +
      `${answer.orientation === "reversed" ? "held inward or delayed rather than expressed outwardly" : "becoming more visible and more explicit over time"}. ` +
      `That would look like ${voice.wellPhrase}, or its absence.`,
    conditions,
    alternateTrajectory: lever
      ? `A different route runs through the ${lever.position.displayName} position: ${named(lever)}, ${themeList(lever)}. Acting there changes the shape of the rest.`
      : `A deliberate change — one conversation, one boundary, one piece of evidence you go and find — moves this off the line it is currently on.`,
  };
}

export function agencyFrom(
  answer: ResolvedCard,
  resolved: readonly ResolvedCard[],
  traits: readonly string[],
): string[] {
  const lever = resolved.find(({ position }) => position.id === "leverage") ?? answer;
  const steps = [
    `Name one thing about ${themeList(answer)} you can actually verify this week`,
    `Act once where ${named(lever)} points — small and proportionate, not decisive`,
  ];
  if (traits[0])
    steps.push(
      "Watch for the moment your usual pattern takes over, and choose deliberately at that point",
    );
  steps.push("Revisit this only when something real has changed, not to get a better answer");
  return steps;
}

export function disconfirmingFrom(resolved: readonly ResolvedCard[]): string[] {
  const evidence = resolved
    .slice(0, 2)
    .map(
      (entry) =>
        `Behaviour that contradicts ${themeList(entry)} where you expected ${entry.position.displayName.toLowerCase()}`,
    );
  evidence.push("Someone involved acting differently from how you have assumed they will");
  return evidence;
}

/**
 * Category-specific reframing for the nine SafetyCategory values where
 * classifyQuestion() sets `interrupt: false` but flags that a confident
 * answer would do real harm (see GUARDED_CATEGORIES in groq-provider.ts).
 *
 * Before this, every one of these categories rendered the exact same
 * `safety.guidance` sentence verbatim — a legal question and a pregnancy
 * question reframed identically, repeated under every card of the same
 * reading. `selfHarmCrisis` and `compulsiveReading` have no entry here: both
 * set `interrupt: true`, so classifyQuestion() never lets a reading reach
 * this function for them at all.
 */
export interface GuardedReframe {
  /** Two card-side phrasings, rotated by index so a multi-card spread doesn't repeat itself. */
  readonly questionConnection: readonly [string, string];
  /** The reading's opening line. Receives `voice.about`, same as the ordinary branch. */
  readonly directAnswer: (about: string) => string;
}

export const GUARDED_REFRAMES: Record<string, GuardedReframe> = {
  medical: {
    questionConnection: [
      "This card speaks to what you can prepare, ask, and track — not to a diagnosis or a medical outcome.",
      "Read this as a prompt for the conversation to have with a clinician, not as the result of one.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards can't diagnose or predict a medical outcome, and won't try to. What they can do is point at what's within reach — the question to ask, the appointment to make, the symptom worth tracking.`,
  },
  legal: {
    questionConnection: [
      "This card points to what's documented, prepared, or worth asking counsel about — not to how a case resolves.",
      "Take this as a cue about your own record and preparation, not a forecast of a verdict.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards won't forecast a verdict or a legal outcome. They point instead at what's in your hands — documentation, timing, and the value of qualified counsel.`,
  },
  financial: {
    questionConnection: [
      "This card is about your own risk tolerance and habits, not a signal to buy, sell, or hold.",
      "Read this as a prompt to examine your reasoning, not as investment guidance.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards won't predict a return or tell you what to buy or sell. They're better read as a mirror on your own risk tolerance and the homework still worth doing.`,
  },
  mentalHealthDiagnosis: {
    questionConnection: [
      "This card reflects a pattern worth naming for yourself, not a label to place on anyone.",
      "Take this as an invitation to notice the pattern, not to diagnose it.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards can't diagnose a person or a condition — a label like that belongs to a qualified professional, not a reading. What they can do is name a pattern worth paying attention to.`,
  },
  physicalDeath: {
    questionConnection: [
      "This card speaks to what's within your control now, not to a date or a certainty about an ending.",
      "Read this as a prompt to attend to what matters now, not a prediction of when.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards don't predict a death or a timeline, and won't claim to. What they can offer is a nudge toward what's within reach right now — a conversation, a visit, a piece of care that doesn't need to wait.`,
  },
  criminalGuilt: {
    questionConnection: [
      "This card points to the evidence and process worth following, not to a verdict on anyone's guilt.",
      "Take this as a cue about what's yours to look into, not an assertion about someone's innocence or guilt.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards won't assert anyone's guilt or innocence — that's a question for evidence and process, not a reading. What they can point to is what's worth looking into, and who's worth asking.`,
  },
  pregnancy: {
    questionConnection: [
      "This card speaks to what you can plan for and ask about, not to a confirmation either way.",
      "Read this as a nudge toward the test or the conversation, not a substitute for either.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards can't confirm or predict a pregnancy, and won't try to. A test and a clinician answer that question — what the cards can speak to is how you're meeting the waiting itself.`,
  },
  infidelity: {
    questionConnection: [
      "This card speaks to what you've actually observed, not to a claim about anyone's faithfulness.",
      "Take this as a prompt for a direct conversation, not a verdict on someone you can't ask here.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards won't assert whether someone has been faithful — that isn't theirs to say. What they can speak to is what you've directly observed, and whether a direct conversation is the piece still missing.`,
  },
  thirdPartyPrivateClaim: {
    questionConnection: [
      "This card reflects what's visible to you, not a claim about what someone else is privately thinking.",
      "Read this as a prompt to ask directly, not a substitute for what only they could tell you.",
    ],
    directAnswer: (about) =>
      `On ${about}: the cards can't tell you what's in someone else's head — that's private, and not this reading's to claim. What they can speak to is what's visible from where you stand, and what's worth asking outright.`,
  },
};

export function guardedQuestionConnection(
  category: string,
  index: number,
  fallback: string,
): string {
  const reframe = GUARDED_REFRAMES[category];
  if (!reframe) return fallback;
  return reframe.questionConnection[index % reframe.questionConnection.length]!;
}

export function guardedDirectAnswer(category: string, about: string, fallback: string): string {
  const reframe = GUARDED_REFRAMES[category];
  return reframe ? reframe.directAnswer(about) : fallback;
}

export { subjectVoices };
