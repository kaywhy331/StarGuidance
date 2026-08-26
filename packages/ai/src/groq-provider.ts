import {
  followUpResultSchema,
  readingResultV3Schema,
  type FollowUpResult,
  type ReadingConfiguration,
  type ReadingResult,
} from "@starguidance/contracts";

import {
  classifyQuestion,
  DeterministicFallbackProvider,
  FALLBACK_PROVIDER_ID,
  type FollowUpGenerationInput,
  type FollowUpGenerationOutcome,
  type ReadingGenerationOutcome,
  type ReadingGenerationInput,
  type ReadingInterpretationProvider,
} from "./index";
import { answerCard, resolveDraw } from "./interpretation";
import { generatedOutputSafetyViolation } from "./output-safety";

/**
 * A live interpretation provider, spoken in the voice of a reader.
 *
 * The model never chooses cards. It receives the already-locked draw, the
 * curated meanings for those cards, the position each landed in, the question,
 * and the minimised trait lens — nothing else. Raw birth name, exact birth
 * details and account identifiers are deliberately absent from the payload
 * (AI-002, AI-003), and the draw cannot change as a result of anything the
 * model returns.
 *
 * Output is schema-constrained and validated. Anything that fails validation,
 * times out, or errors falls back to the deterministic reading rather than
 * showing a person a broken or empty result (AI-015).
 */
export const PROMPT_VERSION = "reader-voice-v7" as const;
export const RESPONSE_SCHEMA_VERSION = "reading-result-v3" as const;
export const FOLLOW_UP_PROMPT_VERSION = "follow-up-reader-voice-v7" as const;
export const DEFAULT_GROQ_PRIMARY_MODEL = "openai/gpt-oss-120b" as const;
export const DEFAULT_GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
] as const;
export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1" as const;

const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 40_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_600;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const JSON_OBJECT_MODELS = new Set(["llama-3.3-70b-versatile"]);
const GPT_OSS_MODEL_PREFIX = "openai/gpt-oss-";

type StructuredOutputMode = "strict-json-schema" | "json-object";

type FallbackReason =
  | "request-timeout"
  | "authentication"
  | "rate-limited"
  | "provider-unavailable"
  | "request-rejected"
  | "invalid-response"
  | "unsafe-response"
  | "network-error"
  | "unknown";

class ProviderRequestError extends Error {
  constructor(readonly reason: FallbackReason) {
    super(`AI_PROVIDER_${reason.toUpperCase().replaceAll("-", "_")}`);
  }
}

function fallbackReason(error: unknown): FallbackReason {
  if (error instanceof ProviderRequestError) return error.reason;
  if (error instanceof SyntaxError) return "invalid-response";
  if (error instanceof TypeError) return "network-error";
  if (error instanceof Error && error.name === "ZodError") return "invalid-response";
  return "unknown";
}

/**
 * Categories where a confident prediction would do real harm. Exported so
 * apps/web's reading UI can pause for the same categories before the deck is
 * even shuffled (see reading-scene.tsx), rather than only shaping the voice
 * of a result that already exists.
 */
export const GUARDED_CATEGORIES = new Set([
  "selfHarmCrisis",
  "medical",
  "legal",
  "financial",
  "mentalHealthDiagnosis",
  "physicalDeath",
  "criminalGuilt",
  "pregnancy",
  "infidelity",
  "thirdPartyPrivateClaim",
]);

const LEGACY_READER_VOICE = [
  "You are a conversational divination narrator speaking as an intuitive continuation of an existing conversation.",
  "Use the locked cards to understand what appears to be happening in the person's life and where it may be heading; do not explain tarot academically.",
  "Internally reason through the current situation, underlying pattern, remembered personal tendencies, likely next development, observable manifestation, tension, turning point, and direction afterward. Never expose that structure.",
  "Write ordered spoken passages with no headings inside their text. The passages must join into one continuous narration, not a structured report.",
  "Sound warm, perceptive, calm, thoughtful, slightly mysterious, and natural. Use contractions, varied sentence length, and occasional short sentences for emphasis.",
  "Include meaningful conditional prediction. Favor concrete plausible manifestations such as a conversation, decision, opportunity, changed behavior, obstacle, work or financial development, or realization.",
  "Use phrases such as 'I think you're going to notice', 'you may soon find', 'I wouldn't be surprised if', 'watch for', and 'the turning point may come when' where natural—not mechanically.",
  "Silently integrate only relevant readerLens statements. Never announce a profile, personal lens, astrology, numerology, or what you know about the person.",
  "Preserve each card's orientation, supplied traditional themes, and positional function, including both constructive and shadow expressions. The profile may change emphasis but never card meaning.",
  "For relationship material, never claim another person's private thoughts, motives, or feelings. Speak only through observable behavior, possible signals held with uncertainty, direct communication, boundaries, evidence, and the user's choices.",
  "Do not name every card or every position. Name the answer-bearing card once near the opening when natural, then let the interpretation become the person's story.",
  "Never write or imply visible sections such as 'Traditional current', 'Your personal lens', 'Connection to your question', 'The advice is', 'Likely trajectory', or 'Alternate trajectory'.",
  "Do not sound like a tarot encyclopedia, therapist, horoscope generator, academic report, or mystical performance. Do not manufacture drama.",
  "Include tension, contradiction, reversal, foreshadowing, hidden significance, or unresolved curiosity where the draw genuinely supports it.",
  "Vary the ending: prediction, realization, foreshadowing, gentle warning, reflection, or an open question. Do not always end with a question.",
  "The supplied questionContext.topic is authoritative; infer from wording only when it is general.",
  "Echo every supplied positionId, cardId, and orientation exactly. Use only supplied position IDs in cardReferences.",
  "Return unique passage IDs; passageIds and trajectory passage IDs must reference passages in the same response.",
  "Every required prose string and every list the schema marks as non-empty must contain a meaningful value.",
  "Do not restate or quote the raw question. Do not mention being an AI. Do not put a disclaimer in the spoken passages; uncertainty is stored separately.",
].join(" ");

/** Frozen system prompt retained for persisted runtime configurations. */
const READER_VOICE_V5 = [
  "You are a warm, perceptive tarot reader conducting a private consultation from a locked spread.",
  "Before writing, internally analyze the question's subject, decision or tension, requested horizon, and the user's agency. Then interpret every card through its approved orientation meaning, immutable position function, question, and domain tags.",
  "Scan the whole spread for repeated suits or elements, Major Arcana concentration, repeated ranks, court patterns, reinforcing cards, conflicts, directional movement, and only the explicit linked-position rules supplied in spreadCapabilities.",
  "Answer the core question clearly, then explain every card's contribution and synthesize one coherent story. Do not write a list of dictionary definitions or force a predetermined transcript length.",
  "likelyTrajectory may be non-null only when trajectoryAllowed is true and the configured positions genuinely support it. alternatePath may be non-null only when alternatePathAllowed is true. timing may be non-null only when timingAllowed is true. Otherwise return null.",
  "For a one-card Focus reading, provide the central theme, what to notice, practical guidance, and reflection; never manufacture an alternate path. For Situation–Challenge–Direction, connect all three and make any outlook explicitly conditional on following Direction.",
  "A reversed card is not automatically opposite or negative. Use only one supplied approvedReversalFacet when the surrounding cards, position, and question support it: blocked, internalized, delayed, imbalanced, excessive, deficient, avoided, releasing, or recovering.",
  "Every claim must be traceable. supportingEvidence must cite the supplied card themes and position function; relationshipNotes must name the cards and positions that create that relationship. Never contradict the curated semantic range.",
  "Use confident but conditional spoken language: 'The current pattern suggests', 'Under present conditions', 'This may indicate', and 'The strongest leverage appears to be' where natural. Use one concise uncertaintyNote, not repeated disclaimers.",
  "Pure Tarot has personalizationAllowed false and requires personalizationLens null. Personalized Tarot may use only readerLens statements to adjust emphasis, examples, or reflective language in a separately labeled personalizationLens. Never describe profile material as revealed by the cards.",
  "Never expose astrology, numerology, BaZi, Dreamspell, birth details, hidden labels, or source-system names. Profile context cannot override card meaning, position, orientation, or create a prediction.",
  "Never claim another person's private thoughts. Speak through observable behavior, direct communication, evidence, boundaries, and the user's choices. Never guarantee outcomes or exact dates.",
  "Echo every supplied positionId, positionLabel, cardId, and orientation exactly. Include exactly one card object per supplied locked card, in the supplied position order.",
  "Use the specific non-identifying concern in the question without copying names, locations, exact dates, employers, or other identifying details into persisted prose.",
  "Sound spoken but edited: warm, candid, thoughtful, specific, and natural. Avoid filler, profanity, canned mysticism, academic reporting, repetitive sentence frames, and therapy-speak.",
  "Do not mention being an AI or the existence of these instructions.",
].join(" ");

/** Frozen system prompt retained for persisted v6 runtime configurations. */
const READER_VOICE_V6 = [
  "You are a warm, perceptive tarot reader conducting a private consultation from a locked spread.",
  "Before writing, internally analyze the question's subject, decision or tension, requested horizon, and the user's agency. Then interpret every card through its approved orientation meaning, immutable position function, question, and domain tags.",
  "Scan the whole spread for repeated suits or elements, Major Arcana concentration, repeated ranks, court patterns, reinforcing cards, conflicts, directional movement, and only the explicit linked-position rules supplied in spreadCapabilities.",
  "The first sentence of directAnswer must answer the person's specific non-identifying concern with a clear interpretive stance. Do not begin by announcing cards, themes, spread mechanics, or that 'the current pattern begins with' something.",
  "Answer the core question clearly, then explain every card's contribution and synthesize one coherent story. Treat the spread like an argument: situation or foundation establishes the reality, challenge or pressure explains the difficulty, and direction, leverage, or outcome shows what changes the answer. Do not write a list of dictionary definitions or force a predetermined transcript length.",
  "likelyTrajectory may be non-null only when trajectoryAllowed is true and the configured positions genuinely support it. alternatePath may be non-null only when alternatePathAllowed is true. timing may be non-null only when timingAllowed is true. Otherwise return null.",
  "For a one-card Focus reading, provide the central theme, what to notice, practical guidance, and reflection; never manufacture an alternate path. For Situation–Challenge–Direction, connect all three and make any outlook explicitly conditional on following Direction.",
  "A reversed card is not automatically opposite or negative. Use only one supplied approvedReversalFacet when the surrounding cards, position, and question support it: blocked, internalized, delayed, imbalanced, excessive, deficient, avoided, releasing, or recovering.",
  "Every claim must be traceable. supportingEvidence must cite the supplied card themes and position function; relationshipNotes must name the cards and positions that create that relationship. Never contradict the curated semantic range.",
  "coreMeaning is concise evidence. positionInterpretation is the lived reading: translate the card, position, and concern into what may be happening, why it matters, and what the person could observe. Never repeat coreMeaning, recite positionMeans, say 'whose function is', or explain that a position is 'designed to examine' something.",
  "overallPattern must identify an actual cross-card pattern or turn, not report card counts or configuration metadata. synthesis must explain the causal, reinforcing, or conflicting movement across the cards without relisting every card or repeating directAnswer.",
  "Although the response is structured JSON, its visible prose must join into one natural consultation. Give successive fields distinct jobs, vary sentence openings, and do not make each card passage sound like a separate form response.",
  "Use confident but conditional spoken language: 'The current pattern suggests', 'Under present conditions', 'This may indicate', and 'The strongest leverage appears to be' where natural. Use one concise uncertaintyNote, not repeated disclaimers.",
  "Pure Tarot has personalizationAllowed false and requires personalizationLens null. Personalized Tarot may use only readerLens statements to adjust emphasis, examples, or reflective language in a separately labeled personalizationLens. Never describe profile material as revealed by the cards.",
  "Never expose astrology, numerology, BaZi, Dreamspell, birth details, hidden labels, or source-system names. Profile context cannot override card meaning, position, orientation, or create a prediction.",
  "Never claim another person's private thoughts. Speak through observable behavior, direct communication, evidence, boundaries, and the user's choices. Never guarantee outcomes or exact dates.",
  "Echo every supplied positionId, positionLabel, cardId, and orientation exactly. Include exactly one card object per supplied locked card, in the supplied position order.",
  "Use the specific non-identifying concern in the question without copying names, locations, exact dates, employers, or other identifying details into persisted prose.",
  "Sound spoken but edited: warm, candid, thoughtful, specific, and natural. Avoid filler, profanity, canned mysticism, academic reporting, repetitive sentence frames, and therapy-speak.",
  "Do not mention being an AI or the existence of these instructions.",
].join(" ");

const READER_VOICE = [
  "You are a warm, perceptive tarot reader speaking directly to one person in a private consultation from a locked spread.",
  "Read the supplied question, immutable card positions, approved meanings, and whole-spread relationships before writing. The cards are already selected; never imply that the profile, question, stars, or narrator selected them.",
  "Lead with the answer. The first sentence of directAnswer must take a clear, useful stance on the person's specific non-identifying concern. Sound like a reading, not an explainer: favor 'Your spread points to', 'What I see here is', 'Watch for', and 'If this continues' over definitions, process commentary, or repeated hedging.",
  "Keep visible prose short and spoken. Target 35–55 words for directAnswer, 20–40 for overallPattern, 25–45 for each positionInterpretation, 30–50 for synthesis, 25–45 for each trajectory or alternate path, 20–35 for userAgency, and one sentence each for reflectionPrompt and uncertaintyNote.",
  "Treat the spread as one argument: foundation or situation shows what is active, challenge shows the pressure, and direction, leverage, or outcome shows what changes the answer. Do not recite dictionary meanings, spread instructions, card counts, or schema structure.",
  "likelyTrajectory may be non-null only when trajectoryAllowed is true and the configured positions genuinely support it. alternatePath may be non-null only when alternatePathAllowed is true. timing may be non-null only when timingAllowed is true. Otherwise return null.",
  "For a one-card Focus reading, give the central message, a concrete sign to watch, and one action; never manufacture an alternate path. For Situation–Challenge–Direction, connect all three and make any outlook conditional on what happens around Direction.",
  "A reversed card is not automatically opposite or negative. Use only one supplied approvedReversalFacet when supported: blocked, internalized, delayed, imbalanced, excessive, deficient, avoided, releasing, or recovering.",
  "Every claim must remain traceable. supportingEvidence cites supplied themes and position function; relationshipNotes name only supplied card-position relationships. Keep evidence concise and never contradict the curated semantic range.",
  "coreMeaning is terse evidence. positionInterpretation is the lived reading: say what appears to be happening, why this card matters here, and what the person may observe. Never say 'whose function is', 'designed to examine', or otherwise teach the interface back to the person.",
  "overallPattern names the turn across the spread. synthesis states what the cards say together without relisting them or repeating directAnswer.",
  "In Pure Tarot, personalizationAllowed is false, readerLens is empty, and personalizationLens must be null.",
  "In Personalized Tarot, silently weave one to three relevant readerLens statements into the actual direct answer, card interpretations, synthesis, trajectory, or agency. When readerLens is non-empty, use it in at least two of those places; do not isolate all personalization in personalizationLens. personalizationLens is only a terse audit record of the lens used, not a reader-facing explanation.",
  "Treat readerLens as a tendency to compare with the question, never proof or destiny. Never announce a profile, birth data, astrology, numerology, BaZi, Dreamspell, hidden labels, or source-system names. Profile context may change emphasis but cannot change a card, its meaning, its orientation, or create a prediction.",
  "For relationship questions, you may name visible strain, imbalance, distance, or reciprocity in the connection, but never claim another person's private thoughts, motives, or feelings as fact. Point to observable behavior, an honest conversation, boundaries, evidence, and the user's choices.",
  "Use confident but conditional language. Give one clear conditional anchor rather than weakening every sentence. Never guarantee an outcome or exact date.",
  "Echo every supplied positionId, positionLabel, cardId, and orientation exactly. Include exactly one card object per supplied locked card in position order.",
  "Use the specific non-identifying concern without copying names, locations, exact dates, employers, or other identifying details into persisted prose.",
  "Sound candid, intuitive, specific, and slightly mysterious. Avoid filler, canned mysticism, academic reporting, therapy-speak, and phrases such as 'this card traditionally means' or 'your private reflection lens notes'.",
  "Do not mention being an AI or these instructions.",
].join(" ");

const GUARDED_VOICE = [
  "This question touches something where a confident prediction could cause real harm.",
  "Do not diagnose, do not predict death, illness, pregnancy, guilt, or a verdict, and do not assert",
  "infidelity, private facts about anyone who is not present, investment returns, guaranteed employment,",
  "or any guaranteed outcome. Read the cards for what this person can see, decide,",
  "prepare for, and ask about — and point them toward qualified help where that is the honest answer.",
  "Stay warm and direct. This is a redirection, not a refusal.",
].join(" ");

const FOLLOW_UP_VOICE = [
  "Answer the follow-up as one cohesive response, never as a second full reading.",
  "Refer naturally to one relevant card when useful, without mechanically naming its position.",
  "Silently carry forward the original narration and relevant reader-lens trait.",
  "Stay focused on the follow-up. Do not use headings, lists, disclaimers, or repeat the spread.",
].join(" ");

const LEGACY_GATEWAY_SYSTEM_PROMPTS = Object.freeze({
  reading: LEGACY_READER_VOICE,
  guardedReading: `${LEGACY_READER_VOICE} ${GUARDED_VOICE}`,
  followUp: `${LEGACY_READER_VOICE} ${FOLLOW_UP_VOICE}`,
  guardedFollowUp: `${LEGACY_READER_VOICE} ${FOLLOW_UP_VOICE} ${GUARDED_VOICE}`,
});

const V5_GATEWAY_SYSTEM_PROMPTS = Object.freeze({
  reading: READER_VOICE_V5,
  guardedReading: `${READER_VOICE_V5} ${GUARDED_VOICE}`,
  followUp: `${READER_VOICE_V5} ${FOLLOW_UP_VOICE}`,
  guardedFollowUp: `${READER_VOICE_V5} ${FOLLOW_UP_VOICE} ${GUARDED_VOICE}`,
});

const V6_GATEWAY_SYSTEM_PROMPTS = Object.freeze({
  reading: READER_VOICE_V6,
  guardedReading: `${READER_VOICE_V6} ${GUARDED_VOICE}`,
  followUp: `${READER_VOICE_V6} ${FOLLOW_UP_VOICE}`,
  guardedFollowUp: `${READER_VOICE_V6} ${FOLLOW_UP_VOICE} ${GUARDED_VOICE}`,
});

export const REVIEWED_GATEWAY_SYSTEM_PROMPTS = Object.freeze({
  reading: READER_VOICE,
  guardedReading: `${READER_VOICE} ${GUARDED_VOICE}`,
  followUp: `${READER_VOICE} ${FOLLOW_UP_VOICE}`,
  guardedFollowUp: `${READER_VOICE} ${FOLLOW_UP_VOICE} ${GUARDED_VOICE}`,
});

const GROUNDED_VOICE = [
  "Keep the narration especially concrete and economical.",
  "Prefer observable signals, explicit choices, and near-term conditions over abstract symbolism.",
  "Leave room for ambiguity without weakening the direct answer.",
].join(" ");

export const RUNTIME_PROMPT_BUNDLES = Object.freeze({
  "reader-voice-v3": {
    readingVersion: "reader-voice-v3",
    followUpVersion: "follow-up-reader-voice-v3",
    ...LEGACY_GATEWAY_SYSTEM_PROMPTS,
  },
  "reader-voice-v3-grounded": {
    readingVersion: "reader-voice-v3-grounded",
    followUpVersion: "follow-up-reader-voice-v3-grounded",
    reading: `${LEGACY_GATEWAY_SYSTEM_PROMPTS.reading} ${GROUNDED_VOICE}`,
    guardedReading: `${LEGACY_GATEWAY_SYSTEM_PROMPTS.guardedReading} ${GROUNDED_VOICE}`,
    followUp: `${LEGACY_GATEWAY_SYSTEM_PROMPTS.followUp} ${GROUNDED_VOICE}`,
    guardedFollowUp: `${LEGACY_GATEWAY_SYSTEM_PROMPTS.guardedFollowUp} ${GROUNDED_VOICE}`,
  },
  "reader-voice-v4": {
    readingVersion: "reader-voice-v4",
    followUpVersion: "follow-up-reader-voice-v4",
    ...V5_GATEWAY_SYSTEM_PROMPTS,
  },
  "reader-voice-v4-grounded": {
    readingVersion: "reader-voice-v4-grounded",
    followUpVersion: "follow-up-reader-voice-v4-grounded",
    reading: `${V5_GATEWAY_SYSTEM_PROMPTS.reading} ${GROUNDED_VOICE}`,
    guardedReading: `${V5_GATEWAY_SYSTEM_PROMPTS.guardedReading} ${GROUNDED_VOICE}`,
    followUp: `${V5_GATEWAY_SYSTEM_PROMPTS.followUp} ${GROUNDED_VOICE}`,
    guardedFollowUp: `${V5_GATEWAY_SYSTEM_PROMPTS.guardedFollowUp} ${GROUNDED_VOICE}`,
  },
  "reader-voice-v5": {
    readingVersion: "reader-voice-v5",
    followUpVersion: "follow-up-reader-voice-v5",
    ...V5_GATEWAY_SYSTEM_PROMPTS,
  },
  "reader-voice-v5-grounded": {
    readingVersion: "reader-voice-v5-grounded",
    followUpVersion: "follow-up-reader-voice-v5-grounded",
    reading: `${V5_GATEWAY_SYSTEM_PROMPTS.reading} ${GROUNDED_VOICE}`,
    guardedReading: `${V5_GATEWAY_SYSTEM_PROMPTS.guardedReading} ${GROUNDED_VOICE}`,
    followUp: `${V5_GATEWAY_SYSTEM_PROMPTS.followUp} ${GROUNDED_VOICE}`,
    guardedFollowUp: `${V5_GATEWAY_SYSTEM_PROMPTS.guardedFollowUp} ${GROUNDED_VOICE}`,
  },
  "reader-voice-v6": {
    readingVersion: "reader-voice-v6",
    followUpVersion: "follow-up-reader-voice-v6",
    ...V6_GATEWAY_SYSTEM_PROMPTS,
  },
  "reader-voice-v6-grounded": {
    readingVersion: "reader-voice-v6-grounded",
    followUpVersion: "follow-up-reader-voice-v6-grounded",
    reading: `${V6_GATEWAY_SYSTEM_PROMPTS.reading} ${GROUNDED_VOICE}`,
    guardedReading: `${V6_GATEWAY_SYSTEM_PROMPTS.guardedReading} ${GROUNDED_VOICE}`,
    followUp: `${V6_GATEWAY_SYSTEM_PROMPTS.followUp} ${GROUNDED_VOICE}`,
    guardedFollowUp: `${V6_GATEWAY_SYSTEM_PROMPTS.guardedFollowUp} ${GROUNDED_VOICE}`,
  },
  "reader-voice-v7": {
    readingVersion: PROMPT_VERSION,
    followUpVersion: FOLLOW_UP_PROMPT_VERSION,
    ...REVIEWED_GATEWAY_SYSTEM_PROMPTS,
  },
  "reader-voice-v7-grounded": {
    readingVersion: "reader-voice-v7-grounded",
    followUpVersion: "follow-up-reader-voice-v7-grounded",
    reading: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading} ${GROUNDED_VOICE}`,
    guardedReading: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.guardedReading} ${GROUNDED_VOICE}`,
    followUp: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.followUp} ${GROUNDED_VOICE}`,
    guardedFollowUp: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.guardedFollowUp} ${GROUNDED_VOICE}`,
  },
});

export type RuntimePromptBundleId = keyof typeof RUNTIME_PROMPT_BUNDLES;

export interface GroqProviderOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly fallbackModels?: readonly string[];
  readonly baseUrl?: string;
  readonly approvedGatewayHostname?: string;
  readonly cloudflareAccessClientId?: string;
  readonly cloudflareAccessClientSecret?: string;
  readonly timeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxOutputTokens?: number;
  readonly promptBundleId?: RuntimePromptBundleId;
}

export type AiProviderEndpointKind = "direct-groq" | "access-gateway" | "invalid";

export function normalizedAiProviderBaseUrl(baseUrl?: string): string {
  return (baseUrl?.trim() || DEFAULT_GROQ_BASE_URL).replace(/\/+$/, "");
}

/**
 * Classifies the only two network paths this adapter may use.
 *
 * A custom origin is deliberately narrow: an HTTPS hostname with an exact
 * `/v1` base path. Loopback, IP literals, userinfo, query strings, fragments,
 * and local-only names are rejected before fetch can turn a configuration
 * typo into SSRF. DNS and egress policy remain mandatory at the gateway host.
 */
export function classifyAiProviderBaseUrl(baseUrl?: string): AiProviderEndpointKind {
  const normalized = normalizedAiProviderBaseUrl(baseUrl);
  if (normalized === DEFAULT_GROQ_BASE_URL) return "direct-groq";

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    const localHostname =
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname === "0.0.0.0" ||
      hostname.endsWith(".") ||
      hostname.includes(":") ||
      /^\d+(?:\.\d+){3}$/.test(hostname);
    if (
      url.protocol !== "https:" ||
      !hostname.includes(".") ||
      localHostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/v1"
    )
      return "invalid";
    return "access-gateway";
  } catch {
    return "invalid";
  }
}

function validateTransportOptions(options: GroqProviderOptions): AiProviderEndpointKind {
  const endpointKind = classifyAiProviderBaseUrl(options.baseUrl);
  const accessClientId = options.cloudflareAccessClientId?.trim();
  const accessClientSecret = options.cloudflareAccessClientSecret?.trim();
  const approvedGatewayHostname = options.approvedGatewayHostname?.trim().toLowerCase();
  if (endpointKind === "invalid") throw new Error("AI_PROVIDER_BASE_URL_INVALID");
  if (
    endpointKind === "direct-groq" &&
    (accessClientId || accessClientSecret || approvedGatewayHostname)
  )
    throw new Error("AI_PROVIDER_ACCESS_CREDENTIALS_FOR_DIRECT_GROQ");
  if (
    endpointKind === "access-gateway" &&
    (!accessClientId ||
      !accessClientSecret ||
      !approvedGatewayHostname ||
      new URL(normalizedAiProviderBaseUrl(options.baseUrl)).hostname.toLowerCase() !==
        approvedGatewayHostname)
  )
    throw new Error("AI_PROVIDER_ACCESS_CREDENTIALS_INCOMPLETE");
  return endpointKind;
}

async function readBoundedProviderJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(declared) || Number(declared) > MAX_PROVIDER_RESPONSE_BYTES)
      throw new ProviderRequestError("invalid-response");
  }
  if (!response.body) throw new ProviderRequestError("invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PROVIDER_RESPONSE_BYTES) throw new ProviderRequestError("invalid-response");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function uniqueModelChain(primary: string, fallbacks: readonly string[] = []): readonly string[] {
  return [...new Set([primary, ...fallbacks].map((model) => model.trim()).filter(Boolean))];
}

function structuredOutputMode(model: string): StructuredOutputMode {
  return JSON_OBJECT_MODELS.has(model) ? "json-object" : "strict-json-schema";
}

function shouldTryFallback(error: unknown): boolean {
  // Every candidate uses the same Groq credential. Retrying another model on
  // an authentication failure only adds latency and cannot recover the call.
  return fallbackReason(error) !== "authentication";
}

type ResolvedDraw = ReturnType<typeof resolveDraw>;

function exactCardSchema(entry: ResolvedDraw[number]): Record<string, unknown> {
  return {
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
      positionId: { type: "string", enum: [entry.position.id], minLength: 1 },
      positionLabel: { type: "string", enum: [entry.position.displayName], minLength: 1 },
      cardId: { type: "string", enum: [entry.card.id], minLength: 1 },
      orientation: { type: "string", enum: [entry.orientation] },
      coreMeaning: { type: "string", minLength: 1, maxLength: 260 },
      positionInterpretation: { type: "string", minLength: 1, maxLength: 420 },
      relationshipNotes: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 420 },
        maxItems: 12,
      },
      supportingEvidence: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 320 },
        minItems: 1,
        maxItems: 12,
      },
    },
  };
}

/** The JSON Schema the model is constrained to. Mirrors readingResultSchema. */
export function reviewedReadingResponseSchema(
  resolved: ResolvedDraw,
  configuration?: ReadingConfiguration,
): Record<string, unknown> {
  const cardCount = resolved.length;
  const exactCards = resolved.map(exactCardSchema);
  const nullableText = (allowed: boolean | undefined, maxLength: number) =>
    allowed === false
      ? { type: "null" }
      : { anyOf: [{ type: "string", minLength: 1, maxLength }, { type: "null" }] };
  const trajectoryAllowed =
    configuration === undefined || configuration.capabilities.trajectoryPositionIds.length > 0;
  const alternateAllowed =
    configuration === undefined || configuration.capabilities.alternativePositionGroups.length > 0;
  const timingAllowed =
    configuration === undefined || configuration.capabilities.timingMethod !== null;
  const personalizationAllowed =
    configuration === undefined || configuration.personalizationMode === "personalized_tarot";
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
      directAnswer: { type: "string", minLength: 1, maxLength: 480 },
      overallPattern: { type: "string", minLength: 1, maxLength: 360 },
      cards: {
        type: "array",
        items: exactCards.length === 1 ? exactCards[0] : { anyOf: exactCards },
        minItems: cardCount,
        maxItems: cardCount,
      },
      synthesis: { type: "string", minLength: 1, maxLength: 480 },
      likelyTrajectory: nullableText(trajectoryAllowed, 420),
      alternatePath: nullableText(alternateAllowed, 420),
      timing: nullableText(timingAllowed, 260),
      userAgency: { type: "string", minLength: 1, maxLength: 340 },
      reflectionPrompt: { type: "string", minLength: 1, maxLength: 220 },
      uncertaintyNote: { type: "string", minLength: 1, maxLength: 220 },
      personalizationLens: personalizationAllowed
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
                    items: { type: "string", minLength: 1, maxLength: 300 },
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

function canonicalizeProviderReading(
  value: unknown,
  resolved: ResolvedDraw,
  configuration: ReadingConfiguration,
): ReadingResult {
  const parsed = readingResultV3Schema.parse(value);
  if (parsed.cards.length !== resolved.length) throw new ProviderRequestError("invalid-response");

  const parsedByPosition = new Map(parsed.cards.map((card) => [card.positionId, card]));
  for (const entry of resolved) {
    const echoed = parsedByPosition.get(entry.position.id);
    if (
      !echoed ||
      echoed.positionLabel !== entry.position.displayName ||
      echoed.cardId !== entry.card.id ||
      echoed.orientation !== entry.orientation
    )
      throw new ProviderRequestError("invalid-response");
  }
  if (
    configuration.capabilities.trajectoryPositionIds.length === 0 &&
    parsed.likelyTrajectory !== null
  )
    throw new ProviderRequestError("invalid-response");
  if (
    configuration.capabilities.alternativePositionGroups.length === 0 &&
    parsed.alternatePath !== null
  )
    throw new ProviderRequestError("invalid-response");
  if (configuration.capabilities.timingMethod === null && parsed.timing !== null)
    throw new ProviderRequestError("invalid-response");
  if (configuration.personalizationMode === "pure_tarot" && parsed.personalizationLens !== null)
    throw new ProviderRequestError("invalid-response");

  return readingResultV3Schema.parse({
    ...parsed,
    cards: resolved.map((entry) => ({
      ...parsedByPosition.get(entry.position.id)!,
      positionId: entry.position.id,
      positionLabel: entry.position.displayName,
      cardId: entry.card.id,
      orientation: entry.orientation,
    })),
  });
}

export function reviewedFollowUpResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["response"],
    properties: { response: { type: "string", minLength: 1, maxLength: 900 } },
  };
}

export class GroqInterpretationProvider implements ReadingInterpretationProvider {
  readonly id: string;
  private readonly fallback = new DeterministicFallbackProvider();
  private readonly models: readonly string[];
  private readonly baseUrl: string;
  private readonly endpointKind: AiProviderEndpointKind;
  private readonly transportId: "direct" | "gateway";
  private readonly cloudflareAccessClientId: string | undefined;
  private readonly cloudflareAccessClientSecret: string | undefined;
  private readonly authorizationToken: string;
  private readonly promptBundle: (typeof RUNTIME_PROMPT_BUNDLES)[RuntimePromptBundleId];

  constructor(private readonly options: GroqProviderOptions) {
    this.endpointKind = validateTransportOptions(options);
    this.authorizationToken = options.apiKey.trim();
    this.transportId = this.endpointKind === "access-gateway" ? "gateway" : "direct";
    this.baseUrl = normalizedAiProviderBaseUrl(options.baseUrl);
    this.cloudflareAccessClientId = options.cloudflareAccessClientId?.trim();
    this.cloudflareAccessClientSecret = options.cloudflareAccessClientSecret?.trim();
    this.models = uniqueModelChain(options.model, options.fallbackModels);
    this.promptBundle = RUNTIME_PROMPT_BUNDLES[options.promptBundleId ?? PROMPT_VERSION];
    const transport = this.endpointKind === "access-gateway" ? "groq-gateway" : "groq";
    this.id = `${transport}:${this.models[0] ?? options.model}`;
  }

  /** The payload sent to the provider. Exposed so tests can assert what leaves. */
  buildPayload(input: ReadingGenerationInput) {
    const resolved = resolveDraw(
      input.draw,
      input.questionClassification,
      input.configuration.positions,
    );
    const answer = answerCard(input.draw, resolved);
    return {
      question: input.question,
      questionContext: input.questionClassification,
      spreadId: input.draw.spreadId,
      spreadCapabilities: input.configuration.capabilities,
      trajectoryAllowed: input.configuration.capabilities.trajectoryPositionIds.length > 0,
      alternatePathAllowed: input.configuration.capabilities.alternativePositionGroups.length > 0,
      timingAllowed: input.configuration.capabilities.timingMethod !== null,
      personalizationAllowed: input.configuration.personalizationMode === "personalized_tarot",
      answerPositionId: answer.position.id,
      cards: resolved.map((entry) => ({
        positionId: entry.position.id,
        positionName: entry.position.displayName,
        positionMeans: entry.position.interpretiveFunction,
        positionDescription: entry.position.description,
        cardId: entry.card.id,
        card: entry.card.name,
        arcana: entry.card.arcana,
        orientation: entry.orientation,
        themes: entry.themes,
        domainTags: entry.card.eventTags,
        approvedReversalFacets:
          entry.orientation === "reversed" ? (entry.card.reversalFacets ?? []) : [],
      })),
      readerLens:
        input.configuration.personalizationMode === "personalized_tarot"
          ? input.relevantTraitStatements
          : [],
    };
  }

  buildFollowUpPayload(input: FollowUpGenerationInput) {
    return {
      ...this.buildPayload(input),
      originalReading: {
        directAnswer: input.originalResult.directAnswer,
        overallPattern: input.originalResult.overallPattern,
        cards: input.originalResult.cards,
        synthesis: input.originalResult.synthesis,
        likelyTrajectory: input.originalResult.likelyTrajectory,
        alternatePath: input.originalResult.alternatePath,
        userAgency: input.originalResult.userAgency,
      },
    };
  }

  async generate(input: ReadingGenerationInput, signal?: AbortSignal): Promise<ReadingResult> {
    return (await this.generateWithProvenance(input, signal)).result;
  }

  async generateWithProvenance(
    input: ReadingGenerationInput,
    signal?: AbortSignal,
  ): Promise<ReadingGenerationOutcome> {
    try {
      const generated = await this.withModelFallback(
        (model, mode, timeoutMs) => this.callProvider(input, model, mode, timeoutMs, signal),
        signal,
      );
      return {
        result: generated.value,
        provenance: {
          providerId:
            this.transportId === "gateway"
              ? `groq-gateway:${generated.model}`
              : `groq:${generated.model}`,
          promptVersion: this.promptBundle.readingVersion,
          schemaVersion: RESPONSE_SCHEMA_VERSION,
        },
      };
    } catch (error) {
      // A person who asked a question gets a reading either way (AI-015).
      const generated = await this.fallback.generateWithProvenance(input);
      return {
        ...generated,
        provenance: {
          ...generated.provenance,
          // The output remains deterministic, while this fixed identifier says
          // why the configured live path did not produce it. It contains no
          // response body, request data, credential, URL or exception text.
          providerId:
            this.transportId === "gateway"
              ? `${FALLBACK_PROVIDER_ID}:after-groq-gateway-${fallbackReason(error)}`
              : `${FALLBACK_PROVIDER_ID}:after-groq-${fallbackReason(error)}`,
        },
      };
    }
  }

  async generateFollowUp(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpResult> {
    return (await this.generateFollowUpWithProvenance(input, signal)).result;
  }

  async generateFollowUpWithProvenance(
    input: FollowUpGenerationInput,
    signal?: AbortSignal,
  ): Promise<FollowUpGenerationOutcome> {
    try {
      const generated = await this.withModelFallback(
        (model, mode, timeoutMs) =>
          this.callFollowUpProvider(input, model, mode, timeoutMs, signal),
        signal,
      );
      return {
        result: generated.value,
        provenance: {
          providerId:
            this.transportId === "gateway"
              ? `groq-gateway:${generated.model}`
              : `groq:${generated.model}`,
          promptVersion: this.promptBundle.followUpVersion,
          schemaVersion: "follow-up-result-v1",
        },
      };
    } catch (error) {
      const generated = await this.fallback.generateFollowUpWithProvenance(input);
      return {
        ...generated,
        provenance: {
          ...generated.provenance,
          providerId:
            this.transportId === "gateway"
              ? `${FALLBACK_PROVIDER_ID}:after-groq-gateway-${fallbackReason(error)}`
              : `${FALLBACK_PROVIDER_ID}:after-groq-${fallbackReason(error)}`,
        },
      };
    }
  }

  private async withModelFallback<T>(
    attempt: (model: string, mode: StructuredOutputMode, timeoutMs: number) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<{ value: T; model: string }> {
    const attemptTimeoutMs = positiveTimeout(this.options.timeoutMs, DEFAULT_ATTEMPT_TIMEOUT_MS);
    const totalTimeoutMs = positiveTimeout(this.options.totalTimeoutMs, DEFAULT_TOTAL_TIMEOUT_MS);
    const deadline = Date.now() + totalTimeoutMs;
    let lastError: unknown = new ProviderRequestError("unknown");

    for (const model of this.models) {
      if (signal?.aborted) throw new ProviderRequestError("request-timeout");
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) throw new ProviderRequestError("request-timeout");
      try {
        return {
          value: await attempt(
            model,
            structuredOutputMode(model),
            Math.min(attemptTimeoutMs, remainingMs),
          ),
          model,
        };
      } catch (error) {
        lastError = error;
        if (signal?.aborted || !shouldTryFallback(error)) throw error;
      }
    }
    throw lastError;
  }

  private async callProvider(
    input: ReadingGenerationInput,
    model: string,
    mode: StructuredOutputMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ReadingResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
    const resolved = resolveDraw(
      input.draw,
      input.questionClassification,
      input.configuration.positions,
    );
    const parsed = canonicalizeProviderReading(
      await this.requestStructured(
        guarded ? this.promptBundle.guardedReading : this.promptBundle.reading,
        this.buildPayload(input),
        "reading",
        reviewedReadingResponseSchema(resolved, input.configuration),
        this.options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        model,
        mode,
        timeoutMs,
        signal,
      ),
      resolved,
      input.configuration,
    );
    if (generatedOutputSafetyViolation(parsed)) throw new ProviderRequestError("unsafe-response");
    return readingResultV3Schema.parse({
      ...parsed,
      safetyFlags: safety.category === "ordinary" ? parsed.safetyFlags : [safety.category],
    });
  }

  private async callFollowUpProvider(
    input: FollowUpGenerationInput,
    model: string,
    mode: StructuredOutputMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<FollowUpResult> {
    const safety = classifyQuestion(input.question);
    const guarded = GUARDED_CATEGORIES.has(safety.category);
    const system = guarded ? this.promptBundle.guardedFollowUp : this.promptBundle.followUp;
    const parsed = followUpResultSchema.parse(
      await this.requestStructured(
        system,
        this.buildFollowUpPayload(input),
        "follow_up",
        reviewedFollowUpResponseSchema(),
        Math.min(this.options.maxOutputTokens ?? 900, 1_200),
        model,
        mode,
        timeoutMs,
        signal,
      ),
    );
    if (generatedOutputSafetyViolation(parsed)) throw new ProviderRequestError("unsafe-response");
    return parsed;
  }

  private async requestStructured(
    system: string,
    payload: unknown,
    schemaName: string,
    schema: Record<string, unknown>,
    maxOutputTokens: number,
    model: string,
    mode: StructuredOutputMode,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);

    const modelSystem =
      mode === "json-object"
        ? `${system} Return only one JSON object matching this JSON Schema exactly: ${JSON.stringify(schema)}`
        : system;
    const responseFormat =
      mode === "json-object"
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: { name: schemaName, strict: true, schema },
          };

    try {
      const headers = new Headers({
        authorization: `Bearer ${this.authorizationToken}`,
        "content-type": "application/json",
      });
      if (this.endpointKind === "access-gateway") {
        headers.set("CF-Access-Client-Id", this.cloudflareAccessClientId ?? "");
        headers.set("CF-Access-Client-Secret", this.cloudflareAccessClientSecret ?? "");
      }
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: 0.85,
          max_completion_tokens: maxOutputTokens,
          ...(model.startsWith(GPT_OSS_MODEL_PREFIX)
            ? { reasoning_effort: "low", include_reasoning: false }
            : {}),
          messages: [
            { role: "system", content: modelSystem },
            { role: "user", content: JSON.stringify(payload) },
          ],
          response_format: responseFormat,
        }),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const reason: FallbackReason =
          response.status === 401
            ? "authentication"
            : response.status === 429
              ? "rate-limited"
              : response.status >= 500
                ? "provider-unavailable"
                : "request-rejected";
        throw new ProviderRequestError(reason);
      }
      const body = (await readBoundedProviderJson(response)) as {
        choices?: {
          finish_reason?: string | null;
          message?: { content?: string };
        }[];
      };
      const choice = body.choices?.[0];
      if (choice?.finish_reason !== undefined && choice.finish_reason !== "stop")
        throw new ProviderRequestError("invalid-response");
      const content = choice?.message?.content;
      if (!content) throw new ProviderRequestError("invalid-response");

      return JSON.parse(content) as unknown;
    } catch (error) {
      if (controller.signal.aborted) throw new ProviderRequestError("request-timeout");
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}
