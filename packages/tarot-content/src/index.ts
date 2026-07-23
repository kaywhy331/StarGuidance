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
    reversedThemes: [`a delayed or inward ${rankThemes[index]}`, shadow],
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

function position(
  id: string,
  displayName: string,
  order: number,
  x: number,
  y: number,
): SpreadPosition {
  return {
    id,
    displayName,
    interpretiveFunction: id,
    description: `Explore ${displayName.toLowerCase()} without treating it as fixed fate.`,
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
