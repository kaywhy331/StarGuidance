import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;

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

export function encryptSensitive(plaintext: string, base64Key: string): string {
  const key = keyBytes(base64Key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    nonce.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSensitive(envelope: string, base64Key: string): string {
  const [version, encodedNonce, encodedTag, encodedCiphertext] = envelope.split(".");
  if (
    version !== String(VERSION) ||
    !encodedNonce ||
    !encodedTag ||
    encodedCiphertext === undefined
  )
    throw new Error("Invalid encrypted envelope");
  const key = keyBytes(base64Key);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedNonce, "base64url"));
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
export function decryptSensitiveWithKeys(envelope: string, base64Keys: readonly string[]): string {
  const keys = [...new Set(base64Keys)];
  if (keys.length === 0) throw new Error("No data-encryption keys are configured");
  for (const key of keys) {
    try {
      return decryptSensitive(envelope, key);
    } catch {
      // Try the next explicitly managed key. No key or provider detail escapes.
    }
  }
  throw new Error("Encrypted envelope could not be authenticated by the configured keyring");
}
