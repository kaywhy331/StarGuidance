import type { Spread, SpreadPosition, Suit, TarotCard } from "@starguidance/tarot-domain";

export { renderTarotFaceSvg } from "./artwork";

export const TAROT_CONTENT_VERSION = "starguidance-original-v1" as const;
export const TAROT_ARTWORK_VERSION = "starguidance-celestial-gothic-v2" as const;
export const DECK_VERSION = "starguidance-illustrated-v2" as const;

const BACK_ASSET = "/art/tarot/v2/celestial-gothic-back-v1.webp";
const BACK_ASSET_AVIF = "/art/tarot/v2/celestial-gothic-back-v1.avif";

function artwork(id: string, name: string) {
  return {
    artworkId: `${TAROT_ARTWORK_VERSION}:${id}`,
    frontAsset: `/art/tarot/v2/${id}.svg`,
    backAsset: BACK_ASSET,
    backAssetAvif: BACK_ASSET_AVIF,
    altText: `Original celestial Gothic illustration for ${name}`,
    artistCredit: "StarGuidance Studio",
    license: "Original project artwork; project use authorized, redistribution not granted",
    source: "In-house deterministic vector illustration system",
    provenance:
      "Card face composed from original procedural SVG geometry; shared card back generated for StarGuidance with OpenAI image generation and locally optimized",
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
  x: number,
  y: number,
): SpreadPosition {
  const meaning = positionMeanings[id];
  if (!meaning) throw new Error(`Spread position ${id} has no interpretive function`);
  return {
    id,
    displayName,
    interpretiveFunction: meaning.fn,
    description: meaning.description,
    order,
    placement: { x, y, rotation: 0 },
  };
}

export const spreads: readonly Spread[] = [
  {
    id: "focus",
    name: "Single Card — Focus",
    version: "focus-v1",
    allowReversals: true,
    optionalCut: true,
    positions: [position("focus", "Current Focus", 0, 0, 0)],
  },
  {
    id: "direction",
    name: "Three Cards — Direction",
    version: "direction-v1",
    allowReversals: true,
    optionalCut: true,
    positions: [
      position("situation", "Situation", 0, -1, 0),
      position("challenge", "Challenge", 1, 0, 0),
      position("direction", "Direction", 2, 1, 0),
    ],
  },
  {
    id: "crossroads",
    name: "Five Cards — Crossroads",
    version: "crossroads-v1",
    allowReversals: true,
    optionalCut: true,
    positions: [
      position("current-path", "Current Path", 0, 0, 1),
      position("hidden-influence", "Hidden Influence", 1, 0, -1),
      position("path-a", "Path A", 2, -1, 0),
      position("path-b", "Path B", 3, 1, 0),
      position("leverage", "Leverage", 4, 0, 0),
    ],
  },
  {
    id: "outlook",
    name: "Seven Cards — Deeper Outlook",
    version: "outlook-v1",
    allowReversals: true,
    optionalCut: true,
    positions: [
      position("foundation", "Foundation", 0, -1, 1),
      position("present", "Present", 1, 0, 1),
      position("incoming", "Incoming Influence", 2, 1, 1),
      position("obstacle", "Obstacle", 3, -1, 0),
      position("external", "External Factor", 4, 1, 0),
      position("leverage", "Leverage", 5, -0.5, -1),
      position("outcome", "Likely Outcome", 6, 0.5, -1),
    ],
  },
];
