import { inspectJobQueues } from "../src/job-diagnostics";
import { createDatabaseClient } from "../src/postgres-client";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const sql = createDatabaseClient(required("DATABASE_URL"));
try {
  process.stdout.write(`${JSON.stringify(await inspectJobQueues(sql), null, 2)}\n`);
} finally {
  await sql.end({ timeout: 5 }).catch(() => undefined);
}
