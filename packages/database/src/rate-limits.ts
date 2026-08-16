import type { DatabaseClient, DatabaseTransaction } from "./postgres-client";

export interface RateLimitCheck {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Atomic Postgres-backed check-and-increment for a fixed rate-limit window.
 * `client` may be a pooled client or an open transaction — the caller owns
 * connection/transaction lifecycle; this does one round trip and nothing
 * else. `keyHash` must already be hashed by the caller (see
 * apps/web/src/lib/request-security.ts) — this module never sees a raw
 * rate-limit key.
 */
export async function checkRateLimit(
  client: DatabaseClient | DatabaseTransaction,
  keyHash: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitCheck> {
  const [row] = await client<{ allowed: boolean; retry_after_seconds: number }[]>`
    select * from check_rate_limit(${keyHash}, ${limit}, ${windowMs})
  `;
  if (!row) throw new Error("check_rate_limit returned no row.");
  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds };
}
