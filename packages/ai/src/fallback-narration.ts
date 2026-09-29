import type { QuestionClassification } from "@starguidance/contracts";

import { cardReference, positionPhrase, spokenCardMeaning } from "./card-language";
import { GUARDED_REFRAMES, type QuestionSubject, type ResolvedCard } from "./interpretation";

type QuestionMode = "decision" | "forecast" | "process" | "understanding" | "general";

export interface QuestionFrame {
  readonly focus: string;
  readonly horizonLead: string;
  readonly mode: QuestionMode;
  readonly subject: QuestionSubject;
}

function focusFor(question: string, subject: QuestionSubject): string {
  const matches = (pattern: RegExp) => pattern.test(question);
  if (subject === "work") {
    if (matches(/\bpromot(?:e|ed|ion)\b/i)) return "the promotion";
    if (matches(/\braise\b/i)) return "the raise";
    if (matches(/\b(interview|application|hiring)\b/i)) return "the hiring process";
    if (matches(/\boffer\b/i)) return "the offer";
    if (matches(/\b(role|position)\b/i)) return "the role";
    if (matches(/\b(quit|leave|resign)\b/i)) return "whether this work still fits";
    if (matches(/\bcontract\b/i)) return "the contract";
    if (matches(/\bclient\b/i)) return "the client situation";
    if (matches(/\b(team|coworker|colleague)\b/i)) return "the team situation";
    if (matches(/\b(salary|pay|income)\b/i)) return "your compensation";
    if (matches(/\bbusiness\b/i)) return "the business decision";
    if (matches(/\bproject\b/i)) return "the project";
    if (matches(/\b(next step|first step|direction|what comes next|move forward)\b/i))
      return "the next step in your work";
    return "your work situation";
  }
  if (subject === "relationship") {
    if (matches(/\b(reconcil|reconnect|ex\b|come back|get back together)\b/i))
      return "whether this connection can reopen";
    if (matches(/\b(commit|marry|marriage|engag)\b/i)) return "where this commitment is heading";
    if (matches(/\b(talk|conversation|communicat)\b/i))
      return "the conversation you are considering";
    if (matches(/\b(break ?up|leave|end(?:ing)?)\b/i))
      return "whether this relationship can continue in its current form";
    return "this relationship";
  }
  if (subject === "change") {
    if (matches(/\b(move|relocat)\b/i)) return "the possible move";
    if (matches(/\b(choose|choice|decision|path|option)\b/i)) return "the choice in front of you";
    return "what comes next";
  }
  if (subject === "wellbeing") {
    if (matches(/\b(burnout|stress|overwhelm)\b/i)) return "the strain you have been carrying";
    if (matches(/\b(rest|energy|capacity)\b/i)) return "your energy and capacity";
    if (matches(/\b(habit|routine)\b/i)) return "the pattern you are trying to change";
    return "your sense of balance";
  }
  return "the situation you asked about";
}

function questionMode(question: string, context: QuestionClassification): QuestionMode {
  if (context.generalReading) return "general";
  if (context.intent === "decisionSupport") return "decision";
  if (/\b(will|when|what happens|going to|likely|expect)\b/i.test(question)) return "forecast";
  if (context.intent === "planning" || context.intent === "emotionalProcessing") return "process";
  return "understanding";
}

export function buildQuestionFrame(
  question: string,
  context: QuestionClassification,
  subject: QuestionSubject,
): QuestionFrame {
  const horizonLead = {
    immediate: "In the immediate stretch ahead",
    weeks: "Over the next few weeks",
    months: "Over the next few months",
    open: "As this develops",
  }[context.horizon];
  return {
    focus: focusFor(question, subject),
    horizonLead,
    mode: questionMode(question, context),
    subject,
  };
}

function namedCard(entry: ResolvedCard, sentenceStart = false): string {
  return cardReference(entry.card, { sentenceStart, reversed: entry.orientation === "reversed" });
}

function capitalize(value: string): string {
  return value.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

function lowerFirst(value: string): string {
  return value.replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

/**
 * Picks the first candidate sentence the reading has not already used.
 *
 * Every passage draws its closing line from an ordered pool (position-specific
 * first, then generic), so the same sentence never repeats within one reading
 * as long as the pool is larger than the spread. Deterministic: the same draw
 * always produces the same text.
 */
function pickFresh(candidates: readonly string[], used?: Set<string>): string {
  const choice = candidates.find((candidate) => !used?.has(candidate)) ?? candidates[0]!;
  used?.add(choice);
  return choice;
}

function rotate<T>(values: readonly T[], offset: number): T[] {
  const start = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

function meaning(entry: ResolvedCard): string {
  return spokenCardMeaning(entry.card, entry.orientation);
}

function directEvidence(frame: QuestionFrame, orientation: ResolvedCard["orientation"]): string {
  const open = orientation === "upright";
  if (frame.subject === "work")
    return open
      ? "Watch for clear ownership, a real deadline, and changed responsibilities."
      : "Without clear ownership, timing, and follow-through, the uncertainty is likely to continue.";
  if (frame.subject === "relationship")
    return open
      ? "Let consistency, reciprocity, and the conversation that happens outweigh hope alone."
      : "What is avoided, delayed, or contradicted by behavior will tell you more than guessing.";
  if (frame.subject === "change")
    return open
      ? "The useful path becomes clearer when you test it with one reversible step."
      : "Do not force the decision; first find the missing fact, boundary, or support.";
  if (frame.subject === "wellbeing")
    return open
      ? "A useful change will give you steadier energy and more room to respond."
      : "Treat reduced capacity as information, then make one sustainable adjustment.";
  return open
    ? "The next observable action will show whether this opening has substance."
    : "Notice what stays vague or postponed before treating this as settled.";
}

export function narrationTitle(frame: QuestionFrame, answer: ResolvedCard): string {
  const reversed = answer.orientation === "reversed";
  return {
    work: reversed ? "Clarity before commitment" : "A path becoming concrete",
    relationship: reversed
      ? "What the connection cannot keep avoiding"
      : "Where reciprocity begins to show",
    change: reversed ? "The pause before the real decision" : "The opening in front of you",
    wellbeing: reversed ? "What your energy is asking you to change" : "A steadier way forward",
    general: reversed ? "What is not ready to be forced" : "What is beginning to move",
  }[frame.subject];
}

export function openingNarration(
  answer: ResolvedCard,
  frame: QuestionFrame,
  trait?: string,
): string {
  const card = namedCard(answer, true);
  const cardMeaning = meaning(answer);
  const personal = naturalTrait(trait);
  const lead =
    frame.mode === "decision"
      ? frame.subject === "relationship" && frame.focus.includes("continue")
        ? `This relationship cannot continue unchanged. ${card} says your decision turns on ${cardMeaning}.`
        : `Do not force a final yes or no around ${frame.focus} yet. ${card} says the choice turns on ${cardMeaning}.`
      : frame.mode === "forecast"
        ? `A direction is forming around ${frame.focus}, but it is not fixed. ${card} points toward ${cardMeaning}.`
        : frame.mode === "process"
          ? `For ${frame.focus}, the place to begin is ${cardMeaning}. ${card} makes that the clearest message in your spread.`
          : frame.mode === "general"
            ? `Something is ready to move, but only through ${cardMeaning}. ${card} makes that the heart of your reading.`
            : `What I see around ${frame.focus} is ${cardMeaning}. ${card} puts that at the center of your answer.`;
  const evidence = directEvidence(frame, answer.orientation);
  const grounded = personal
    ? `Because ${personal}, ${evidence.replace(/^[A-Z]/, (letter) => letter.toLowerCase())}`
    : evidence;
  return `${lead} ${grounded}`.replace(/\s+/g, " ").trim();
}

/**
 * Reads the spread as one movement before the card-by-card support begins.
 * This deliberately talks about the question and the relationship between
 * positions; card glossary language belongs in the evidence drawer.
 */
export function overallPatternNarration(
  resolved: readonly ResolvedCard[],
  frame: QuestionFrame,
): string {
  const [first, second, third] = resolved;
  if (!first) return `${frame.focus} remains open; do not force a conclusion yet.`;
  if (resolved.length === 1)
    return `${namedCard(first, true)} keeps this simple: ${meaning(first)}. Judge ${frame.focus} by whether that is visible now.`;

  const situation = resolved.find(({ position }) =>
    /situation|present|current|foundation/i.test(`${position.id} ${position.displayName}`),
  );
  const challenge = resolved.find(({ position }) =>
    /challenge|obstacle|cross|pressure/i.test(`${position.id} ${position.displayName}`),
  );
  const direction = resolved.find(({ position }) =>
    /direction|outcome|leverage|resolution|action/i.test(`${position.id} ${position.displayName}`),
  );
  if (situation && challenge && direction)
    return `${namedCard(situation, true)} shows what is active, ${namedCard(challenge)} names the pressure, and ${namedCard(direction)} shows what can change the answer.`;

  if (first && second && third)
    return `The spread moves from ${meaning(first)}, through ${meaning(second)}, and toward ${meaning(third)}. That turn is the message.`;

  return `${namedCard(first, true)} establishes ${meaning(first)}; the other cards show what supports it, resists it, and remains yours to influence.`;
}

const matrixPositionOpeners: Readonly<Record<string, string>> = {
  "matrix-past-internal": "Looking back at the inner beginning of this",
  "matrix-past-external": "In the circumstances that formed around that beginning",
  "matrix-past-integration": "When I look at what the past left you carrying",
  "matrix-present-internal": "Inside the situation now",
  "matrix-present-external": "In what is visibly happening now",
  "matrix-present-integration": "At the choice available in the present",
  "matrix-future-internal": "As the inner story moves forward",
  "matrix-future-external": "In the developments gathering around you",
  "matrix-future-integration": "As the whole spread comes together",
};

function positionConnection(entry: ResolvedCard, frame: QuestionFrame): string {
  const id = entry.position.id;
  const exact: Readonly<Record<string, string>> = {
    "matrix-past-internal": `That suggests your understanding of ${frame.focus} changed before the visible circumstances did.`,
    "matrix-past-external":
      "This is the practical history the present situation is still resting on.",
    "matrix-past-integration":
      "What carried forward was not only what happened, but what it taught you to protect.",
    "matrix-present-internal": `This is already shaping how you read ${frame.focus}, even if you have not said it aloud.`,
    "matrix-present-external":
      "This part belongs to observable circumstances, so facts and follow-through matter more than intention here.",
    "matrix-present-integration": "This is the part you can work with now rather than wait on.",
    "matrix-future-internal":
      "The first change may be in your own threshold, priorities, or willingness to continue.",
    "matrix-future-external":
      "Watch for this in actions, timing, and concrete developments rather than reassurance alone.",
    "matrix-future-integration":
      "This is the condition the answer rests on, not a promise that the outcome is fixed.",
  };
  if (exact[id]) return exact[id];
  const position = `${id} ${entry.position.displayName}`.toLowerCase();
  if (/past|foundation|history|root/.test(position))
    return `This helps explain why ${frame.focus} feels the way it does now.`;
  if (/present|current|situation|center|focus/.test(position))
    return "This is already active; it is not a distant possibility or a hidden future cause.";
  if (/challenge|obstacle|cross|block/.test(position))
    return "This is the difficulty to work with directly rather than the part to explain away.";
  if (/future|incoming|outcome|direction|ahead/.test(position))
    return `This is conditional guidance for ${frame.focus}, and it changes if the present pattern changes.`;
  if (/external|environment|surround/.test(position))
    return "Because this sits outside your control, let visible behavior carry more weight than speculation.";
  if (/strength|leverage|support|advice|resolution|action/.test(position))
    return "This is where one proportionate action can change more than continued analysis will.";
  if (/hope|fear/.test(position))
    return "It shows why desire and caution may be difficult to separate right now.";
  return `This adds another layer to ${frame.focus} rather than replacing what the earlier cards showed.`;
}

/**
 * Second sentences for a reversed card. These stay neutral about direction:
 * the approved facet is explained in the evidence drawer, where it can sit
 * next to the card meaning instead of competing with it mid-passage.
 */
const reversedLines = [
  "The movement here is slower or more inward, so steady it before you lean on it.",
  "Its energy is present but not flowing freely yet; small corrections will matter more than force.",
  "This part is still turned inward, so give it attention before you rely on it.",
  "What this card asks for is not missing, only not yet at ease; tend it before trusting it.",
] as const;

const genericClosers = [
  "Notice where this already shows up in what you can see.",
  "Let what actually happens confirm this before you lean on it.",
  "Treat this as one strand of the story rather than the whole of it.",
  "Give this a little attention before deciding what it means for you.",
  "It asks to be noticed more than solved.",
  "Hold this lightly; its meaning sharpens once you act.",
  "This is worth naming plainly, even if only to yourself.",
  "It is part of the picture, and it can shift as you do.",
  "Let this inform your next small step rather than the final answer.",
  "Watch how this plays out before drawing a firm conclusion.",
] as const;

const guardedClosers = [
  "Keep this tied to evidence, a direct conversation, and the choice that is yours.",
  "Let it shape how you prepare and who you ask, not what you conclude.",
  "Hold it as a reflection on your own next step, not an answer about the facts.",
  "Use it to steady yourself, then bring the factual question to someone who can check it.",
  "Let it point you toward support rather than toward a verdict.",
  "Treat it as a prompt for care and preparation, not as a prediction.",
  "Keep what you know and what you fear separate while you sit with this card.",
  "Let this card inform your next conversation, not replace it.",
] as const;

function cardLead(entry: ResolvedCard, index: number): string {
  const cardMeaning = meaning(entry);
  const matrixOpener = matrixPositionOpeners[entry.position.id];
  if (matrixOpener) return `${matrixOpener}, ${namedCard(entry)} speaks to ${cardMeaning}.`;
  const place = positionPhrase(entry.position.displayName);
  const frames = [
    () => `${namedCard(entry, true)} sits in ${place} — ${cardMeaning}.`,
    () => `In ${place}, ${namedCard(entry)} brings ${cardMeaning}.`,
    () => `${namedCard(entry, true)} lands in ${place}, pointing to ${cardMeaning}.`,
    () => `${capitalize(place)} holds ${namedCard(entry)}: ${cardMeaning}.`,
  ];
  return frames[index % frames.length]!();
}

export function cardNarration(
  entry: ResolvedCard,
  frame: QuestionFrame,
  index: number,
  guarded: boolean,
  trait?: string,
  used?: Set<string>,
): string {
  const lead = cardLead(entry, index);
  const personal = naturalTrait(trait);
  const reversed = entry.orientation === "reversed";
  const candidates = guarded
    ? rotate(guardedClosers, index)
    : [
        ...(personal ? [`That matters here because ${personal}.`] : []),
        ...(reversed ? rotate(reversedLines, index) : [positionConnection(entry, frame)]),
        ...(reversed ? [positionConnection(entry, frame)] : []),
        ...rotate(genericClosers, index),
      ];
  return `${lead} ${pickFresh(candidates, used)}`;
}

/**
 * Card passage for a guarded question (medical, legal, and so on). It names
 * the card and its place but deliberately leaves out the card meaning, so a
 * reading about a pregnancy or a court case never reads as a factual answer.
 */
export function guardedCardNarration(
  entry: ResolvedCard,
  index: number,
  category: string,
  used?: Set<string>,
): string {
  const place = positionPhrase(entry.position.displayName);
  const lead = `${namedCard(entry, true)} sits in ${place}.`;
  const reframe = GUARDED_REFRAMES[category]?.questionConnection ?? [];
  const candidates = [
    ...(reframe.length > 0 ? rotate(reframe, index) : []),
    ...rotate(guardedClosers, index),
  ];
  return `${lead} ${pickFresh(candidates, used)}`;
}

function naturalTrait(trait: string | undefined): string | undefined {
  if (!trait) return undefined;
  return trait
    .replace(/^Tension to hold:\s*/i, "")
    .replace(/[.?!]+$/, "")
    .trim()
    .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function turningAction(subject: QuestionSubject): string {
  return {
    work: "responsibility, timing, and authority are made explicit instead of inferred",
    relationship:
      "you stop reading potential as proof and ask what the relationship can actually sustain",
    change: "one option is tested in reality instead of compared endlessly in your head",
    wellbeing: "you treat your capacity as a real boundary rather than something to negotiate away",
    general: "one observable fact becomes more important than the story built around it",
  }[subject];
}

export function turningPointNarration(
  answer: ResolvedCard,
  resolved: readonly ResolvedCard[],
  frame: QuestionFrame,
  trait: string | undefined,
): string {
  const pressure =
    resolved.find(
      (entry) =>
        entry.position.id !== answer.position.id &&
        /challenge|obstacle|cross|pressure/i.test(
          `${entry.position.id} ${entry.position.displayName}`,
        ),
    ) ??
    resolved.find(
      (entry) => entry.position.id !== answer.position.id && entry.orientation === "reversed",
    ) ??
    resolved.find((entry) => entry.position.id !== answer.position.id);
  const personal = naturalTrait(trait);
  if (!pressure) {
    return `The turn comes when ${turningAction(frame.subject)}; until then, hold the answer loosely.`;
  }
  const personalLine = personal
    ? `You may feel that sharply because ${personal}.`
    : "That tension shows where your choice can interrupt the pattern.";
  return `${namedCard(pressure, true)} pulls toward ${meaning(pressure)}, while ${namedCard(answer)} points to ${meaning(answer)}. ${personalLine} The turn comes when ${turningAction(frame.subject)}.`;
}

function subjectTrajectory(frame: QuestionFrame, upright: boolean): string {
  if (frame.subject === "work")
    return upright
      ? "the work becoming more defined, visible, and possible to evaluate on its actual terms"
      : "the work staying hard to steer until expectations, authority, or resources are restructured";
  if (frame.subject === "relationship")
    return upright
      ? "the connection becoming clearer through reciprocity and honest follow-through"
      : "the relationship remaining uncertain until behavior and stated intentions stop contradicting each other";
  if (frame.subject === "change")
    return upright
      ? "one path becoming concrete enough to choose without total certainty"
      : "the decision pausing until the missing support or information is addressed";
  if (frame.subject === "wellbeing")
    return upright
      ? "a steadier rhythm that gives you more room to respond"
      : "continued strain until the current pattern is adjusted rather than endured";
  return upright
    ? "the situation becoming clearer through a visible next step"
    : "the situation remaining unsettled until what is being avoided is dealt with directly";
}

export function likelyNarration(
  answer: ResolvedCard,
  frame: QuestionFrame,
  guarded: boolean,
): string {
  if (guarded)
    return `The useful movement is toward ${meaning(answer)}, while the factual outcome must come from evidence or qualified advice.`;
  const firstSign = {
    work: "a change in responsibility, timing, or what is formally offered",
    relationship: "a change in consistency, reciprocity, or what is finally said plainly",
    change: "one option acquiring a real deadline, resource, or next step",
    wellbeing: "your energy responding to a boundary or routine that actually changes",
    general: "one observable action making the direction easier to read",
  }[frame.subject];
  const horizon =
    frame.horizonLead === "As this develops" ? "" : ` ${lowerFirst(frame.horizonLead)},`;
  return `If the pattern holds,${horizon} watch for ${firstSign}. That points toward ${subjectTrajectory(frame, answer.orientation === "upright")}.`;
}

function alternateAction(subject: QuestionSubject): string {
  return {
    work: "a direct conversation changes the timeline, ownership, compensation, or scope",
    relationship:
      "a boundary or honest conversation produces behavior that is different from the current pattern",
    change: "new information makes one option materially more workable than the others",
    wellbeing: "you change the routine, workload, or boundary that is draining your capacity",
    general: "new evidence or one clear boundary changes what is possible",
  }[subject];
}

export function alternateNarration(
  resolved: readonly ResolvedCard[],
  frame: QuestionFrame,
  guarded: boolean,
): string {
  const lever =
    resolved.find(({ position }) =>
      ["leverage", "horseshoe-action", "relationship-direction", "card-3"].includes(position.id),
    ) ??
    resolved.find((entry) => entry.orientation === "upright") ??
    resolved.at(-1)!;
  const scope = guarded
    ? "That change still needs to come from direct evidence or qualified support, not from another draw."
    : `If that happens, ${frame.focus} moves off its current line and gives you a different basis for choice.`;
  return `There is another route if ${alternateAction(frame.subject)}. ${namedCard(lever, true)} points to ${meaning(lever)}. ${scope}`;
}

export function agencySteps(
  frame: QuestionFrame,
  answer: ResolvedCard,
  traits: readonly string[],
  guarded: boolean,
): string[] {
  if (guarded)
    return [
      "Separate what you know from what you fear, hope, or assume",
      "Take the factual question to direct evidence or the appropriate qualified professional",
      "Use this reading only to clarify your response, boundaries, and next conversation",
    ];
  const subjectSteps: Record<QuestionSubject, readonly [string, string]> = {
    work: [
      "Ask for one concrete fact about ownership, timing, compensation, workload, or expectations",
      "Judge the situation by follow-through rather than reassurance",
    ],
    relationship: [
      "Name the behavior or conversation you need instead of asking yourself to decode silence",
      "Let reciprocity and consistency determine how much more energy you invest",
    ],
    change: [
      "Test the most workable option with one reversible step",
      "Set a decision point based on new information rather than mounting pressure",
    ],
    wellbeing: [
      "Change one demand, routine, or boundary that is draining your capacity",
      "Measure the result by whether your energy becomes steadier, not by whether you can push harder",
    ],
    general: [
      "Identify the next fact or conversation that would make the situation less abstract",
      "Take one proportionate action and leave yourself room to revise it",
    ],
  };
  const steps = [...subjectSteps[frame.subject]];
  if (answer.orientation === "reversed")
    steps.push("Correct the weak structure before making a larger commitment");
  const personal = naturalTrait(traits[0]);
  if (personal)
    steps.push(`Notice when ${personal}, then choose from the evidence in front of you`);
  return steps;
}

/**
 * The "Your move" section body. The section heading already says "Your move",
 * so the body starts directly with the first step instead of repeating it.
 */
export function agencyNarration(steps: readonly string[]): string {
  const [first, second, third] = steps;
  return `${capitalize(first ?? "Name what you can verify")}; then ${lowerFirst(second ?? "take one proportionate step")}.${third ? ` Also, ${lowerFirst(third)}.` : ""}`;
}

/** Strips the legacy "Your move:" prefix persisted by earlier fallback versions. */
export function withoutAgencyPrefix(text: string): string {
  return capitalize(text.replace(/^\s*your move:\s*/i, ""));
}

/** A closing step for a follow-up that does not repeat the original reading's wording. */
export function followUpAction(frame: QuestionFrame): string {
  return {
    work: "For now, pick the one fact about ownership or timing you most need, and ask for it directly.",
    relationship:
      "For now, name one behavior you would need to see, and watch for it rather than for reassurance.",
    change:
      "For now, choose one small, reversible step that would test the option you are leaning toward.",
    wellbeing: "For now, ease one demand on your energy and notice how you respond.",
    general: "For now, look for the one fact or conversation that would make this less abstract.",
  }[frame.subject];
}

export const FALLBACK_CLOSING_NOTE =
  "Nothing here is fixed — what you notice and choose next can shift it.";

export function reflectionQuestion(frame: QuestionFrame, answer: ResolvedCard): string {
  const questions: Record<QuestionSubject, string> = {
    work: `What concrete evidence would show you that ${frame.focus} has enough structure to trust?`,
    relationship:
      "What would you need to see in behavior—not just possibility—to feel that this connection is meeting you honestly?",
    change:
      "Which option becomes clearer when you ask what is workable now, not what would be perfect eventually?",
    wellbeing: "What is your current capacity asking you to stop treating as endlessly negotiable?",
    general: `What would change if you treated ${meaning(answer)} as something to verify rather than predict?`,
  };
  return questions[frame.subject];
}

export function trajectoryConditions(
  answer: ResolvedCard,
  resolved: readonly ResolvedCard[],
  frame: QuestionFrame,
): string[] {
  const pressure = resolved.find((entry) => entry.orientation === "reversed");
  return [
    `The present pattern around ${frame.focus} continues without a major change`,
    `${namedCard(answer, true)} remains the strongest answer-bearing influence in the spread`,
    ...(pressure && pressure.position.id !== answer.position.id
      ? [`The tension shown by ${namedCard(pressure)} is not directly addressed`]
      : []),
    "No new evidence materially changes what is known",
  ];
}

export function disconfirmingEvidence(frame: QuestionFrame, answer: ResolvedCard): string[] {
  const bySubject: Record<QuestionSubject, readonly [string, string]> = {
    work: [
      "A written offer, changed deadline, or explicit responsibility that resolves the current ambiguity",
      "Consistent follow-through that contradicts the pattern of delay or unclear ownership",
    ],
    relationship: [
      "A sustained change in observable behavior rather than a single reassuring conversation",
      "A clearly stated boundary or intention that changes how the connection actually functions",
    ],
    change: [
      "New information that makes one option materially safer or more workable",
      "A practical constraint disappearing or a new one emerging",
    ],
    wellbeing: [
      "A measurable improvement or decline after changing one routine, demand, or boundary",
      "Qualified guidance that changes what a safe next step looks like",
    ],
    general: [
      "Someone involved acting consistently differently from the pattern described here",
      "New evidence changing the assumptions the reading currently rests on",
    ],
  };
  return [
    ...bySubject[frame.subject],
    `Real-world movement that contradicts the direction suggested by ${namedCard(answer)}`,
  ];
}
