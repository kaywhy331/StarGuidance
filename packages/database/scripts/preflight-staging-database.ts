import { resolve4, resolve6 } from "node:dns/promises";

import postgres from "postgres";

import { connectionAdvice, describeConnection, scrubHosts } from "./connection-shape";
import { record, requiredEnv } from "./staging-result";

/**
 * Explains why a staging migration can or cannot proceed, before drizzle-kit
 * runs and reports `applying migrations...undefined`.
 *
 * Every probe records categories, status codes, and booleans only. The host,
 * user, password, and database name are never recorded or printed.
 */
function shortError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    const message = typeof candidate.message === "string" ? candidate.message : "unknown error";
    return scrubHosts(code ? `${code}: ${message}` : message);
  }
  return "unknown error";
}

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
    const [server] = await sql<{ version: string }[]>`select version() as version`;
    const version = String(server?.version ?? "")
      .split(" ")
      .slice(0, 2)
      .join(" ");
    record({
      section: "Database preflight",
      check: "Connection established",
      status: "pass",
      detail: `server reports ${version || "an unknown version"}`,
    });

    const [privileges] = await sql<
      { can_create: boolean; is_superuser: boolean; role_name: string }[]
    >`
      select
        has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
        coalesce((select rolsuper from pg_roles where rolname = current_user), false) as is_superuser,
        current_user::text as role_name`;
    const canCreate = privileges?.can_create === true;
    record({
      section: "Database preflight",
      check: "Connected role may create objects in the public schema",
      status: canCreate ? "pass" : "fail",
      detail: canCreate
        ? `CREATE on schema public granted; superuser ${privileges?.is_superuser === true}`
        : "the connected role lacks CREATE on schema public, so migrations cannot apply",
    });
    if (!canCreate) failed = true;

    // The `authenticated` role must exist or be creatable for migration 0001.
    const [roles] = await sql<{ authenticated_exists: boolean }[]>`
      select exists (select 1 from pg_roles where rolname = 'authenticated') as authenticated_exists`;
    record({
      section: "Database preflight",
      check: "Supabase authenticated role present",
      status: roles?.authenticated_exists ? "pass" : "limited",
      detail: roles?.authenticated_exists
        ? "the authenticated role already exists"
        : "the authenticated role is absent; migration 0001 creates it, which needs CREATEROLE",
    });

    // Prove real DDL capability without leaving anything behind.
    let ddlOk = false;
    let ddlDetail = "";
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("create table if not exists _sg_preflight_probe (id integer)");
        await tx.unsafe("drop table _sg_preflight_probe");
        await tx.unsafe("select 1");
      });
      ddlOk = true;
    } catch (error) {
      ddlDetail = shortError(error);
    }
    record({
      section: "Database preflight",
      check: "Transactional DDL succeeds",
      status: ddlOk ? "pass" : "fail",
      detail: ddlOk
        ? "created and dropped a probe table inside a transaction"
        : `DDL rejected — ${ddlDetail}`,
    });
    if (!ddlOk) failed = true;

    const [advisory] = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_lock(4919) as locked`;
    if (advisory?.locked) await sql`select pg_advisory_unlock(4919)`;
    record({
      section: "Database preflight",
      check: "Advisory locks available for the migrator",
      status: advisory?.locked ? "pass" : "limited",
      detail: advisory?.locked
        ? "advisory lock acquired and released"
        : "advisory lock unavailable, which some migration runners require",
    });
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
