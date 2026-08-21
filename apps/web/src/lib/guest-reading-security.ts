import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";

import {
  guestDeviceIdSchema,
  guestReceiptPayloadSchema,
  type GuestReceiptPayload,
} from "./guest-reading-contract";

export const GUEST_TRIAL_COOKIE = "starguidance_guest_trial";
export const GUEST_TRIAL_COOKIE_TTL_SECONDS = 365 * 24 * 60 * 60;
export const GUEST_READING_RECEIPT_TTL_SECONDS = 7 * 24 * 60 * 60;

const RECEIPT_CONTEXT = Buffer.from("starguidance:guest-reading-receipt:v1", "utf8");

const markerSchema = z
  .object({
    version: z.literal("guest-trial-marker-v1"),
    deviceHash: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export class GuestTrialConfigurationError extends Error {
  constructor() {
    super("GUEST_TRIAL_SECRET must be canonical base64 for exactly 32 bytes.");
    this.name = "GuestTrialConfigurationError";
  }
}

export function isValidGuestTrialSecret(encoded: string | undefined): boolean {
  if (!encoded || encoded !== encoded.trim()) return false;
  const decoded = Buffer.from(encoded, "base64");
  return decoded.length === 32 && decoded.toString("base64") === encoded;
}

function guestSecret(): Buffer {
  const encoded = process.env.GUEST_TRIAL_SECRET;
  if (!encoded || !isValidGuestTrialSecret(encoded)) throw new GuestTrialConfigurationError();
  return Buffer.from(encoded, "base64");
}

function derivedKey(purpose: "device" | "marker" | "network" | "receipt"): Buffer {
  return createHmac("sha256", guestSecret())
    .update(`starguidance:guest-key:${purpose}:v1`)
    .digest();
}

export function assertGuestTrialConfigured(): void {
  void guestSecret();
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

export function issueGuestTrialMarker(deviceId: string, now = Date.now()): string {
  const payload = markerSchema.parse({
    version: "guest-trial-marker-v1",
    deviceHash: deviceHash(deviceId),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GUEST_TRIAL_COOKIE_TTL_SECONDS * 1_000).toISOString(),
  });
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `v1.${encoded}.${hmac(`marker:${encoded}`).toString("base64url")}`;
}

export function verifyGuestTrialMarker(
  marker: string | undefined,
  deviceId: string,
  now = Date.now(),
): boolean {
  if (!marker) return false;
  const [version, encoded, signature, extra] = marker.split(".");
  if (version !== "v1" || !encoded || !signature || extra) return false;
  try {
    const encodedPayload = decodeCanonicalBase64url(encoded);
    const decodedSignature = decodeCanonicalBase64url(signature);
    if (!encodedPayload || !decodedSignature) return false;
    if (!safeEqual(decodedSignature, hmac(`marker:${encoded}`))) return false;
    const payload = markerSchema.parse(JSON.parse(encodedPayload.toString("utf8")));
    return payload.deviceHash === deviceHash(deviceId) && Date.parse(payload.expiresAt) > now;
  } catch {
    return false;
  }
}

export function issueGuestReadingReceipt(
  payload: Omit<GuestReceiptPayload, "version" | "expiresAt">,
  now = Date.now(),
): { expiresAt: string; receipt: string } {
  const expiresAt = new Date(now + GUEST_READING_RECEIPT_TTL_SECONDS * 1_000).toISOString();
  const validated = guestReceiptPayloadSchema.parse({
    ...payload,
    version: "guest-reading-receipt-v1",
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
