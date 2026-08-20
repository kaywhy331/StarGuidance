import type {
  Spread,
  SpreadContextPosition,
  SpreadContextTemplate,
  SpreadPosition,
  Suit,
  TarotCard,
} from "@starguidance/tarot-domain";

export { renderTarotFaceSvg, renderTarotFaceSvgV3 } from "./artwork";

export const TAROT_CONTENT_VERSION = "starguidance-original-v1" as const;
export const TAROT_ARTWORK_VERSION = "starguidance-celestial-gothic-v3" as const;
export const DECK_VERSION = "starguidance-illustrated-v3" as const;

const BACK_ASSET = "/art/tarot/v2/celestial-gothic-back-v1.webp";
const BACK_ASSET_AVIF = "/art/tarot/v2/celestial-gothic-back-v1.avif";

function artwork(id: string, name: string) {
  return {
    artworkId: `${TAROT_ARTWORK_VERSION}:${id}`,
    frontAsset: `/art/tarot/v3/${id}.svg`,
    backAsset: BACK_ASSET,
    backAssetAvif: BACK_ASSET_AVIF,
    altText: `Original celestial Gothic illustration for ${name}`,
    artistCredit: "StarGuidance Studio",
    license: "Original project artwork; project use authorized, redistribution not granted",
    source: "In-house deterministic narrative vector illustration system",
    provenance:
      "Card face composed from original procedural SVG geometry with a unique constellation and landscape; shared card back generated for StarGuidance with OpenAI image generation and locally optimized",
    focalPoint: { x: 0.5, y: 0.44 },
    crop: "center" as const,
    artworkVersion: TAROT_ARTWORK_VERSION,
  };
}

const majorNames = [
  "The Fool",
  "The Magician",
  "The High Priestess",
  "The Empress",
  "The Emperor",
  "The Hierophant",
  "The Lovers",
  "The Chariot",
  "Strength",
  "The Hermit",
  "Wheel of Fortune",
  "Justice",
  "The Hanged One",
  "Death",
  "Temperance",
  "The Devil",
  "The Tower",
  "The Star",
  "The Moon",
  "The Sun",
  "Judgement",
  "The World",
] as const;
const majorThemes = [
  "a willing beginning",
  "focused capability",
  "quiet inner knowing",
  "creative nourishment",
  "clear structure",
  "shared tradition",
  "values-aligned choice",
  "directed momentum",
  "courage with gentleness",
  "intentional solitude",
  "changing conditions",
  "accountable balance",
  "a changed perspective",
  "necessary transition",
  "patient integration",
  "examining attachment",
  "disruptive truth",
  "renewed orientation",
  "moving through uncertainty",
  "clarity and vitality",
  "an honest reckoning",
  "completion and integration",
] as const;

const suits: readonly { suit: Suit; noun: string; domain: string; shadow: string }[] = [
  {
    suit: "wands",
    noun: "Wands",
    domain: "initiative and creative energy",
    shadow: "scattered or depleted effort",
  },
  {
    suit: "cups",
    noun: "Cups",
    domain: "emotion and relationship",
    shadow: "avoidance or emotional overflow",
  },
  {
    suit: "swords",
    noun: "Swords",
    domain: "thought, truth, and communication",
    shadow: "conflict or overanalysis",
  },
  {
    suit: "pentacles",
    noun: "Pentacles",
    domain: "resources, work, and the material world",
    shadow: "stagnation or scarcity focus",
  },
];
const ranks = [
  "Ace",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Page",
  "Knight",
  "Queen",
  "King",
] as const;
const rankThemes = [
  "an opening",
  "a choice in motion",
  "collaboration",
  "stability",
  "friction",
  "exchange",
  "assessment",
  "focused movement",
  "near completion",
  "a full cycle",
  "curious learning",
  "active pursuit",
  "mature stewardship",
  "responsible direction",
] as const;

const majors: TarotCard[] = majorNames.map((name, index) => ({
  id: `major-${String(index).padStart(2, "0")}`,
  name,
  arcana: "major",
  suit: null,
  rank: String(index),
  uprightThemes: [majorThemes[index] as string, "conscious participation"],
  reversedThemes: [`a blocked or internalized form of ${majorThemes[index]}`, "a need to reassess"],
  eventTags: index === 0 ? ["initiation"] : index === 21 ? ["completion"] : ["decision"],
  reflectivePrompt: `Where is ${majorThemes[index]} asking for your conscious participation?`,
  contentVersion: TAROT_CONTENT_VERSION,
  attribution: "Original StarGuidance editorial content",
  artwork: artwork(`major-${String(index).padStart(2, "0")}`, name),
}));

const minors: TarotCard[] = suits.flatMap(({ suit, noun, domain, shadow }) =>
  ranks.map((rank, index) => ({
    id: `${suit}-${rank.toLowerCase()}`,
    name: `${rank} of ${noun}`,
    arcana: "minor" as const,
    suit,
    rank,
    uprightThemes: [rankThemes[index] as string, domain],
    reversedThemes: [`${rankThemes[index]}, delayed or turned inward`, shadow],
    eventTags:
      index === 0
        ? ["initiation"]
        : index >= 10
          ? ["message"]
          : index === 9
            ? ["completion"]
            : ["development"],
    reflectivePrompt: `How could ${rankThemes[index]} change your relationship with ${domain}?`,
    contentVersion: TAROT_CONTENT_VERSION,
    attribution: "Original StarGuidance editorial content",
    artwork: artwork(`${suit}-${rank.toLowerCase()}`, `${rank} of ${noun}`),
  })),
);

export const tarotCards: readonly TarotCard[] = Object.freeze([...majors, ...minors]);

/**
 * What each slot in a spread actually does interpretively.
 *
 * A position is not decoration: the same card means something different in
 * "Challenge" than in "Direction", and a reading that ignores the slot reduces
 * every spread to a bag of cards. The interpretive function is what lets a
 * reading say why this card, here, in answer to this question.
 */
const positionMeanings: Record<string, { readonly fn: string; readonly description: string }> = {
  "card-1": {
    fn: "the concentrated center of the reading",
    description: "The primary energy or root variable, before secondary influences are added.",
  },
  "card-2": {
    fn: "the second movement in the spread",
    description: "A related influence whose exact role is set by the chosen reading context.",
  },
  "card-3": {
    fn: "the third movement in the spread",
    description: "The integrating or forward-facing influence in the chosen reading context.",
  },
  "celtic-present": {
    fn: "the present center of the situation",
    description: "The conditions surrounding the user and the central theme of the inquiry.",
  },
  "celtic-challenge": {
    fn: "what crosses or complicates the present",
    description: "The immediate obstacle, resistance, or opposing force acting on the core.",
  },
  "celtic-crown": {
    fn: "what the conscious mind is reaching toward",
    description: "The stated goal, highest ideal, or best outcome the user can currently imagine.",
  },
  "celtic-root": {
    fn: "what lies underneath the visible situation",
    description:
      "The subconscious foundation, inherited pattern, or older influence beneath events.",
  },
  "celtic-past": {
    fn: "what is beginning to recede",
    description:
      "Recent events, choices, or energies that still matter but are moving into the past.",
  },
  "celtic-near-future": {
    fn: "what is likely to become visible next",
    description: "The incoming shift or immediate next stage if current conditions continue.",
  },
  "celtic-self": {
    fn: "the user's posture within the situation",
    description: "Their current attitude, self-conception, and way of meeting what is happening.",
  },
  "celtic-environment": {
    fn: "what the surrounding world contributes",
    description:
      "Observable external forces, social context, and circumstances outside direct control.",
  },
  "celtic-hopes-fears": {
    fn: "where hope and anxiety are entangled",
    description: "Expectations and fears that may color how the possible outcome is perceived.",
  },
  "celtic-outcome": {
    fn: "where the whole pattern tends under current conditions",
    description: "A conditional longer outcome, never a guaranteed destination.",
  },
  "horseshoe-past": {
    fn: "the history shaping this moment",
    description: "Root factors and past influences still feeding the present situation.",
  },
  "horseshoe-present": {
    fn: "what is active now",
    description: "Current conditions, immediate energies, and choices already in play.",
  },
  "horseshoe-hidden": {
    fn: "what has not fully entered view",
    description: "An unseen variable, unexpected factor, or subconscious undercurrent.",
  },
  "horseshoe-obstacle": {
    fn: "what must be worked through",
    description: "The central block or practical difficulty that cannot simply be bypassed.",
  },
  "horseshoe-environment": {
    fn: "what the external environment contributes",
    description: "Other people's observable behavior and circumstances outside the user's control.",
  },
  "horseshoe-action": {
    fn: "the most useful course of action",
    description: "A tactical approach that preserves choice rather than promising an outcome.",
  },
  "horseshoe-outcome": {
    fn: "the likely resolution of the present pattern",
    description: "The direction events tend if the current trajectory and choices hold.",
  },
  "relationship-a-conscious": {
    fn: "the user's conscious stance toward the connection",
    description: "What the user knows they are thinking, seeking, or deciding in the relationship.",
  },
  "relationship-b-conscious": {
    fn: "the other person's visible stance",
    description:
      "Observable signals and behavior, held with uncertainty rather than claimed as private thought.",
  },
  "relationship-a-deeper": {
    fn: "the user's less visible desire or fear",
    description: "A deeper pattern the user may be carrying beneath their conscious position.",
  },
  "relationship-b-deeper": {
    fn: "what may sit beneath the other person's visible behavior",
    description:
      "A possibility to compare with evidence, never a declaration of another person's inner life.",
  },
  "relationship-present": {
    fn: "the current state of the connection",
    description: "The immediate dynamic, tone, or central challenge shared between both parties.",
  },
  "relationship-shared": {
    fn: "what binds or repeatedly moves between both people",
    description: "The mutual pattern, exchange, or tension sustaining the connection.",
  },
  "relationship-direction": {
    fn: "where the connection may go and what remains actionable",
    description:
      "A conditional path grounded in communication, boundaries, evidence, and the user's choices.",
  },
  "matrix-past-internal": {
    fn: "the inner history behind the situation",
    description: "Old mindsets, emotional history, and subjective patterns carried from the past.",
  },
  "matrix-past-external": {
    fn: "the material history behind the situation",
    description:
      "Past actions, circumstances, and environments that established present conditions.",
  },
  "matrix-past-integration": {
    fn: "what the past was trying to teach or complete",
    description: "The useful synthesis or unfinished lesson left by the prior cycle.",
  },
  "matrix-present-internal": {
    fn: "the user's current inner reality",
    description:
      "The mindset, emotional filter, and immediate subjective experience operating now.",
  },
  "matrix-present-external": {
    fn: "the situation as it materially stands",
    description: "Current circumstances, observable dynamics, resources, and constraints.",
  },
  "matrix-present-integration": {
    fn: "where present choice can integrate the situation",
    description:
      "An active opportunity, decision point, or practical bridge in the current moment.",
  },
  "matrix-future-internal": {
    fn: "the inner shift developing next",
    description:
      "A likely realization, change in attitude, or emotional movement if the pattern continues.",
  },
  "matrix-future-external": {
    fn: "what may manifest in the surrounding world",
    description:
      "A plausible real-world development or environmental change under current conditions.",
  },
  "matrix-future-integration": {
    fn: "where the full matrix tends to resolve",
    description:
      "The conditional synthesis of inner movement, external reality, and the choices between them.",
  },
  focus: {
    fn: "what most wants your attention right now",
    description: "The single thing the reading places in front of you today.",
  },
  situation: {
    fn: "the conditions you are actually standing in",
    description: "Where matters currently stand, before interpretation or hope is added.",
  },
  challenge: {
    fn: "what resists or complicates the situation",
    description: "The friction that has to be worked with rather than wished away.",
  },
  direction: {
    fn: "where the pattern points under current conditions",
    description: "The way this tends to move if nothing meaningful changes.",
  },
  "current-path": {
    fn: "the road you are already walking",
    description: "The trajectory already in motion before any new choice.",
  },
  "hidden-influence": {
    fn: "what is shaping this from outside your view",
    description: "A factor at work that is not yet obvious from where you stand.",
  },
  "path-a": {
    fn: "what the first option opens and costs",
    description: "One branch of the choice, taken on its own terms.",
  },
  "path-b": {
    fn: "what the second option opens and costs",
    description: "The other branch, taken on its own terms.",
  },
  leverage: {
    fn: "where your effort changes the most",
    description: "The point at which a small deliberate action has disproportionate effect.",
  },
  foundation: {
    fn: "what this is built on",
    description: "The history and conditions the present rests upon.",
  },
  present: {
    fn: "what is live right now",
    description: "The active center of the situation as it stands.",
  },
  incoming: {
    fn: "what is arriving next",
    description: "An influence moving toward the situation rather than already in it.",
  },
  obstacle: {
    fn: "what stands in the way",
    description: "The specific difficulty this reading asks you to account for.",
  },
  external: {
    fn: "what others and circumstance contribute",
    description: "The part of this that is not yours to control.",
  },
  outcome: {
    fn: "where this tends if the present continues",
    description: "A conditional trajectory, not a fixed result.",
  },
};

function position(
  id: string,
  displayName: string,
  order: number,
  column: number,
  row: number,
  rotation = 0,
  layer = 0,
): SpreadPosition {
  const meaning = positionMeanings[id];
  if (!meaning) throw new Error(`Spread position ${id} has no interpretive function`);
  return {
    id,
    displayName,
    interpretiveFunction: meaning.fn,
    description: meaning.description,
    order,
    placement: { column, row, rotation, layer },
  };
}

function contextPosition(
  positionId: string,
  displayName: string,
  interpretiveFunction: string,
  description: string,
): SpreadContextPosition {
  return { positionId, displayName, interpretiveFunction, description };
}

function contextTemplate(
  id: string,
  name: string,
  positions: readonly SpreadContextPosition[],
): SpreadContextTemplate {
  return { id, name, positions };
}

const oneCardContexts: readonly SpreadContextTemplate[] = [
  contextTemplate("daily-pull", "Daily pull", [
    contextPosition(
      "card-1",
      "Theme of the Day",
      "the overarching energy for the next twenty-four hours",
      "The primary focus or foundational attitude most useful to notice today.",
    ),
  ]),
  contextTemplate("binary-inquiry", "Yes / no pivot", [
    contextPosition(
      "card-1",
      "Yes / No Pivot",
      "the question's qualitative openness or resistance",
      "Upright energy suggests openness or actionability; reversed energy suggests obstruction or pause. It is not a guaranteed yes or no.",
    ),
  ]),
  contextTemplate("meditation-anchor", "Meditation anchor", [
    contextPosition(
      "card-1",
      "Mindfulness Focus",
      "the psychological pattern most useful to observe",
      "An archetype, reaction, or shadow element to notice and integrate without judgment.",
    ),
  ]),
  contextTemplate("situational-nexus", "Situational nexus", [
    contextPosition(
      "card-1",
      "Core Essence",
      "the root variable beneath the surrounding noise",
      "The concentrated center of a more complex situation.",
    ),
  ]),
];

const threeCardContexts: readonly SpreadContextTemplate[] = [
  contextTemplate("chronological", "Past, present, future", [
    contextPosition(
      "card-1",
      "Past",
      "what established the present",
      "Foundational factors, previous events, or root causes.",
    ),
    contextPosition(
      "card-2",
      "Present",
      "what is active right now",
      "The current status, immediate focus, or energy already in motion.",
    ),
    contextPosition(
      "card-3",
      "Future",
      "what is likely to develop next",
      "A projected shift or next stage if current conditions continue.",
    ),
  ]),
  contextTemplate("decision-making", "Two paths and a pivot", [
    contextPosition(
      "card-1",
      "Option A",
      "what the first choice opens and costs",
      "The path, risks, and possible benefits of the first option.",
    ),
    contextPosition(
      "card-2",
      "Option B",
      "what the second choice opens and costs",
      "The path, risks, and possible benefits of the second option.",
    ),
    contextPosition(
      "card-3",
      "Decision Pivot",
      "what most helps the user choose",
      "The factor, evidence, or value that can clarify the decision.",
    ),
  ]),
  contextTemplate("situational-anatomy", "Problem, cause, resolution", [
    contextPosition(
      "card-1",
      "The Problem",
      "the visible conflict or blockage",
      "The central issue as it currently appears.",
    ),
    contextPosition(
      "card-2",
      "The Cause",
      "what may be driving the issue beneath the surface",
      "A hidden catalyst, internal driver, or less obvious variable.",
    ),
    contextPosition(
      "card-3",
      "The Resolution",
      "the most useful way through",
      "A practical resolution path or recommended action, not a guaranteed result.",
    ),
  ]),
  contextTemplate("psychological-alignment", "Mind, body, spirit", [
    contextPosition(
      "card-1",
      "Mind",
      "the conscious mental stance",
      "Thoughts, assumptions, and intellectual focus.",
    ),
    contextPosition(
      "card-2",
      "Body",
      "the material and embodied reality",
      "Actions, energy, practical constraints, and physical circumstances without medical claims.",
    ),
    contextPosition(
      "card-3",
      "Spirit",
      "the deeper emotional or meaning-making current",
      "Subconscious drivers, values, and the felt purpose beneath the situation.",
    ),
  ]),
];

/** The six rituals available for new readings. */
export const spreads: readonly Spread[] = [
  {
    id: "one-card",
    name: "One-Card Spread",
    purpose:
      "Quick, direct guidance for a daily theme, focused pivot, or the heart of a situation.",
    estimatedMinutes: 3,
    entitlementClass: "standard",
    version: "one-card-v2",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 1, rows: 1, kind: "centered" },
    contextTemplates: oneCardContexts,
    positions: [position("card-1", "Core Focus", 0, 0, 0)],
  },
  {
    id: "three-card",
    name: "Three-Card Spread",
    purpose:
      "A versatile three-part reading shaped around time, a decision, a situation, or inner alignment.",
    estimatedMinutes: 7,
    entitlementClass: "standard",
    version: "three-card-v2",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 3, rows: 1, kind: "horizontal" },
    contextTemplates: threeCardContexts,
    positions: [
      position("card-1", "First Movement", 0, 0, 0),
      position("card-2", "Center Pivot", 1, 1, 0),
      position("card-3", "Third Movement", 2, 2, 0),
    ],
  },
  {
    id: "celtic-cross",
    name: "Celtic Cross",
    purpose:
      "An in-depth view of a complex situation, its inner blocks, outside influences, and conditional outcome.",
    estimatedMinutes: 25,
    entitlementClass: "standard",
    version: "celtic-cross-v2",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 5, rows: 4, kind: "celtic-cross" },
    positions: [
      position("celtic-present", "The Present", 0, 2, 1, 0, 0),
      position("celtic-challenge", "The Challenge", 1, 2, 1, 90, 1),
      position("celtic-crown", "The Crown", 2, 2, 0),
      position("celtic-root", "The Root", 3, 2, 2),
      position("celtic-past", "The Recent Past", 4, 1, 1),
      position("celtic-near-future", "The Near Future", 5, 3, 1),
      position("celtic-self", "The Self", 6, 4, 3),
      position("celtic-environment", "The Environment", 7, 4, 2),
      position("celtic-hopes-fears", "Hopes and Fears", 8, 4, 1),
      position("celtic-outcome", "The Outcome", 9, 4, 0),
    ],
  },
  {
    id: "horseshoe",
    name: "Horseshoe Spread",
    purpose:
      "Trace hidden influences, obstacles, outside conditions, useful action, and the likely trajectory of an event.",
    estimatedMinutes: 18,
    entitlementClass: "standard",
    version: "horseshoe-v2",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 5, rows: 5, kind: "horseshoe" },
    positions: [
      position("horseshoe-past", "The Past", 0, 0, 0),
      position("horseshoe-present", "The Present", 1, 1, 1),
      position("horseshoe-hidden", "Hidden Influences", 2, 2, 2),
      position("horseshoe-obstacle", "The Obstacle", 3, 2, 3),
      position("horseshoe-environment", "External Environment", 4, 2, 4),
      position("horseshoe-action", "Best Course of Action", 5, 3, 1),
      position("horseshoe-outcome", "Final Outcome", 6, 4, 0),
    ],
  },
  {
    id: "relationship",
    name: "Relationship / Two-Party Spread",
    purpose:
      "Explore two people's observable dynamic, individual patterns, shared energy, and the connection's possible direction.",
    estimatedMinutes: 18,
    entitlementClass: "standard",
    version: "relationship-v2",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 3, rows: 3, kind: "relationship" },
    positions: [
      position("relationship-a-conscious", "Your Conscious Stance", 0, 0, 0),
      position("relationship-b-conscious", "Their Visible Stance", 1, 2, 0),
      position("relationship-a-deeper", "Your Deeper Pattern", 2, 0, 1),
      position("relationship-b-deeper", "What Their Signals May Suggest", 3, 2, 1),
      position("relationship-present", "The Connection Now", 4, 1, 0),
      position("relationship-shared", "The Shared Dynamic", 5, 1, 1),
      position("relationship-direction", "The Possible Direction", 6, 1, 2),
    ],
  },
  {
    id: "nine-card-matrix",
    name: "Nine-Card Matrix Spread",
    purpose:
      "Map past, present, and future across inner reality, external circumstances, and integration.",
    estimatedMinutes: 22,
    entitlementClass: "standard",
    version: "nine-card-matrix-v2",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 3, rows: 3, kind: "matrix" },
    positions: [
      position("matrix-past-internal", "Past · Internal", 0, 0, 0),
      position("matrix-past-external", "Past · External", 1, 1, 0),
      position("matrix-past-integration", "Past · Integration", 2, 2, 0),
      position("matrix-present-internal", "Present · Internal", 3, 0, 1),
      position("matrix-present-external", "Present · External", 4, 1, 1),
      position("matrix-present-integration", "Present · Integration", 5, 2, 1),
      position("matrix-future-internal", "Future · Internal", 6, 0, 2),
      position("matrix-future-external", "Future · External", 7, 1, 2),
      position("matrix-future-integration", "Future · Integration", 8, 2, 2),
    ],
  },
];

/** Retired definitions retained only so historical locked draws remain resolvable. */
export const legacySpreads: readonly Spread[] = [
  {
    id: "focus",
    name: "Single Card — Focus",
    purpose: "A concise reflection on what deserves your attention now.",
    estimatedMinutes: 3,
    entitlementClass: "standard",
    version: "focus-v1",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 1, rows: 1, kind: "legacy" },
    positions: [position("focus", "Current Focus", 0, 0, 0)],
  },
  {
    id: "direction",
    name: "Three Cards — Direction",
    purpose: "See the present situation, its central challenge, and a possible direction.",
    estimatedMinutes: 7,
    entitlementClass: "standard",
    version: "direction-v1",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 3, rows: 1, kind: "legacy" },
    positions: [
      position("situation", "Situation", 0, 0, 0),
      position("challenge", "Challenge", 1, 1, 0),
      position("direction", "Direction", 2, 2, 0),
    ],
  },
  {
    id: "crossroads",
    name: "Five Cards — Crossroads",
    purpose: "Compare two paths, the influences around them, and the leverage you retain.",
    estimatedMinutes: 12,
    entitlementClass: "standard",
    version: "crossroads-v1",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 3, rows: 3, kind: "legacy" },
    positions: [
      position("current-path", "Current Path", 0, 1, 2),
      position("hidden-influence", "Hidden Influence", 1, 1, 0),
      position("path-a", "Path A", 2, 0, 1),
      position("path-b", "Path B", 3, 2, 1),
      position("leverage", "Leverage", 4, 1, 1),
    ],
  },
  {
    id: "outlook",
    name: "Seven Cards — Deeper Outlook",
    purpose: "Explore a layered situation, its pressures, and a conditional longer view.",
    estimatedMinutes: 18,
    entitlementClass: "standard",
    version: "outlook-v1",
    allowReversals: true,
    optionalCut: true,
    layout: { columns: 3, rows: 3, kind: "legacy" },
    positions: [
      position("foundation", "Foundation", 0, 0, 2),
      position("present", "Present", 1, 1, 2),
      position("incoming", "Incoming Influence", 2, 2, 2),
      position("obstacle", "Obstacle", 3, 0, 1),
      position("external", "External Factor", 4, 2, 1),
      position("leverage", "Leverage", 5, 0, 0),
      position("outcome", "Likely Outcome", 6, 2, 0),
    ],
  },
];

export const allSpreads: readonly Spread[] = [...spreads, ...legacySpreads];

export function findSpread(id: string): Spread | undefined {
  return allSpreads.find((spread) => spread.id === id);
}

export interface SpreadReadingContext {
  readonly topic: string;
  readonly intent: string;
  readonly generalReading: boolean;
}

export function selectSpreadContextTemplate(
  spread: Spread,
  context: SpreadReadingContext,
): SpreadContextTemplate | undefined {
  if (!spread.contextTemplates?.length) return undefined;
  const templateId =
    spread.id === "one-card"
      ? context.generalReading
        ? "daily-pull"
        : context.intent === "decisionSupport"
          ? "binary-inquiry"
          : context.topic === "wellbeing" || context.intent === "emotionalProcessing"
            ? "meditation-anchor"
            : "situational-nexus"
      : spread.id === "three-card"
        ? context.intent === "decisionSupport"
          ? "decision-making"
          : context.topic === "wellbeing" || context.intent === "emotionalProcessing"
            ? "psychological-alignment"
            : context.generalReading || context.intent === "planning"
              ? "chronological"
              : "situational-anatomy"
        : spread.contextTemplates[0]?.id;
  return spread.contextTemplates.find(({ id }) => id === templateId);
}

export function resolveSpreadPositions(
  spread: Spread,
  context?: SpreadReadingContext,
): readonly SpreadPosition[] {
  const template = context ? selectSpreadContextTemplate(spread, context) : undefined;
  if (!template) return spread.positions;
  return spread.positions.map((position) => {
    const contextual = template.positions.find(({ positionId }) => positionId === position.id);
    return contextual
      ? {
          ...position,
          displayName: contextual.displayName,
          interpretiveFunction: contextual.interpretiveFunction,
          description: contextual.description,
        }
      : position;
  });
}
