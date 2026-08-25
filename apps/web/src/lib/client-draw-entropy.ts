const CLIENT_NONCE_BYTES = 32;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type ClientRandomBytes = (length: number) => Uint8Array;

function secureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function requireNonceBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.length !== CLIENT_NONCE_BYTES) {
    throw new Error(`Client draw entropy must contain exactly ${CLIENT_NONCE_BYTES} bytes`);
  }
  return bytes;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += 3) {
    const first = bytes[offset] ?? 0;
    const second = bytes[offset + 1] ?? 0;
    const third = bytes[offset + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;
    encoded += BASE64URL_ALPHABET[(packed >>> 18) & 63];
    encoded += BASE64URL_ALPHABET[(packed >>> 12) & 63];
    if (offset + 1 < bytes.length) encoded += BASE64URL_ALPHABET[(packed >>> 6) & 63];
    if (offset + 2 < bytes.length) encoded += BASE64URL_ALPHABET[packed & 63];
  }
  return encoded;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("Client draw entropy must be canonical base64url");
  }
  const bytes = new Uint8Array(CLIENT_NONCE_BYTES);
  let accumulator = 0;
  let bitCount = 0;
  let byteIndex = 0;

  for (const character of value) {
    accumulator = (accumulator << 6) | BASE64URL_ALPHABET.indexOf(character);
    bitCount += 6;
    if (bitCount < 8) continue;
    bitCount -= 8;
    bytes[byteIndex] = (accumulator >>> bitCount) & 255;
    byteIndex += 1;
    accumulator &= (1 << bitCount) - 1;
  }

  if (byteIndex !== CLIENT_NONCE_BYTES || accumulator !== 0) {
    throw new Error("Client draw entropy must be canonical base64url");
  }
  return bytes;
}

/** Creates the secure client half of the committed draw before the ritual starts. */
export function createClientDrawNonce(randomBytes: ClientRandomBytes = secureRandomBytes): string {
  return encodeBase64Url(requireNonceBytes(randomBytes(CLIENT_NONCE_BYTES)));
}

export function isClientDrawNonce(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    decodeBase64Url(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mixes another independent browser-random value into the pending nonce. XOR
 * keeps the result uniform if either contribution is uniform, so stirring can
 * add agency without weakening or replacing the original CSPRNG value.
 */
export function stirClientDrawNonce(
  currentNonce: string,
  randomBytes: ClientRandomBytes = secureRandomBytes,
): string {
  const current = decodeBase64Url(currentNonce);
  const contribution = requireNonceBytes(randomBytes(CLIENT_NONCE_BYTES));
  return encodeBase64Url(current.map((byte, index) => byte ^ (contribution[index] ?? 0)));
}
