import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { z } from "zod";
import {
  birthDateSchema,
  drawCeremonySchema,
  personalizationModeSchema,
  questionClassificationSchema,
  readingConfigurationSchema,
  reversalModeSchema,
  spreadCapabilitySnapshotSchema,
  spreadPositionSnapshotSchema,
  type DrawCeremony,
  type QuestionClassification,
  type ReadingConfiguration,
} from "@starguidance/contracts";
import {
  commitDrawServerSeed,
  createDrawServerSeed,
  type Spread,
} from "@starguidance/tarot-domain";

import {
  GUEST_HANDOFF_PATTERN,
  guestDeviceIdSchema,
  guestDrawSchema,
  guestReceiptPayloadSchema,
  type GuestReceiptPayload,
} from "./guest-reading-contract";

export const GUEST_TRIAL_COOKIE = "starguidance_guest_trial";
export const GUEST_TRIAL_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
export const GUEST_READING_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

export type GuestTrialKeySource =
  "dedicated" | "netlify-deploy-preview-derived" | "netlify-production-derived";

const RECEIPT_CONTEXT = Buffer.from("starguidance:guest-reading-receipt:v2", "utf8");
const CEREMONY_CONTEXT = Buffer.from("starguidance:guest-draw-ceremony:v1", "utf8");
const HANDOFF_CONTEXT = Buffer.from("starguidance:guest-reading-handoff:v1", "utf8");
const netlifySiteIdSchema = z.string().uuid();
const netlifyReviewIdSchema = z.string().regex(/^[1-9]\d{0,19}$/);

/**
 * The exact inputs that locked this browser's free draw. Recording them in the
 * signed trial marker makes finalize idempotent per ceremony without server
 * state: a repeated finalize for the same ceremony recomputes the identical
 * draw from the sealed server seed plus these recorded inputs, whatever nonce
 * or picks the repeat request carries. It never enables a second, different
 * draw.
 */
const markerDrawSchema = z
  .object({
    ceremonyId: z.string().uuid(),
    clientNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    cutIndex: z.number().int().min(0).max(77),
    selectedIndexes: z.array(z.number().int().min(0).max(77)).min(1).max(10).optional(),
    lockedAt: z.string().datetime(),
    pureTarotFallback: z.boolean().optional(),
  })
  .strict();

export type GuestTrialMarkerDraw = z.infer<typeof markerDrawSchema>;

const markerSchema = z
  .object({
    version: z.literal("guest-trial-marker-v1"),
    deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    draw: markerDrawSchema.optional(),
  })
  .strict();

export type GuestTrialMarker = z.infer<typeof markerSchema>;

export class GuestTrialConfigurationError extends Error {
  constructor() {
    super(
      "Guest trial key material is unavailable or invalid. Configure a canonical base64 32-byte GUEST_TRIAL_SECRET.",
    );
    this.name = "GuestTrialConfigurationError";
  }
}

export function isValidGuestTrialSecret(encoded: string | undefined): boolean {
  if (!encoded || encoded !== encoded.trim()) return false;
  const decoded = Buffer.from(encoded, "base64");
  return decoded.length === 32 && decoded.toString("base64") === encoded;
}

function decodeDataEncryptionKey(encoded: string | undefined): Buffer | undefined {
  if (!encoded || encoded !== encoded.trim()) return undefined;
  const decoded = Buffer.from(encoded, "base64");
  const canonical = decoded.toString("base64");
  return decoded.length === 32 && canonical.replace(/=+$/, "") === encoded.replace(/=+$/, "")
    ? decoded
    : undefined;
}

function deployPreviewSecret(): Buffer | undefined {
  if (process.env.APP_ENV !== "staging") return undefined;
  const siteId = netlifySiteIdSchema.safeParse(process.env.SITE_ID);
  const reviewId = netlifyReviewIdSchema.safeParse(process.env.GUEST_TRIAL_PREVIEW_ID);
  const encryptionRoot = decodeDataEncryptionKey(process.env.DATA_ENCRYPTION_KEY);
  if (!siteId.success || !reviewId.success || !encryptionRoot) return undefined;
  return createHmac("sha256", encryptionRoot)
    .update(`starguidance:guest-preview-root:v1:site:${siteId.data}:review:${reviewId.data}`)
    .digest();
}

function productionSecret(): Buffer | undefined {
  if (
    process.env.APP_ENV !== "production" ||
    process.env.GUEST_TRIAL_PRODUCTION_BUILD !== "netlify-production-v1"
  )
    return undefined;
  const siteId = netlifySiteIdSchema.safeParse(process.env.SITE_ID);
  const encryptionRoot = decodeDataEncryptionKey(process.env.DATA_ENCRYPTION_KEY);
  if (!siteId.success || !encryptionRoot) return undefined;
  return createHmac("sha256", encryptionRoot)
    .update(`starguidance:guest-production-root:v1:site:${siteId.data}`)
    .digest();
}

function guestSecretResolution(): { secret: Buffer; source: GuestTrialKeySource } {
  const encoded = process.env.GUEST_TRIAL_SECRET;
  if (encoded) {
    if (!isValidGuestTrialSecret(encoded)) throw new GuestTrialConfigurationError();
    return { secret: Buffer.from(encoded, "base64"), source: "dedicated" };
  }
  const previewSecret = deployPreviewSecret();
  if (previewSecret) return { secret: previewSecret, source: "netlify-deploy-preview-derived" };
  const deployedProductionSecret = productionSecret();
  if (deployedProductionSecret)
    return { secret: deployedProductionSecret, source: "netlify-production-derived" };
  throw new GuestTrialConfigurationError();
}

function guestSecret(): Buffer {
  return guestSecretResolution().secret;
}

function derivedKey(
  purpose: "device" | "marker" | "network" | "receipt" | "ceremony" | "handoff",
): Buffer {
  return createHmac("sha256", guestSecret())
    .update(`starguidance:guest-key:${purpose}:v1`)
    .digest();
}

export function assertGuestTrialConfigured(): void {
  void guestSecret();
}

export function guestTrialKeySource(): GuestTrialKeySource {
  return guestSecretResolution().source;
}

function hmac(value: string): Buffer {
  return createHmac("sha256", derivedKey("marker")).update(value).digest();
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function decodeCanonicalBase64url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : undefined;
}

function deviceHash(deviceId: string): string {
  return createHmac("sha256", derivedKey("device"))
    .update(`starguidance:guest-device:v1:${guestDeviceIdSchema.parse(deviceId)}`)
    .digest("hex");
}

export function issueGuestTrialMarker(
  deviceId: string,
  now = Date.now(),
  draw?: GuestTrialMarkerDraw,
): string {
  const payload = markerSchema.parse({
    version: "guest-trial-marker-v1",
    deviceHash: deviceHash(deviceId),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GUEST_TRIAL_COOKIE_TTL_SECONDS * 1_000).toISOString(),
    ...(draw ? { draw } : {}),
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${encoded}.${hmac(`marker:${encoded}`).toString("base64url")}`;
}

/** Returns the verified marker payload for this browser, or undefined. */
export function readGuestTrialMarker(
  marker: string | undefined,
  deviceId: string,
  now = Date.now(),
): GuestTrialMarker | undefined {
  if (!marker) return undefined;
  const [version, encoded, signature, extra] = marker.split(".");
  if (version !== "v1" || !encoded || !signature || extra) return undefined;
  try {
    const encodedPayload = decodeCanonicalBase64url(encoded);
    const decodedSignature = decodeCanonicalBase64url(signature);
    if (!encodedPayload || !decodedSignature) return undefined;
    if (!safeEqual(decodedSignature, hmac(`marker:${encoded}`))) return undefined;
    const payload = markerSchema.parse(JSON.parse(encodedPayload.toString("utf8")));
    return payload.deviceHash === deviceHash(deviceId) && Date.parse(payload.expiresAt) > now
      ? payload
      : undefined;
  } catch {
    return undefined;
  }
}

export function verifyGuestTrialMarker(
  marker: string | undefined,
  deviceId: string,
  now = Date.now(),
): boolean {
  return readGuestTrialMarker(marker, deviceId, now) !== undefined;
}

const guestPrivateCeremonySchema = z
  .object({
    version: z.literal("guest-draw-ceremony-v1"),
    deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
    readingId: z.string().uuid(),
    deckVersion: z.string().min(1),
    birthDate: birthDateSchema.optional(),
    question: z.string().min(1).max(500),
    questionClassification: questionClassificationSchema,
    configuration: readingConfigurationSchema,
    spread: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        purpose: z.string().min(1),
        estimatedMinutes: z.number().int().positive(),
        entitlementClass: z.literal("standard"),
        version: z.string().min(1),
        allowReversals: z.boolean(),
        optionalCut: z.boolean(),
        layout: z
          .object({
            columns: z.number().int().positive(),
            rows: z.number().int().positive(),
            kind: z.enum([
              "centered",
              "horizontal",
              "celtic-cross",
              "horseshoe",
              "relationship",
              "matrix",
              "legacy",
            ]),
          })
          .strict(),
        positions: z.array(spreadPositionSnapshotSchema).min(1).max(10).readonly(),
        capabilities: spreadCapabilitySnapshotSchema,
      })
      .strict(),
    serverSeed: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    serverSeedCommitment: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type GuestPrivateDrawCeremony = z.infer<typeof guestPrivateCeremonySchema>;

function sealCeremony(ceremony: GuestPrivateDrawCeremony): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("ceremony"), nonce);
  cipher.setAAD(CEREMONY_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(ceremony), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function publicGuestDrawCeremony(
  ceremony: GuestPrivateDrawCeremony,
  token: string,
): DrawCeremony {
  return drawCeremonySchema.parse({
    version: "draw-ceremony-v1",
    sessionId: ceremony.readingId,
    token,
    deckVersion: ceremony.deckVersion,
    serverSeedCommitment: ceremony.serverSeedCommitment,
    expiresAt: ceremony.expiresAt,
    question: ceremony.question,
    spread: {
      id: ceremony.spread.id,
      version: ceremony.spread.version,
      name: ceremony.spread.name,
      positions: ceremony.configuration.positions,
    },
    configuration: ceremony.configuration,
  });
}

export function issueGuestDrawCeremony(input: {
  deviceId: string;
  deckVersion: string;
  birthDate?: string | undefined;
  question: string;
  questionClassification: QuestionClassification;
  configuration: ReadingConfiguration;
  spread: Spread;
  now?: Date;
}): { ceremony: DrawCeremony; privateCeremony: GuestPrivateDrawCeremony } {
  const now = input.now ?? new Date();
  const serverSeed = createDrawServerSeed();
  const privateCeremony = guestPrivateCeremonySchema.parse({
    version: "guest-draw-ceremony-v1",
    deviceHash: deviceHash(input.deviceId),
    readingId: randomUUID(),
    deckVersion: input.deckVersion,
    ...(input.birthDate ? { birthDate: input.birthDate } : {}),
    question: input.question,
    questionClassification: input.questionClassification,
    configuration: input.configuration,
    spread: {
      ...input.spread,
      capabilities: input.configuration.capabilities,
      positions: input.configuration.positions,
    },
    serverSeed,
    serverSeedCommitment: commitDrawServerSeed(serverSeed),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1_000).toISOString(),
  });
  const token = sealCeremony(privateCeremony);
  return { privateCeremony, ceremony: publicGuestDrawCeremony(privateCeremony, token) };
}

export function verifyGuestDrawCeremony(
  token: string,
  expectedDeviceId: string,
  now = Date.now(),
): GuestPrivateDrawCeremony | undefined {
  if (token.length > 65_536) return undefined;
  const [version, nonceValue, ciphertextValue, tagValue, extra] = token.split(".");
  if (version !== "v1" || !nonceValue || !ciphertextValue || !tagValue || extra) return undefined;
  try {
    const nonce = decodeCanonicalBase64url(nonceValue);
    const ciphertext = decodeCanonicalBase64url(ciphertextValue);
    const tag = decodeCanonicalBase64url(tagValue);
    if (!nonce || !ciphertext || !tag || nonce.length !== 12 || tag.length !== 16) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", derivedKey("ceremony"), nonce);
    decipher.setAAD(CEREMONY_CONTEXT);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    const ceremony = guestPrivateCeremonySchema.parse(JSON.parse(plaintext));
    if (
      ceremony.deviceHash !== deviceHash(expectedDeviceId) ||
      Date.parse(ceremony.expiresAt) <= now ||
      commitDrawServerSeed(ceremony.serverSeed) !== ceremony.serverSeedCommitment
    )
      return undefined;
    return ceremony;
  } catch {
    return undefined;
  }
}

export function issueGuestReadingReceipt(
  payload: Omit<GuestReceiptPayload, "version" | "expiresAt">,
  now = Date.now(),
): { expiresAt: string; receipt: string } {
  const expiresAt = new Date(now + GUEST_READING_RECEIPT_TTL_SECONDS * 1_000).toISOString();
  const validated = guestReceiptPayloadSchema.parse({
    ...payload,
    version: "guest-reading-receipt-v2",
    expiresAt,
  });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("receipt"), nonce);
  cipher.setAAD(RECEIPT_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(validated), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    expiresAt,
    receipt: [
      "v1",
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join("."),
  };
}

export function verifyGuestReadingReceipt(
  receipt: string,
  now = Date.now(),
): GuestReceiptPayload | undefined {
  if (receipt.length > 65_536) return undefined;
  const [version, nonceValue, ciphertextValue, tagValue, extra] = receipt.split(".");
  if (version !== "v1" || !nonceValue || !ciphertextValue || !tagValue || extra) return undefined;
  try {
    const nonce = decodeCanonicalBase64url(nonceValue);
    const ciphertext = decodeCanonicalBase64url(ciphertextValue);
    const tag = decodeCanonicalBase64url(tagValue);
    if (!nonce || !ciphertext || !tag || nonce.length !== 12 || tag.length !== 16) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", derivedKey("receipt"), nonce);
    decipher.setAAD(RECEIPT_CONTEXT);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    const payload = guestReceiptPayloadSchema.parse(JSON.parse(plaintext));
    return Date.parse(payload.expiresAt) > now ? payload : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A compact, encrypted reference to a guest reading, small enough to ride in a
 * confirmation-email link (the full receipt is ~10 KB). It carries the locked
 * draw and the inputs needed to regenerate the deterministic interpretation,
 * never the birthday. Redeeming it still requires a signed-in account.
 */
const handoffPayloadSchema = z
  .object({
    version: z.literal("guest-reading-handoff-v1"),
    readingId: z.string().uuid(),
    question: z.string().min(1).max(500),
    questionClassification: questionClassificationSchema,
    reversalMode: reversalModeSchema,
    personalizationMode: personalizationModeSchema,
    readerLens: z.array(z.string().min(1)).max(4).readonly(),
    draw: guestDrawSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export type GuestReadingHandoff = z.infer<typeof handoffPayloadSchema>;

export function issueGuestReadingHandoff(receipt: GuestReceiptPayload): string {
  const payload = handoffPayloadSchema.parse({
    version: "guest-reading-handoff-v1",
    readingId: receipt.readingId,
    question: receipt.question,
    questionClassification: receipt.questionClassification,
    reversalMode: receipt.configuration.reversalMode,
    personalizationMode: receipt.configuration.personalizationMode,
    readerLens: receipt.readerLens,
    draw: receipt.draw,
    createdAt: receipt.createdAt,
    expiresAt: receipt.expiresAt,
  });
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("handoff"), nonce);
  cipher.setAAD(HANDOFF_CONTEXT);
  const ciphertext = Buffer.concat([
    cipher.update(deflateRawSync(Buffer.from(JSON.stringify(payload), "utf8"))),
    cipher.final(),
  ]);
  return [
    "h1",
    nonce.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

export function verifyGuestReadingHandoff(
  token: string,
  now = Date.now(),
): GuestReadingHandoff | undefined {
  if (token.length > 8_192 || !GUEST_HANDOFF_PATTERN.test(token)) return undefined;
  const [, nonceValue = "", ciphertextValue = "", tagValue = ""] = token.split(".");
  try {
    const nonce = decodeCanonicalBase64url(nonceValue);
    const ciphertext = decodeCanonicalBase64url(ciphertextValue);
    const tag = decodeCanonicalBase64url(tagValue);
    if (!nonce || !ciphertext || !tag || nonce.length !== 12 || tag.length !== 16) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", derivedKey("handoff"), nonce);
    decipher.setAAD(HANDOFF_CONTEXT);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const payload = handoffPayloadSchema.parse(
      JSON.parse(inflateRawSync(compressed, { maxOutputLength: 32_768 }).toString("utf8")),
    );
    return Date.parse(payload.expiresAt) > now ? payload : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Produces an opaque bucket for the shared distributed limiter. The trusted
 * edge address is HMACed before it reaches request-security, which hashes the
 * complete key again before database storage. An unresolved address opts out
 * so an unconfigured proxy cannot collapse every visitor into one quota.
 */
export function guestTrialNetworkRateLimitKey(clientKey: string): string | undefined {
  if (clientKey === "client:unresolved") return undefined;
  const digest = createHmac("sha256", derivedKey("network"))
    .update(`starguidance:guest-network:v1:${clientKey}`)
    .digest("hex");
  return `guest-trial:${digest}`;
}
