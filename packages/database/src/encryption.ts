import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Envelope v1 carried no associated data: any envelope decrypted in any row,
 * so a database-level writer could splice one user's ciphertext into another
 * user's row (or a question into a birth-profile column) without failing
 * authentication. v2 binds the ciphertext to an AAD context — by convention
 * `<data-class>:<owner user id>` (see apps/web/src/lib/persistence.ts) — so
 * a spliced envelope fails the GCM tag check instead of decrypting.
 *
 * v1 envelopes remain readable (the legacy branch below) until the next key
 * rotation re-encrypts them as v2; new writes are always v2. The residual
 * boundary: two envelopes of the same class owned by the same user remain
 * interchangeable — the row id is not in the context because several classes
 * are encrypted before their row exists (and the profile-input envelope is
 * deliberately stored in two tables).
 */
const LEGACY_VERSION = 1;
const VERSION = 2;

export function isValidEncryptionKey(base64Key: string): boolean {
  if (base64Key !== base64Key.trim()) return false;
  try {
    const key = Buffer.from(base64Key, "base64");
    return (
      key.length === 32 &&
      key.toString("base64").replace(/=+$/, "") === base64Key.replace(/=+$/, "")
    );
  } catch {
    return false;
  }
}

function keyBytes(base64Key: string): Buffer {
  if (!isValidEncryptionKey(base64Key))
    throw new Error("DATA_ENCRYPTION_KEY must be canonical base64 for exactly 32 bytes");
  return Buffer.from(base64Key, "base64");
}

function requireContext(aadContext: string): Buffer {
  if (!aadContext) throw new Error("An AAD context is required to bind this envelope");
  return Buffer.from(aadContext, "utf8");
}

/**
 * True for a v1 (pre-AAD) envelope. The rotation tool uses this to rewrite
 * legacy envelopes as context-bound v2 even when they already authenticate
 * under the current key — the rotation window is the migration path.
 */
export function isLegacyEnvelope(envelope: string): boolean {
  return envelope.startsWith(`${LEGACY_VERSION}.`);
}

export function encryptSensitive(plaintext: string, base64Key: string, aadContext: string): string {
  const key = keyBytes(base64Key);
  const context = requireContext(aadContext);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(context);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSensitive(envelope: string, base64Key: string, aadContext: string): string {
  const [version, encodedNonce, encodedTag, encodedCiphertext] = envelope.split(".");
  const bound = version === String(VERSION);
  if (
    (!bound && version !== String(LEGACY_VERSION)) ||
    !encodedNonce ||
    !encodedTag ||
    encodedCiphertext === undefined
  )
    throw new Error("Invalid encrypted envelope");
  const key = keyBytes(base64Key);
  const context = requireContext(aadContext);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedNonce, "base64url"));
  // Legacy v1 rows predate context binding; they authenticate without AAD
  // until rotation rewrites them. The context argument is still required so
  // no call site can forget to declare what the data is.
  if (bound) decipher.setAAD(context);
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Supports a zero-downtime rotation window: new writes use the current key,
 * while reads try current then explicitly configured previous keys. The
 * envelope contains no key identifier, so ciphertext never reveals rotation
 * metadata and old rows can be found only by authenticated decryption.
 */
export function decryptSensitiveWithKeys(
  envelope: string,
  base64Keys: readonly string[],
  aadContext: string,
): string {
  const keys = [...new Set(base64Keys)];
  if (keys.length === 0) throw new Error("No data-encryption keys are configured");
  for (const key of keys) {
    try {
      return decryptSensitive(envelope, key, aadContext);
    } catch {
      // Try the next explicitly managed key. No key or provider detail escapes.
    }
  }
  throw new Error("Encrypted envelope could not be authenticated by the configured keyring");
}
