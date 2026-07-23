import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = 1;

export function encryptSensitive(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
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
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to exactly 32 bytes");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedNonce, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
