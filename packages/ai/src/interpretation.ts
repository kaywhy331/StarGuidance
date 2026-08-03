import type { ReadingResult } from "@starguidance/contracts";
import { spreads, tarotCards } from "@starguidance/tarot-content";
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
export type QuestionSubject = "work" | "relationship" | "change" | "general";

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

export function questionSubject(question: string): QuestionSubject {
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

export function resolveDraw(draw: LockedDraw): readonly ResolvedCard[] {
  const spread = spreads.find(({ id }) => id === draw.spreadId);
  if (!spread) throw new Error(`Unknown spread in locked draw: ${draw.spreadId}`);
  return draw.assignments.map((assignment) => {
    const card = tarotCards.find(({ id }) => id === assignment.cardId);
    if (!card) throw new Error(`Unknown locked card: ${assignment.cardId}`);
    const position = spread.positions.find(({ id }) => id === assignment.positionId);
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
): ReadingResult["likelyTrajectory"] {
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

export { subjectVoices };
