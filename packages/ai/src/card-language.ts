import type { CardOrientation, TarotCard } from "@starguidance/tarot-domain";

/**
 * Original, spoken-language card interpretations for the credential-free reader.
 *
 * The canonical deck themes remain the provider boundary. These lines exist so
 * the deterministic safety net can translate those compact taxonomy labels
 * into ordinary language instead of exposing phrases such as "a blocked or
 * internalized form of..." to a person in the middle of a reading.
 */
interface SpokenMeaning {
  readonly upright: string;
  readonly reversed: string;
}

const majorMeanings: readonly SpokenMeaning[] = [
  {
    upright: "a genuine opening that asks for curiosity before certainty",
    reversed: "a start that is either being rushed or held back by fear of looking unprepared",
  },
  {
    upright: "having the tools to turn an intention into a real first move",
    reversed: "ability being scattered, underestimated, or used without a clear purpose",
  },
  {
    upright: "important information arriving quietly through observation and instinct",
    reversed: "an inner warning being ignored, or too much being left unspoken to read clearly",
  },
  {
    upright: "steady growth created through care, patience, and enough room to develop",
    reversed: "growth being crowded out by depletion, overgiving, or neglect of your own needs",
  },
  {
    upright: "clear leadership, sound boundaries, and a structure sturdy enough to rely on",
    reversed:
      "authority or structure becoming too rigid, too controlling, or too unreliable to trust",
  },
  {
    upright: "guidance, shared values, or a tested framework offering useful direction",
    reversed: "rules or expectations that no longer fit, even if departing from them feels risky",
  },
  {
    upright: "a choice that becomes clear when actions and values are brought into alignment",
    reversed: "misalignment, mixed commitments, or avoidance of a choice that still has to be made",
  },
  {
    upright: "forward movement becoming possible once competing impulses are given one direction",
    reversed:
      "momentum without enough control, or determination pulling against the wrong obstacle",
  },
  {
    upright: "quiet courage that can hold firm without forcing the situation",
    reversed:
      "confidence running low, making pressure feel like the only available source of strength",
  },
  {
    upright: "a necessary step back that makes a more honest answer possible",
    reversed:
      "solitude turning into avoidance, or reflection continuing after it has stopped revealing anything new",
  },
  {
    upright: "conditions changing in a way that breaks an old pattern open",
    reversed: "the same cycle repeating because its lesson or timing has not been met yet",
  },
  {
    upright: "a fair reckoning based on evidence, accountability, and proportion",
    reversed:
      "an imbalance being minimized, or responsibility being assigned without the whole truth",
  },
  {
    upright: "a pause that changes the view and makes a different response possible",
    reversed: "waiting that has become stuckness, sacrifice, or delay without a clear purpose",
  },
  {
    upright: "an ending that clears the ground for a necessary transformation",
    reversed: "holding onto a finished form because the uncertainty after it feels harder to face",
  },
  {
    upright: "different needs finding a workable rhythm through patience and adjustment",
    reversed: "extremes, poor timing, or competing priorities refusing to settle into balance",
  },
  {
    upright: "an attachment, fear, or bargain becoming visible enough to examine honestly",
    reversed:
      "the beginning of release, provided the old pattern is named instead of quietly repeated",
  },
  {
    upright: "an unstable arrangement breaking open so the truth can no longer be managed around",
    reversed:
      "a necessary disruption being delayed while pressure continues to build underneath it",
  },
  {
    upright: "hope returning in a form that is gentle, realistic, and worth tending",
    reversed:
      "discouragement making renewal difficult to recognize even though it has not disappeared",
  },
  {
    upright:
      "uncertainty that calls for patience, evidence, and respect for what instinct is noticing",
    reversed: "fear or projection beginning to clear, though the full picture is not available yet",
  },
  {
    upright: "clarity, warmth, and visible progress bringing the situation into the open",
    reversed:
      "good potential being muted by delay, self-doubt, or optimism that needs firmer support",
  },
  {
    upright:
      "an honest reckoning that makes a larger calling or second chance impossible to ignore",
    reversed:
      "self-doubt or unfinished accountability making it hard to answer what the moment requires",
  },
  {
    upright: "completion, integration, and the freedom that comes from closing a cycle properly",
    reversed: "unfinished business keeping closure close but not quite available",
  },
];

const minorMeanings: Readonly<Record<string, SpokenMeaning>> = {
  "wands-ace": {
    upright: "a fresh impulse with enough energy to become a real beginning",
    reversed: "a promising spark struggling to find timing, confidence, or a practical outlet",
  },
  "wands-two": {
    upright: "looking beyond the familiar and deciding which possibility deserves commitment",
    reversed: "planning being narrowed by fear, poor preparation, or reluctance to choose",
  },
  "wands-three": {
    upright: "early effort beginning to create room for expansion and longer-range movement",
    reversed: "progress meeting delays, limited foresight, or expectations that need adjusting",
  },
  "wands-four": {
    upright: "a stable milestone worth recognizing and sharing with the people involved",
    reversed: "a foundation that looks settled from outside but still carries tension underneath",
  },
  "wands-five": {
    upright: "competing priorities or personalities testing what is actually worth fighting for",
    reversed:
      "conflict being avoided, internalized, or prolonged because nobody is naming the real issue",
  },
  "wands-six": {
    upright: "visible progress, recognition, or support confirming that the effort is landing",
    reversed:
      "recognition being delayed, unevenly given, or made too dependent on outside approval",
  },
  "wands-seven": {
    upright: "holding your ground when pressure tests a position you have earned",
    reversed: "defensiveness, exhaustion, or self-doubt making every demand feel like a threat",
  },
  "wands-eight": {
    upright: "events, messages, or decisions gathering speed after a slower stretch",
    reversed: "mixed signals, poor timing, or scattered action interrupting the momentum",
  },
  "wands-nine": {
    upright:
      "resilience built through experience, alongside understandable caution about being hurt again",
    reversed: "weariness making old defenses difficult to maintain and harder to justify",
  },
  "wands-ten": {
    upright: "responsibility becoming so heavy that effort alone is no longer a sustainable answer",
    reversed: "a burden beginning to lift, or being denied until the strain becomes unavoidable",
  },
  "wands-page": {
    upright: "curiosity, news, or an experiment inviting you to try before you feel fully ready",
    reversed: "enthusiasm scattering across too many directions without enough follow-through",
  },
  "wands-knight": {
    upright: "bold pursuit and fast movement driven by a strong desire to act",
    reversed: "impulsive movement, inconsistent commitment, or urgency outrunning judgment",
  },
  "wands-queen": {
    upright: "creative confidence that draws others in without asking permission to exist",
    reversed: "confidence being eroded by comparison, resentment, or creative exhaustion",
  },
  "wands-king": {
    upright: "visionary leadership that can turn energy into a direction others understand",
    reversed:
      "forceful leadership, impatience, or a large vision with too little grounded execution",
  },
  "cups-ace": {
    upright: "an emotional opening that makes connection, compassion, or renewal possible",
    reversed:
      "feelings being contained, depleted, or offered where there is not yet room to receive them",
  },
  "cups-two": {
    upright: "mutual recognition and a bond strengthened by honest reciprocity",
    reversed:
      "an imbalance, separation, or mismatch between what is felt and what is being exchanged",
  },
  "cups-three": {
    upright: "support, friendship, and shared joy helping the situation breathe again",
    reversed:
      "social strain, overindulgence, or too many outside voices entering something personal",
  },
  "cups-four": {
    upright: "emotional withdrawal that may be protecting you from seeing an available opening",
    reversed: "interest returning after a period of detachment, with restlessness still close by",
  },
  "cups-five": {
    upright: "grief or disappointment taking up more of the view than what still remains",
    reversed: "acceptance beginning to loosen grief's hold and make repair imaginable",
  },
  "cups-six": {
    upright: "memory, familiarity, or an old bond shaping the present with unusual force",
    reversed: "the past being idealized, outgrown, or carried forward beyond its useful place",
  },
  "cups-seven": {
    upright: "many appealing possibilities making discernment more important than fantasy",
    reversed: "confusion beginning to clear, or overwhelm reducing choice to avoidance",
  },
  "cups-eight": {
    upright:
      "choosing to leave what no longer feels emotionally honest, even before the next destination is clear",
    reversed:
      "fear of leaving, drifting without closure, or returning to what has not actually changed",
  },
  "cups-nine": {
    upright: "satisfaction and a wish drawing close enough to be enjoyed without apology",
    reversed: "an outward success that does not answer the deeper emotional need beneath it",
  },
  "cups-ten": {
    upright: "emotional belonging and a shared future built through mutual care",
    reversed:
      "a picture of harmony that is strained by disconnection, pressure, or unrealistic expectations",
  },
  "cups-page": {
    upright:
      "a tender message, intuitive nudge, or vulnerable beginning asking to be taken seriously",
    reversed: "emotional immaturity, blocked expression, or sensitivity without enough grounding",
  },
  "cups-knight": {
    upright: "an invitation or heartfelt pursuit moving the emotional story forward",
    reversed:
      "idealization, inconsistency, or a beautiful promise without reliable action behind it",
  },
  "cups-queen": {
    upright: "deep emotional intelligence that can listen without losing its own center",
    reversed: "overgiving, emotional overwhelm, or intuition becoming tangled with fear",
  },
  "cups-king": {
    upright: "emotional steadiness that can hold strong feeling without being ruled by it",
    reversed: "suppressed feeling, emotional control, or calmness that hides an unresolved current",
  },
  "swords-ace": {
    upright: "a truth, idea, or decision cutting through what had been difficult to name",
    reversed: "confusion, mixed communication, or a truth that is not yet ready to be acted on",
  },
  "swords-two": {
    upright: "a stalemate maintained because making the choice would change more than one thing",
    reversed: "indecision reaching its limit as information or pressure forces movement",
  },
  "swords-three": {
    upright:
      "painful clarity, grief, or disappointment that needs to be felt rather than explained away",
    reversed: "healing beginning, while some hurt still needs honest acknowledgment",
  },
  "swords-four": {
    upright: "rest and mental distance becoming necessary before another decision is made",
    reversed: "restlessness, burnout, or returning to action before recovery is complete",
  },
  "swords-five": {
    upright: "a conflict whose cost may matter more than the satisfaction of winning it",
    reversed: "an opening for repair, or resentment continuing after the argument has ended",
  },
  "swords-six": {
    upright: "a difficult but meaningful transition away from mental or situational turbulence",
    reversed: "unfinished baggage or resistance making it hard to leave an old difficulty behind",
  },
  "swords-seven": {
    upright:
      "strategy, selective disclosure, or avoidance requiring a closer look at what is not being said",
    reversed: "a hidden truth surfacing, or self-deception becoming harder to maintain",
  },
  "swords-eight": {
    upright: "fear and assumptions narrowing the options more than the facts themselves do",
    reversed: "a limiting story loosening enough for choice and perspective to return",
  },
  "swords-nine": {
    upright: "anxiety magnifying the future in the hours when evidence is hardest to hold onto",
    reversed: "fear being faced and named, or distress becoming too heavy to carry alone",
  },
  "swords-ten": {
    upright: "a painful ending reaching the point where denial can no longer extend it",
    reversed:
      "recovery beginning slowly, or an ending being resisted after its direction is already clear",
  },
  "swords-page": {
    upright: "alert curiosity, direct questions, or new information changing the conversation",
    reversed: "rumor, defensiveness, or scattered thinking making clear communication difficult",
  },
  "swords-knight": {
    upright: "decisive action and direct speech cutting quickly toward the objective",
    reversed:
      "reckless words, aggression, or speed creating consequences judgment did not account for",
  },
  "swords-queen": {
    upright: "clear discernment and firm boundaries shaped by hard-earned experience",
    reversed:
      "hurt sharpening into bitterness, suspicion, or judgment that leaves little room for context",
  },
  "swords-king": {
    upright: "reasoned authority, strategy, and a decision grounded in principle rather than mood",
    reversed:
      "rigid thinking, misuse of authority, or intelligence being used to control the frame",
  },
  "pentacles-ace": {
    upright: "a tangible opening with the potential to become stable through practical care",
    reversed: "a material opportunity delayed, missed, or weakened by an insecure foundation",
  },
  "pentacles-two": {
    upright:
      "adaptability keeping several real demands in motion without pretending they are weightless",
    reversed:
      "overload, poor prioritization, or too many moving parts becoming difficult to sustain",
  },
  "pentacles-three": {
    upright:
      "skill, collaboration, and visible workmanship building something stronger than solo effort could",
    reversed: "uneven standards, weak teamwork, or expertise not being respected where it matters",
  },
  "pentacles-four": {
    upright: "a strong need to protect security, resources, or control over what has been built",
    reversed: "scarcity fear tightening its grip, or a guarded hold beginning to loosen",
  },
  "pentacles-five": {
    upright: "hardship, exclusion, or insecurity making available support difficult to recognize",
    reversed: "recovery and practical help beginning to appear after a difficult stretch",
  },
  "pentacles-six": {
    upright: "giving and receiving coming into a fairer, more transparent exchange",
    reversed:
      "support carrying strings, power becoming uneven, or effort not being returned in kind",
  },
  "pentacles-seven": {
    upright:
      "a serious assessment of whether continued investment will produce the return it needs to",
    reversed:
      "impatience, poor return, or effort continuing because stopping would be hard to admit",
  },
  "pentacles-eight": {
    upright: "patient skill-building and consistent work creating dependable progress",
    reversed: "perfectionism, repetition, or cut corners draining meaning from the work",
  },
  "pentacles-nine": {
    upright: "earned independence and the confidence that comes from standing on your own work",
    reversed:
      "security depending too heavily on appearances, approval, or someone else's resources",
  },
  "pentacles-ten": {
    upright:
      "long-term stability, legacy, and resources arranged to support more than the present moment",
    reversed: "a family, financial, or structural foundation that cannot be taken for granted",
  },
  "pentacles-page": {
    upright: "practical learning or useful news offering a modest but credible beginning",
    reversed: "procrastination, weak planning, or a practical lesson not yet being applied",
  },
  "pentacles-knight": {
    upright: "reliable effort and steady pacing doing more than urgency could accomplish",
    reversed: "stagnation, stubborn routine, or duty continuing after purpose has gone missing",
  },
  "pentacles-queen": {
    upright: "grounded care and practical confidence creating safety without losing warmth",
    reversed: "self-neglect, material anxiety, or caretaking that leaves no reserve for you",
  },
  "pentacles-king": {
    upright: "mature stewardship and material leadership capable of building lasting security",
    reversed: "control, status, or fear of loss distorting an otherwise practical decision",
  },
};

function fallbackMeaning(card: TarotCard, orientation: CardOrientation): string {
  const themes = orientation === "upright" ? card.uprightThemes : card.reversedThemes;
  return themes.filter(Boolean).join(" and ");
}

export function spokenCardMeaning(card: TarotCard, orientation: CardOrientation): string {
  const meaning =
    card.arcana === "major"
      ? majorMeanings[Number.parseInt(card.rank, 10)]
      : minorMeanings[card.id];
  return meaning?.[orientation] ?? fallbackMeaning(card, orientation);
}
