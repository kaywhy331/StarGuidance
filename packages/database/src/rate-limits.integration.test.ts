import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseTransaction } from "./postgres-client";
import { checkRateLimit } from "./rate-limits";
import { systemTransaction } from "./system-transaction";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;

/**
 * rate_limit_buckets is not user-row-scoped (migration 0006), so this only
 * needs systemTransaction's starguidance_app binding — unlike
 * repositories.integration.test.ts's `asUser`, there is no
 * request.jwt.claim.sub subject to bind.
 */
async function asApp<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return systemTransaction(sql, work);
}

describeDatabase("Postgres-backed rate limiting", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it("allows up to the limit within a window and denies the next request", async () => {
    const windowMs = 5 * 60_000;
    let key = `test:${randomUUID()}`;
    let first = await asApp((tx) => checkRateLimit(tx, key, 3, windowMs));

    // Fixed windows align to the Unix epoch. A slow integration run can start
    // just before a boundary and legitimately place the later calls in the
    // next bucket. If less than 15 seconds remain, begin again just inside the
    // next window with a fresh key so this assertion always exercises one
    // bucket instead of depending on wall-clock timing.
    if (first.retryAfterSeconds <= 15) {
      await new Promise((resolve) => setTimeout(resolve, first.retryAfterSeconds * 1_000 + 100));
      key = `test:${randomUUID()}`;
      first = await asApp((tx) => checkRateLimit(tx, key, 3, windowMs));
    }

    const results = [first];
    for (let attempt = 1; attempt < 4; attempt += 1)
      results.push(await asApp((tx) => checkRateLimit(tx, key, 3, windowMs)));
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSeconds).toBeGreaterThan(0);
    expect(results[3]!.retryAfterSeconds).toBeLessThanOrEqual(windowMs / 1_000);
  });

  it("resets once the fixed window elapses", async () => {
    const key = `test:${randomUUID()}`;
    // A short window keeps this well within the suite's test timeout.
    await asApp((tx) => checkRateLimit(tx, key, 1, 1_000));
    let blocked = await asApp((tx) => checkRateLimit(tx, key, 1, 1_000));
    // The window is aligned to the epoch. If the first two calls straddle its
    // boundary, the second call legitimately opens a new bucket; make one
    // immediate follow-up so the assertion always targets the active bucket.
    if (blocked.allowed) blocked = await asApp((tx) => checkRateLimit(tx, key, 1, 1_000));
    expect(blocked.allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, blocked.retryAfterSeconds * 1_000 + 100));
    const afterWindow = await asApp((tx) => checkRateLimit(tx, key, 1, 1_000));
    expect(afterWindow.allowed).toBe(true);
  });

  it("serializes concurrent increments so exactly the limit is allowed", async () => {
    const key = `test:${randomUUID()}`;
    const limit = 5;
    const attempts = 20;
    // The whole point: a naive read-then-write check would let more than
    // `limit` callers through when they race. This proves the single
    // INSERT .. ON CONFLICT statement in check_rate_limit serializes them.
    const results = await Promise.all(
      Array.from({ length: attempts }, () => asApp((tx) => checkRateLimit(tx, key, limit, 60_000))),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(limit);
  });

  it("rejects a non-positive limit or window instead of silently allowing", async () => {
    await expect(
      asApp((tx) => checkRateLimit(tx, `test:${randomUUID()}`, 0, 60_000)),
    ).rejects.toThrow();
    await expect(asApp((tx) => checkRateLimit(tx, `test:${randomUUID()}`, 1, 0))).rejects.toThrow();
  });

  it("is unreachable from the browser-facing authenticated role", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        return checkRateLimit(tx, `test:${randomUUID()}`, 1, 60_000);
      }),
    ).rejects.toThrow();
  });
});
