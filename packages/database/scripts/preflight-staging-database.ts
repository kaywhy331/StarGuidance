import { resolve4, resolve6 } from "node:dns/promises";

import postgres from "postgres";

import { connectionAdvice, describeConnection } from "./connection-shape";
import { runConnectedProbes, shortError } from "./preflight-probes";
import { record, requiredEnv } from "./staging-result";

/**
 * Explains why a staging migration can or cannot proceed, before the guarded
 * migration entrypoint runs.
 *
 * Every probe records categories, status codes, and booleans only. The host,
 * user, password, and database name are never recorded or printed.
 */
async function main(): Promise<void> {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const shape = describeConnection(databaseUrl);
  let failed = false;

  record({
    section: "Database preflight",
    check: "Connection target shape",
    status: shape.likelyTransactionPooler ? "fail" : "pass",
    detail:
      `port ${shape.port}; transaction pooler ${shape.likelyTransactionPooler}; ` +
      `pooler host ${shape.likelyPoolerHost}; direct supabase host ${shape.likelyDirectSupabaseHost}; ` +
      `sslmode ${shape.sslModeRequested ?? "unset"}; credentials complete ` +
      `${shape.hasUsername && shape.hasPassword && shape.hasDatabaseName}`,
  });
  if (shape.likelyTransactionPooler) failed = true;

  for (const advice of connectionAdvice(shape))
    record({
      section: "Database preflight",
      check: "Operator guidance",
      status: "limited",
      detail: advice,
    });

  // A direct Supabase host that only publishes AAAA records cannot be reached
  // from a GitHub-hosted runner, which is a common cause of an opaque failure.
  const host = new URL(databaseUrl).hostname;
  const [ipv4, ipv6] = await Promise.all([
    resolve4(host).then(
      (records) => records.length,
      () => 0,
    ),
    resolve6(host).then(
      (records) => records.length,
      () => 0,
    ),
  ]);
  const reachableFamily = ipv4 > 0;
  record({
    section: "Database preflight",
    check: "Runner can resolve an IPv4 route to the database",
    status: reachableFamily ? "pass" : "fail",
    detail: reachableFamily
      ? `A records ${ipv4 > 0}; AAAA records ${ipv6 > 0}`
      : `no A records; AAAA records ${ipv6 > 0}. GitHub-hosted runners have no IPv6 egress, ` +
        "so an IPv6-only database host is unreachable from this workflow.",
  });
  if (!reachableFamily) failed = true;

  // Match the application's own client options so the probe reflects reality.
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    prepare: false,
  });

  try {
    if (await runConnectedProbes(sql, record)) failed = true;
  } catch (error) {
    record({
      section: "Database preflight",
      check: "Connection established",
      status: "fail",
      detail: `could not query the database — ${shortError(error)}`,
    });
    failed = true;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (failed) process.exitCode = 1;
}

await main();
