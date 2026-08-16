import { randomUUID } from "node:crypto";

/**
 * Generates credentials for synthetic verification identities.
 *
 * The password length is the whole point of this module. bcrypt consumes at
 * most 72 bytes, and Supabase Auth refuses a longer password rather than
 * silently truncating it — answering `unexpected_failure` with HTTP 500, which
 * is indistinguishable from a database fault.
 *
 * The previous generator concatenated two UUIDs onto a prefix, producing 75
 * bytes. Every synthetic identity therefore failed to be created, and the
 * failure was mistaken in turn for a row level security conflict, a leftover
 * trigger, and a rejected address before the length was measured.
 *
 * One UUID is 122 bits of entropy, which is far more than this needs, and
 * leaves the result comfortably inside the limit.
 */
export const MAX_PROVIDER_PASSWORD_BYTES = 72;

export function syntheticPassword(): string {
  const password = `Sg!${randomUUID()}`;
  if (Buffer.byteLength(password, "utf8") > MAX_PROVIDER_PASSWORD_BYTES)
    throw new Error(
      `A synthetic password of ${Buffer.byteLength(password, "utf8")} bytes exceeds the ` +
        `${MAX_PROVIDER_PASSWORD_BYTES}-byte limit the provider enforces.`,
    );
  return password;
}
