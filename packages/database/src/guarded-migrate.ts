import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

import {
  applicationCreatorRefusal,
  readApplicationCreatorIdentity,
} from "./browser-access-privileges";
import type { DatabaseClient } from "./postgres-client";

export class ApplicationCreatorRefusedError extends Error {
  constructor(reason: string) {
    super(`Migration refused before any change: ${reason}`);
    this.name = "ApplicationCreatorRefusedError";
  }
}

/**
 * The application migration entrypoint. On EVERY invocation, before Drizzle
 * touches the ledger or any object, the connection itself must be a direct
 * application-creator session (see {@link applicationCreatorRefusal}); otherwise
 * nothing is executed. The check and the migration share one connection, so the
 * identity cannot change in between, and Drizzle still applies all pending
 * migrations in its own single transaction. No role is switched or granted.
 */
export async function migrateAsApplicationCreator(
  sql: DatabaseClient,
  migrationsFolder: string,
): Promise<void> {
  const refusal = applicationCreatorRefusal(await readApplicationCreatorIdentity(sql));
  if (refusal) throw new ApplicationCreatorRefusedError(refusal);
  await migrate(drizzle(sql), { migrationsFolder });
}
