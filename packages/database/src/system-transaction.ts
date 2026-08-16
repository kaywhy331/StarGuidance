import { APPLICATION_DATABASE_ROLE } from "./database-role";
import type { DatabaseClient, DatabaseTransaction } from "./postgres-client";

/**
 * Runs `work` in a transaction bound to the non-login starguidance_app role,
 * with no request.jwt.claim.sub subject bound. For operations that are not
 * scoped to a single user's rows — rate-limit buckets, interpretation-job
 * claiming — unlike `actorTransaction`, which additionally binds a subject
 * for RLS-scoped access to user-owned tables.
 */
export async function systemTransaction<T>(
  client: DatabaseClient,
  work: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  return client.begin(async (tx) => {
    await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
    return work(tx as DatabaseTransaction);
  }) as Promise<T>;
}

/**
 * Runs `work` in a transaction bound to starguidance_app AND to a specific
 * subject via request.jwt.claim.sub — the same binding every authenticated
 * Next.js request already gets (apps/web/src/lib/repositories/postgres.ts's
 * userTransaction), exposed here so code with no HTTP request context (a
 * background worker processing a job on behalf of the user who created it)
 * can still write through the exact same RLS-scoped path.
 */
export async function actorTransaction<T>(
  client: DatabaseClient,
  userId: string,
  work: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  if (!userId) throw new TypeError("actorTransaction requires a userId.");
  return client.begin(async (tx) => {
    await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return work(tx as DatabaseTransaction);
  }) as Promise<T>;
}
