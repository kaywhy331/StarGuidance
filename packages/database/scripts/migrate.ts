import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ApplicationCreatorRefusedError,
  migrateAsApplicationCreator,
} from "../src/guarded-migrate";
import { createDatabaseClient } from "../src/postgres-client";

/**
 * `pnpm db:migrate`: applies packages/database/migrations through Drizzle, but only
 * from a direct application-creator (`postgres`) session. Reads the server-only
 * DATABASE_URL and never prints it. STARGUIDANCE_MIGRATIONS_DIR exists so the
 * guarded path can be exercised against a synthetic migration folder; it does not
 * relax the identity check.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(2);
}
const folder =
  process.env.STARGUIDANCE_MIGRATIONS_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const sql = createDatabaseClient(databaseUrl, { max: 1, connectTimeoutSeconds: 15 });
try {
  await migrateAsApplicationCreator(sql, folder);
  console.log("migrations applied");
} catch (error) {
  if (error instanceof ApplicationCreatorRefusedError) {
    console.error(error.message);
    process.exitCode = 3;
  } else {
    const code =
      (error as { code?: string; cause?: { code?: string } }).cause?.code ??
      (error as { code?: string }).code;
    console.error(
      `migration failed${code ? ` (SQLSTATE ${code})` : ""}; nothing was recorded for the failing batch.`,
    );
    process.exitCode = 1;
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined);
}
