import { createHash, createPublicKey, randomUUID, timingSafeEqual, verify } from "node:crypto";
import { readFileSync } from "node:fs";

export const DEFAULT_ALLOWED_MODELS = Object.freeze([
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
]);
export const DEFAULT_REQUEST_BYTES = 256 * 1024;
export const DEFAULT_RESPONSE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_TOKEN_BUDGET_PER_WINDOW = 120_000;
export const DEFAULT_JWKS_BYTES = 64 * 1024;

const ALLOWED_REQUEST_FIELDS = new Set([
  "model",
  "temperature",
  "max_completion_tokens",
  "reasoning_effort",
  "include_reasoning",
  "messages",
  "response_format",
  "stream",
]);
const ALLOWED_MESSAGE_FIELDS = new Set(["role", "content"]);
const MAX_MESSAGE_CHARACTERS = 120_000;
const MAX_SCHEMA_BYTES = 96 * 1024;
const MAX_QUESTION_CHARACTERS = 500;
const MAX_READER_LENS_STATEMENTS = 3;
const MAX_READER_LENS_CHARACTERS = 1_000;
const MAX_STRING_CHARACTERS = 4_000;
const READING_SCHEMA_NAME = "reading";
const FOLLOW_UP_SCHEMA_NAME = "follow_up";
const GPT_OSS_PREFIX = "openai/gpt-oss-";
const JSON_OBJECT_MODEL = "llama-3.3-70b-versatile";
const REVIEWED_PROMPT_HASHES = new Map([
  // reader-voice-v3 reading, guarded reading, follow-up, and guarded follow-up.
  ["6cbd882b93824b7ed2fa16a81b188d19224c5ad895abf5f91460fb0fd1181fd4", READING_SCHEMA_NAME],
  ["acb8039252911fa626ecf1dc2f2158e0bccdc5b2e4f9e9dccab8fd2e7c28ebbf", READING_SCHEMA_NAME],
  ["f4d4b305ebae00f4f295abd29fa462061de64326b0e8687f2240412c65f17f40", FOLLOW_UP_SCHEMA_NAME],
  ["0a0ee7b20f9473cf37c5334a99d910b251009e7b4f139e0fa16df405c54ad9f8", FOLLOW_UP_SCHEMA_NAME],
  // reader-voice-v4 question-first reading, guarded reading, follow-up, and guarded follow-up.
  ["281342777701f199e8cefc05f2b3d1cc1657ae5a677ab16fcbf63d7f9192947a", READING_SCHEMA_NAME],
  ["8d2615a0faf9c21e26fe32c91dbbab4e5056dba96d150f68fd455eadb8966429", READING_SCHEMA_NAME],
  ["c9895d3207fe0a445d94f91a27ef1f28cd0075d2ba70e085b28b90506c5e38c3", FOLLOW_UP_SCHEMA_NAME],
  ["467fd8a2ecf5481e0429edf29117ad3c33c629316748151b9d8a2113bb4c3eb3", FOLLOW_UP_SCHEMA_NAME],
  // reader-voice-v5 spread-aware reading, guarded reading, follow-up, and guarded follow-up.
  ["e2fb57d4a6984c7ac5dbdfcf1f1c3478d07071e9db4986e821a4e0e4fc92a6f1", READING_SCHEMA_NAME],
  ["8a51d144fbadc1bce8ed7a7dc4f420e359f7e92d6ae16ea42191299be1755db6", READING_SCHEMA_NAME],
  ["aa564249169f94d34e3b0d98eea1c497d9f5933e73c6ae81a64cf3a26bd8ce02", FOLLOW_UP_SCHEMA_NAME],
  ["6f8de98b9f3294356e39b49497e54c7d47b883000d5544d5e47c26047d04401b", FOLLOW_UP_SCHEMA_NAME],
  // reader-voice-v6 question-led reading, guarded reading, follow-up, and guarded follow-up.
  ["cfbb2ab1409739336db8581263069c14aed57cbc2935933a224824fc71db8c4f", READING_SCHEMA_NAME],
  ["f03c5ffe9e3ac2f0bac84c430b38f4c073ce2c11fa31dd7726713ef1fdee1aee", READING_SCHEMA_NAME],
  ["de963a0e4bda0467f071eef984fe93fb99dbc7832e490a3051b18763cf9d00a1", FOLLOW_UP_SCHEMA_NAME],
  ["705626fccb0e264a58cb730aa50ce5838481ad56604abee4c8f0e49b2595d709", FOLLOW_UP_SCHEMA_NAME],
]);
const SPREAD_POSITIONS = new Map([
  ["one-card", ["card-1"]],
  ["three-card", ["card-1", "card-2", "card-3"]],
  [
    "celtic-cross",
    [
      "celtic-present",
      "celtic-challenge",
      "celtic-crown",
      "celtic-root",
      "celtic-past",
      "celtic-near-future",
      "celtic-self",
      "celtic-environment",
      "celtic-hopes-fears",
      "celtic-outcome",
    ],
  ],
  [
    "horseshoe",
    [
      "horseshoe-past",
      "horseshoe-present",
      "horseshoe-hidden",
      "horseshoe-obstacle",
      "horseshoe-environment",
      "horseshoe-action",
      "horseshoe-outcome",
    ],
  ],
  [
    "relationship",
    [
      "relationship-a-conscious",
      "relationship-b-conscious",
      "relationship-a-deeper",
      "relationship-b-deeper",
      "relationship-present",
      "relationship-shared",
      "relationship-direction",
    ],
  ],
  [
    "nine-card-matrix",
    [
      "matrix-past-internal",
      "matrix-past-external",
      "matrix-past-integration",
      "matrix-present-internal",
      "matrix-present-external",
      "matrix-present-integration",
      "matrix-future-internal",
      "matrix-future-external",
      "matrix-future-integration",
    ],
  ],
  ["focus", ["focus"]],
  ["direction", ["situation", "challenge", "direction"]],
  ["crossroads", ["current-path", "hidden-influence", "path-a", "path-b", "leverage"]],
  ["outlook", ["foundation", "present", "incoming", "obstacle", "external", "leverage", "outcome"]],
]);
const REVERSAL_FACETS = new Set([
  "blocked",
  "internalized",
  "delayed",
  "imbalanced",
  "excessive",
  "deficient",
  "avoided",
  "releasing",
  "recovering",
]);
const CARD_RANKS = new Set([
  "ace",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "page",
  "knight",
  "queen",
  "king",
]);
const MAJOR_NAMES = [
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
];
const RANK_NAMES = new Map([
  ["ace", "Ace"],
  ["two", "Two"],
  ["three", "Three"],
  ["four", "Four"],
  ["five", "Five"],
  ["six", "Six"],
  ["seven", "Seven"],
  ["eight", "Eight"],
  ["nine", "Nine"],
  ["ten", "Ten"],
  ["page", "Page"],
  ["knight", "Knight"],
  ["queen", "Queen"],
  ["king", "King"],
]);

function exactObject(value, fields) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === fields.length &&
    Object.keys(value).every((field) => fields.includes(field))
  );
}

function boundedString(value, maximum = MAX_STRING_CHARACTERS) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function exactJson(value, expected) {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function validQuestionContext(value) {
  return (
    exactObject(value, ["version", "topic", "horizon", "intent", "generalReading"]) &&
    value.version === "question-classification-v1" &&
    ["general", "career", "relationships", "change", "wellbeing"].includes(value.topic) &&
    ["open", "immediate", "weeks", "months"].includes(value.horizon) &&
    ["generalReflection", "clarity", "decisionSupport", "planning", "emotionalProcessing"].includes(
      value.intent,
    ) &&
    typeof value.generalReading === "boolean"
  );
}

function validCardId(cardId) {
  if (/^major-(?:0\d|1\d|2[01])$/.test(cardId)) return true;
  const match = /^(wands|cups|swords|pentacles)-([a-z]+)$/.exec(cardId);
  return Boolean(match && CARD_RANKS.has(match[2]));
}

function canonicalCardMetadata(cardId) {
  const major = /^major-(\d{2})$/.exec(cardId);
  if (major) {
    const index = Number.parseInt(major[1], 10);
    return index >= 0 && index < MAJOR_NAMES.length
      ? { card: MAJOR_NAMES[index], arcana: "major" }
      : undefined;
  }
  const minor = /^(wands|cups|swords|pentacles)-([a-z]+)$/.exec(cardId);
  const rank = minor ? RANK_NAMES.get(minor[2]) : undefined;
  if (!minor || !rank) return undefined;
  const suit = `${minor[1][0].toUpperCase()}${minor[1].slice(1)}`;
  return { card: `${rank} of ${suit}`, arcana: "minor" };
}

function reviewedReadingSchema(cards, controls) {
  const exactCards = cards.map((entry) => ({
    type: "object",
    additionalProperties: false,
    required: [
      "positionId",
      "positionLabel",
      "cardId",
      "orientation",
      "coreMeaning",
      "positionInterpretation",
      "relationshipNotes",
      "supportingEvidence",
    ],
    properties: {
      positionId: { type: "string", enum: [entry.positionId], minLength: 1 },
      positionLabel: { type: "string", enum: [entry.positionName], minLength: 1 },
      cardId: { type: "string", enum: [entry.cardId], minLength: 1 },
      orientation: { type: "string", enum: [entry.orientation] },
      coreMeaning: { type: "string", minLength: 1 },
      positionInterpretation: { type: "string", minLength: 1 },
      relationshipNotes: {
        type: "array",
        items: { type: "string", minLength: 1 },
        maxItems: 12,
      },
      supportingEvidence: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 12,
      },
    },
  }));
  const nullableText = (allowed) =>
    allowed ? { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] } : { type: "null" };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "directAnswer",
      "overallPattern",
      "cards",
      "synthesis",
      "likelyTrajectory",
      "alternatePath",
      "timing",
      "userAgency",
      "reflectionPrompt",
      "uncertaintyNote",
      "personalizationLens",
      "safetyFlags",
    ],
    properties: {
      schemaVersion: { type: "string", enum: ["reading-result-v3"] },
      directAnswer: { type: "string", minLength: 1 },
      overallPattern: { type: "string", minLength: 1 },
      cards: {
        type: "array",
        items: exactCards.length === 1 ? exactCards[0] : { anyOf: exactCards },
        minItems: cards.length,
        maxItems: cards.length,
      },
      synthesis: { type: "string", minLength: 1 },
      likelyTrajectory: nullableText(controls.trajectoryAllowed),
      alternatePath: nullableText(controls.alternatePathAllowed),
      timing: nullableText(controls.timingAllowed),
      userAgency: { type: "string", minLength: 1 },
      reflectionPrompt: { type: "string", minLength: 1 },
      uncertaintyNote: { type: "string", minLength: 1 },
      personalizationLens: controls.personalizationAllowed
        ? {
            anyOf: [
              {
                type: "object",
                additionalProperties: false,
                required: ["label", "observations"],
                properties: {
                  label: { type: "string", enum: ["Personalized reflection"] },
                  observations: {
                    type: "array",
                    items: { type: "string", minLength: 1 },
                    minItems: 1,
                    maxItems: 6,
                  },
                },
              },
              { type: "null" },
            ],
          }
        : { type: "null" },
      safetyFlags: { type: "array", items: { type: "string" } },
    },
  };
}

function reviewedFollowUpSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["response"],
    properties: { response: { type: "string", minLength: 1 } },
  };
}

function validReadingResultSubset(value, lockedCards) {
  if (
    !exactObject(value, [
      "directAnswer",
      "overallPattern",
      "cards",
      "synthesis",
      "likelyTrajectory",
      "alternatePath",
      "userAgency",
    ]) ||
    !boundedString(value.directAnswer) ||
    !boundedString(value.overallPattern) ||
    !boundedString(value.synthesis) ||
    !boundedString(value.userAgency) ||
    !(value.likelyTrajectory === null || boundedString(value.likelyTrajectory)) ||
    !(value.alternatePath === null || boundedString(value.alternatePath)) ||
    !Array.isArray(value.cards) ||
    value.cards.length !== lockedCards.length
  )
    return false;
  const seenPositions = new Set();
  for (const card of value.cards) {
    if (
      !exactObject(card, [
        "positionId",
        "positionLabel",
        "cardId",
        "orientation",
        "coreMeaning",
        "positionInterpretation",
        "relationshipNotes",
        "supportingEvidence",
      ]) ||
      seenPositions.has(card.positionId) ||
      !boundedString(card.positionLabel, 128) ||
      !boundedString(card.coreMeaning) ||
      !boundedString(card.positionInterpretation) ||
      !Array.isArray(card.relationshipNotes) ||
      card.relationshipNotes.length > 12 ||
      card.relationshipNotes.some((note) => !boundedString(note)) ||
      !Array.isArray(card.supportingEvidence) ||
      card.supportingEvidence.length < 1 ||
      card.supportingEvidence.length > 12 ||
      card.supportingEvidence.some((evidence) => !boundedString(evidence))
    )
      return false;
    const locked = lockedCards.find((entry) => entry.positionId === card.positionId);
    if (
      !locked ||
      locked.positionName !== card.positionLabel ||
      locked.cardId !== card.cardId ||
      locked.orientation !== card.orientation
    )
      return false;
    seenPositions.add(card.positionId);
  }
  return true;
}

function validSpreadCapabilities(value, positionIds) {
  if (
    !exactObject(value, [
      "trajectoryPositionIds",
      "alternativePositionGroups",
      "timingMethod",
      "linkedPositions",
    ]) ||
    !Array.isArray(value.trajectoryPositionIds) ||
    value.trajectoryPositionIds.some((id) => !positionIds.has(id)) ||
    !Array.isArray(value.alternativePositionGroups) ||
    value.alternativePositionGroups.some(
      (group) =>
        !Array.isArray(group) || group.length < 1 || group.some((id) => !positionIds.has(id)),
    ) ||
    !Array.isArray(value.linkedPositions)
  )
    return false;
  if (
    value.timingMethod !== null &&
    (!exactObject(value.timingMethod, ["id", "positionIds"]) ||
      !boundedString(value.timingMethod.id, 128) ||
      !Array.isArray(value.timingMethod.positionIds) ||
      value.timingMethod.positionIds.length < 1 ||
      value.timingMethod.positionIds.some((id) => !positionIds.has(id)))
  )
    return false;
  return value.linkedPositions.every(
    (link) =>
      exactObject(link, ["id", "positionIds", "relationship"]) &&
      boundedString(link.id, 128) &&
      Array.isArray(link.positionIds) &&
      link.positionIds.length >= 2 &&
      link.positionIds.every((id) => positionIds.has(id)) &&
      ["sequence", "compare", "tension", "integration"].includes(link.relationship),
  );
}

function validateReadingPayload(payload) {
  if (
    !exactObject(payload, [
      "question",
      "questionContext",
      "spreadId",
      "spreadCapabilities",
      "trajectoryAllowed",
      "alternatePathAllowed",
      "timingAllowed",
      "personalizationAllowed",
      "answerPositionId",
      "cards",
      "readerLens",
    ]) ||
    !boundedString(payload.question, MAX_QUESTION_CHARACTERS) ||
    !boundedString(payload.spreadId, 64) ||
    !boundedString(payload.answerPositionId, 64) ||
    !validQuestionContext(payload.questionContext) ||
    typeof payload.trajectoryAllowed !== "boolean" ||
    typeof payload.alternatePathAllowed !== "boolean" ||
    typeof payload.timingAllowed !== "boolean" ||
    typeof payload.personalizationAllowed !== "boolean" ||
    !Array.isArray(payload.cards) ||
    payload.cards.length < 1 ||
    payload.cards.length > 10 ||
    !Array.isArray(payload.readerLens) ||
    payload.readerLens.length > MAX_READER_LENS_STATEMENTS ||
    payload.readerLens.some((statement) => !boundedString(statement, MAX_READER_LENS_CHARACTERS)) ||
    (!payload.personalizationAllowed && payload.readerLens.length > 0)
  )
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");

  const positions = SPREAD_POSITIONS.get(payload.spreadId);
  if (!positions || payload.cards.length !== positions.length)
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  const seenPositions = new Set();
  const seenCards = new Set();
  for (const entry of payload.cards) {
    const canonical = canonicalCardMetadata(entry?.cardId);
    if (
      !exactObject(entry, [
        "positionId",
        "positionName",
        "positionMeans",
        "positionDescription",
        "cardId",
        "card",
        "arcana",
        "orientation",
        "themes",
        "domainTags",
        "approvedReversalFacets",
      ]) ||
      !boundedString(entry.positionId, 64) ||
      !boundedString(entry.positionName, 128) ||
      !boundedString(entry.positionMeans, 512) ||
      !boundedString(entry.positionDescription, 512) ||
      !validCardId(entry.cardId) ||
      !boundedString(entry.card, 128) ||
      !["major", "minor"].includes(entry.arcana) ||
      !["upright", "reversed"].includes(entry.orientation) ||
      !Array.isArray(entry.themes) ||
      entry.themes.length < 1 ||
      entry.themes.length > 8 ||
      entry.themes.some((theme) => !boundedString(theme, 256)) ||
      !Array.isArray(entry.domainTags) ||
      entry.domainTags.length > 16 ||
      entry.domainTags.some((tag) => !boundedString(tag, 128)) ||
      !Array.isArray(entry.approvedReversalFacets) ||
      entry.approvedReversalFacets.length > REVERSAL_FACETS.size ||
      entry.approvedReversalFacets.some((facet) => !REVERSAL_FACETS.has(facet)) ||
      (entry.orientation === "upright" && entry.approvedReversalFacets.length > 0) ||
      seenPositions.has(entry.positionId) ||
      seenCards.has(entry.cardId)
    )
      throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
    if (
      !positions.includes(entry.positionId) ||
      !canonical ||
      entry.card !== canonical.card ||
      entry.arcana !== canonical.arcana
    )
      throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
    seenPositions.add(entry.positionId);
    seenCards.add(entry.cardId);
  }
  if (!seenPositions.has(payload.answerPositionId)) throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  if (seenPositions.size !== positions.length) throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  if (
    !validSpreadCapabilities(payload.spreadCapabilities, seenPositions) ||
    payload.trajectoryAllowed !== payload.spreadCapabilities.trajectoryPositionIds.length > 0 ||
    payload.alternatePathAllowed !==
      payload.spreadCapabilities.alternativePositionGroups.length > 0 ||
    payload.timingAllowed !== (payload.spreadCapabilities.timingMethod !== null)
  )
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  return {
    payload,
    schema: reviewedReadingSchema(payload.cards, {
      trajectoryAllowed: payload.trajectoryAllowed,
      alternatePathAllowed: payload.alternatePathAllowed,
      timingAllowed: payload.timingAllowed,
      personalizationAllowed: payload.personalizationAllowed,
    }),
  };
}

/**
 * Gateway validation above deliberately binds identifiers, cardinality,
 * orientation, schema, and bounded content. Exact editorial card/position
 * values are independently revalidated in the in-app provider builder and
 * provider output contract; the gateway has no repository, profile, vault, or
 * persistence access from which it could enrich or reinterpret them.
 */

function validateFollowUpPayload(payload) {
  if (
    !exactObject(payload, [
      "question",
      "questionContext",
      "spreadId",
      "spreadCapabilities",
      "trajectoryAllowed",
      "alternatePathAllowed",
      "timingAllowed",
      "personalizationAllowed",
      "answerPositionId",
      "cards",
      "readerLens",
      "originalReading",
    ])
  )
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  validateReadingPayload({
    question: payload.question,
    questionContext: payload.questionContext,
    spreadId: payload.spreadId,
    spreadCapabilities: payload.spreadCapabilities,
    trajectoryAllowed: payload.trajectoryAllowed,
    alternatePathAllowed: payload.alternatePathAllowed,
    timingAllowed: payload.timingAllowed,
    personalizationAllowed: payload.personalizationAllowed,
    answerPositionId: payload.answerPositionId,
    cards: payload.cards,
    readerLens: payload.readerLens,
  });
  if (
    !exactObject(payload.originalReading, [
      "directAnswer",
      "overallPattern",
      "cards",
      "synthesis",
      "likelyTrajectory",
      "alternatePath",
      "userAgency",
    ]) ||
    !validReadingResultSubset(payload.originalReading, payload.cards)
  )
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  const lockedCards = new Map(payload.cards.map((entry) => [entry.positionId, entry]));
  if (
    payload.originalReading.cards.length !== payload.cards.length ||
    payload.originalReading.cards.some((entry) => {
      const locked = lockedCards.get(entry.positionId);
      return !locked || locked.cardId !== entry.cardId || locked.orientation !== entry.orientation;
    })
  )
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  return { payload, schema: reviewedFollowUpSchema() };
}

function parseReviewedUserPayload(content, schemaName) {
  let payload;
  try {
    payload = JSON.parse(content);
  } catch {
    throw new Error("INVALID_STARGUIDANCE_PAYLOAD");
  }
  return schemaName === READING_SCHEMA_NAME
    ? validateReadingPayload(payload)
    : validateFollowUpPayload(payload);
}

function reviewedSchemaName(systemPrompt) {
  return REVIEWED_PROMPT_HASHES.get(createHash("sha256").update(systemPrompt).digest("hex"));
}

function validateResponseFormat(parsed, schemaName, expectedSchema) {
  const expectedStrict = {
    type: "json_schema",
    json_schema: { name: schemaName, strict: true, schema: expectedSchema },
  };
  if (parsed.model === JSON_OBJECT_MODEL) {
    const schemaMarker = " Return only one JSON object matching this JSON Schema exactly: ";
    const markerIndex = parsed.messages[0].content.lastIndexOf(schemaMarker);
    if (
      !exactJson(parsed.response_format, { type: "json_object" }) ||
      markerIndex < 1 ||
      reviewedSchemaName(parsed.messages[0].content.slice(0, markerIndex)) !== schemaName
    )
      throw new Error("INVALID_RESPONSE_FORMAT");
    let embedded;
    try {
      embedded = JSON.parse(parsed.messages[0].content.slice(markerIndex + schemaMarker.length));
    } catch {
      throw new Error("INVALID_RESPONSE_FORMAT");
    }
    if (!exactJson(embedded, expectedSchema)) throw new Error("INVALID_RESPONSE_FORMAT");
    return;
  }
  if (!exactJson(parsed.response_format, expectedStrict))
    throw new Error("INVALID_RESPONSE_FORMAT");
}

export function readRequiredSecret(path, label) {
  if (!path) throw new Error(`${label}_FILE_REQUIRED`);
  const value = readFileSync(path, "utf8").trim();
  if (value.length < 32 || new Set(value).size < 8) throw new Error(`${label}_WEAK`);
  return value;
}

export function constantTimeEquals(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

export function opaqueSubject(value) {
  return createHash("sha256").update(value).digest("hex");
}

function decodeJsonSegment(segment) {
  if (typeof segment !== "string" || segment.length === 0 || !/^[A-Za-z0-9_-]+$/.test(segment))
    return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizedTeamDomain(value) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    hostname === "cloudflareaccess.com" ||
    !hostname.endsWith(".cloudflareaccess.com") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("CLOUDFLARE_ACCESS_TEAM_DOMAIN_INVALID");
  return url.origin;
}

function audienceMatches(claim, audience) {
  return typeof claim === "string"
    ? claim === audience
    : Array.isArray(claim) && claim.some((entry) => entry === audience);
}

/**
 * Validate the Access application JWT at the origin as a second check after
 * cloudflared's Protect with Access gate. Keys are fetched only from the
 * configured team domain and cached briefly to accommodate signing rotation.
 */
export function createAccessVerifier({
  teamDomain,
  audience,
  jwksUrl,
  fetchImpl = fetch,
  now = () => Date.now(),
  keyCacheMs = 5 * 60_000,
}) {
  const issuer = normalizedTeamDomain(teamDomain);
  const reviewedAudience = audience?.trim();
  if (!reviewedAudience || reviewedAudience.length > 512)
    throw new Error("CLOUDFLARE_ACCESS_AUD_REQUIRED");
  const signingKeysUrl = jwksUrl ? new URL(jwksUrl) : new URL(`${issuer}/cdn-cgi/access/certs`);
  const reviewedJwksUrl = new URL("/cdn-cgi/access/certs", issuer);
  if (
    !["http:", "https:"].includes(signingKeysUrl.protocol) ||
    signingKeysUrl.username ||
    signingKeysUrl.password ||
    signingKeysUrl.search ||
    signingKeysUrl.hash ||
    (jwksUrl &&
      !(
        signingKeysUrl.protocol === "http:" &&
        signingKeysUrl.hostname === "access-jwks" &&
        signingKeysUrl.port === "8081" &&
        signingKeysUrl.pathname === "/certs"
      ) &&
      signingKeysUrl.href !== reviewedJwksUrl.href)
  )
    throw new Error("CLOUDFLARE_ACCESS_JWKS_URL_INVALID");
  let cachedKeys = new Map();
  let cacheExpiresAt = 0;
  let lastRefreshAt = 0;
  let refreshPromise;

  async function refreshKeys() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const response = await fetchImpl(signingKeysUrl, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error("ACCESS_JWKS_UNAVAILABLE");
      const body = JSON.parse(
        canonicalJwks(await readBoundedWebResponse(response, DEFAULT_JWKS_BYTES)).toString("utf8"),
      );
      if (!body || !Array.isArray(body.keys)) throw new Error("ACCESS_JWKS_INVALID");
      const next = new Map();
      for (const key of body.keys) {
        if (
          key &&
          typeof key === "object" &&
          key.kty === "RSA" &&
          key.alg === "RS256" &&
          key.use === "sig" &&
          typeof key.kid === "string" &&
          key.kid.length > 0 &&
          key.kid.length <= 256
        )
          next.set(key.kid, createPublicKey({ key, format: "jwk" }));
      }
      if (next.size === 0 || next.size > 16) throw new Error("ACCESS_JWKS_INVALID");
      cachedKeys = next;
      lastRefreshAt = now();
      cacheExpiresAt = lastRefreshAt + keyCacheMs;
    })();
    try {
      await refreshPromise;
    } finally {
      refreshPromise = undefined;
    }
  }

  return async (token) => {
    if (typeof token !== "string" || token.length > 16_384) throw new Error("ACCESS_JWT_INVALID");
    const segments = token.split(".");
    if (segments.length !== 3) throw new Error("ACCESS_JWT_INVALID");
    const [encodedHeader, encodedPayload, encodedSignature] = segments;
    const header = decodeJsonSegment(encodedHeader);
    const payload = decodeJsonSegment(encodedPayload);
    if (
      !header ||
      !payload ||
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      payload.iss !== issuer ||
      !audienceMatches(payload.aud, reviewedAudience)
    )
      throw new Error("ACCESS_JWT_INVALID");

    const nowSeconds = Math.floor(now() / 1000);
    if (
      typeof payload.exp !== "number" ||
      payload.exp <= nowSeconds ||
      (typeof payload.nbf === "number" && payload.nbf > nowSeconds + 30)
    )
      throw new Error("ACCESS_JWT_EXPIRED");

    const currentTime = now();
    if (
      currentTime >= cacheExpiresAt ||
      (!cachedKeys.has(header.kid) && currentTime - lastRefreshAt >= 5_000)
    )
      await refreshKeys();
    const publicKey = cachedKeys.get(header.kid);
    if (!publicKey) throw new Error("ACCESS_JWT_INVALID");
    let signature;
    try {
      signature = Buffer.from(encodedSignature, "base64url");
    } catch {
      throw new Error("ACCESS_JWT_INVALID");
    }
    const valid = verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      signature,
    );
    if (!valid) throw new Error("ACCESS_JWT_INVALID");
    const subject = [payload.sub, payload.common_name, payload.email].find(
      (value) => typeof value === "string" && value.length > 0,
    );
    if (!subject) throw new Error("ACCESS_JWT_IDENTITY_MISSING");
    return { subjectHash: opaqueSubject(subject) };
  };
}

export class FixedWindowRateLimiter {
  constructor(limit = 30, windowMs = 60_000, now = () => Date.now()) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.buckets = new Map();
  }

  admit(key) {
    const current = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || current >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: current + this.windowMs });
      if (this.buckets.size > 1_000) {
        for (const [candidate, value] of this.buckets)
          if (current >= value.resetAt) this.buckets.delete(candidate);
        while (this.buckets.size > 1_000) this.buckets.delete(this.buckets.keys().next().value);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.count >= this.limit)
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1_000)),
      };
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export class FixedWindowBudgetLimiter {
  constructor(
    limit = DEFAULT_TOKEN_BUDGET_PER_WINDOW,
    windowMs = 60_000,
    now = () => Date.now(),
    maxBuckets = 1_000,
  ) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
    this.maxBuckets = maxBuckets;
    this.buckets = new Map();
  }

  admit(key, amount) {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > this.limit)
      return { allowed: false, retryAfterSeconds: 60 };
    const current = this.now();
    const bucket = this.buckets.get(key);
    if (!bucket || current >= bucket.resetAt) {
      this.buckets.set(key, { amount, resetAt: current + this.windowMs });
      if (this.buckets.size > this.maxBuckets) {
        for (const [candidate, value] of this.buckets)
          if (current >= value.resetAt) this.buckets.delete(candidate);
        while (this.buckets.size > this.maxBuckets)
          this.buckets.delete(this.buckets.keys().next().value);
      }
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (bucket.amount + amount > this.limit)
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1_000)),
      };
    bucket.amount += amount;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export function requestId(received) {
  return typeof received === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(received)
    ? received
    : randomUUID();
}

export function sendJson(res, status, body, extraHeaders = {}) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "cache-control": "private, no-store, max-age=0",
    "content-length": String(encoded.length),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  res.end(encoded);
}

export function sendError(res, status, code, requestIdentifier, extraHeaders = {}) {
  sendJson(
    res,
    status,
    { error: { code, requestId: requestIdentifier } },
    { "x-request-id": requestIdentifier, ...extraHeaders },
  );
}

export async function readBoundedBody(req, maxBytes = DEFAULT_REQUEST_BYTES, timeoutMs = 10_000) {
  const declared = req.headers["content-length"];
  if (declared !== undefined) {
    const rendered = String(declared);
    if (!/^(?:0|[1-9]\d*)$/.test(rendered)) throw new Error("REQUEST_TOO_LARGE");
    const length = Number(rendered);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes)
      throw new Error("REQUEST_TOO_LARGE");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("REQUEST_TIMEOUT");
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("aborted", onAborted);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };
    const onAborted = () => fail(new Error("REQUEST_ABORTED"));
    const onError = () => fail(new Error("REQUEST_ABORTED"));
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new Error("REQUEST_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const timer = setTimeout(() => fail(new Error("REQUEST_TIMEOUT")), timeoutMs);
    req.on("aborted", onAborted);
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export async function readBoundedWebResponse(response, maxBytes = DEFAULT_RESPONSE_BYTES) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

export function validateInferencePayload(body, allowedModels = DEFAULT_ALLOWED_MODELS) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("INVALID_PAYLOAD");
  if (Object.keys(parsed).some((field) => !ALLOWED_REQUEST_FIELDS.has(field)))
    throw new Error("UNSUPPORTED_FIELD");
  if (!allowedModels.includes(parsed.model)) throw new Error("MODEL_NOT_ALLOWED");
  if (
    typeof parsed.temperature !== "number" ||
    !Number.isFinite(parsed.temperature) ||
    parsed.temperature < 0 ||
    parsed.temperature > 1
  )
    throw new Error("INVALID_TEMPERATURE");
  if (
    !Number.isInteger(parsed.max_completion_tokens) ||
    parsed.max_completion_tokens < 1 ||
    parsed.max_completion_tokens > 2_600
  )
    throw new Error("INVALID_OUTPUT_BUDGET");
  if (parsed.stream !== undefined && parsed.stream !== false) throw new Error("STREAMING_DISABLED");
  if (
    !Array.isArray(parsed.messages) ||
    parsed.messages.length !== 2 ||
    parsed.messages[0]?.role !== "system" ||
    parsed.messages[1]?.role !== "user" ||
    parsed.messages.some(
      (message) =>
        !message ||
        typeof message !== "object" ||
        Object.keys(message).some((field) => !ALLOWED_MESSAGE_FIELDS.has(field)) ||
        typeof message.content !== "string" ||
        message.content.length === 0 ||
        message.content.length > MAX_MESSAGE_CHARACTERS,
    )
  )
    throw new Error("INVALID_MESSAGES");
  if (
    !parsed.response_format ||
    Buffer.byteLength(JSON.stringify(parsed.response_format)) > MAX_SCHEMA_BYTES
  )
    throw new Error("INVALID_RESPONSE_FORMAT");
  if (parsed.model.startsWith(GPT_OSS_PREFIX)) {
    if (parsed.reasoning_effort !== "low" || parsed.include_reasoning !== false)
      throw new Error("INVALID_REASONING_POLICY");
  } else if (parsed.reasoning_effort !== undefined || parsed.include_reasoning !== undefined) {
    throw new Error("INVALID_REASONING_POLICY");
  }
  const systemPrompt = parsed.messages[0].content;
  const directSchemaName = reviewedSchemaName(systemPrompt);
  const schemaMarker = " Return only one JSON object matching this JSON Schema exactly: ";
  const markerIndex = systemPrompt.lastIndexOf(schemaMarker);
  const inferredSchemaName =
    directSchemaName ??
    (markerIndex < 1 ? undefined : reviewedSchemaName(systemPrompt.slice(0, markerIndex)));
  if (!inferredSchemaName) throw new Error("PROMPT_NOT_ALLOWED");
  const reviewed = parseReviewedUserPayload(parsed.messages[1].content, inferredSchemaName);
  validateResponseFormat(parsed, inferredSchemaName, reviewed.schema);
  return parsed;
}

/** Conservative admission estimate: every UTF-8 byte may be one input token. */
export function conservativeTokenBudget(body, parsed) {
  if (!Buffer.isBuffer(body) || !parsed || !Number.isSafeInteger(parsed.max_completion_tokens))
    throw new Error("INVALID_TOKEN_BUDGET");
  return body.length + parsed.max_completion_tokens;
}

export function canonicalInferencePayload(body, allowedModels = DEFAULT_ALLOWED_MODELS) {
  return Buffer.from(JSON.stringify(validateInferencePayload(body, allowedModels)));
}

export function canonicalCompletionResponse(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("INVALID_COMPLETION_RESPONSE");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Array.isArray(parsed.choices) ||
    parsed.choices.length !== 1
  )
    throw new Error("INVALID_COMPLETION_RESPONSE");
  const choice = parsed.choices[0];
  if (
    !choice ||
    typeof choice !== "object" ||
    !choice.message ||
    typeof choice.message !== "object" ||
    typeof choice.message.content !== "string" ||
    choice.message.content.length === 0 ||
    choice.finish_reason !== "stop"
  )
    throw new Error("INVALID_COMPLETION_RESPONSE");
  return Buffer.from(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: choice.message.content },
        },
      ],
    }),
  );
}

export function canonicalJwks(body) {
  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("ACCESS_JWKS_INVALID");
  }
  if (
    !parsed ||
    !Array.isArray(parsed.keys) ||
    parsed.keys.length === 0 ||
    parsed.keys.length > 16 ||
    parsed.keys.some(
      (key) =>
        !key ||
        typeof key !== "object" ||
        key.kty !== "RSA" ||
        key.alg !== "RS256" ||
        key.use !== "sig" ||
        typeof key.kid !== "string" ||
        key.kid.length === 0 ||
        key.kid.length > 256 ||
        typeof key.n !== "string" ||
        !/^[A-Za-z0-9_-]{128,2048}$/.test(key.n) ||
        typeof key.e !== "string" ||
        !/^[A-Za-z0-9_-]{1,16}$/.test(key.e),
    )
  )
    throw new Error("ACCESS_JWKS_INVALID");
  return Buffer.from(
    JSON.stringify({
      keys: parsed.keys.map(({ kty, alg, use, kid, n, e }) => ({ kty, alg, use, kid, n, e })),
    }),
  );
}

export function isLoopback(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
