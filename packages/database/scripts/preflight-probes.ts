import {
  applicationCreatorRefusal,
  APPLICATION_CREATOR,
  readApplicationCreatorIdentity,
} from "../src/browser-access-privileges";
import type { DatabaseClient } from "../src/postgres-client";
import { scrubHosts } from "./connection-shape";
import type { record as recordResult } from "./staging-result";

type Record = typeof recordResult;

export function shortError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    const code = typeof candidate.code === "string" ? candidate.code : undefined;
    const message = typeof candidate.message === "string" ? candidate.message : "unknown error";
    return scrubHosts(code ? `${code}: ${message}` : message);
  }
  return "unknown error";
}

/**
 * The probes that need an open connection, extracted so the identity gate is
 * testable against a local socket without any network or DNS step. Returns
 * whether the preflight failed.
 *
 * The creator identity is the first thing checked after the connection is
 * proven. A refused identity returns immediately: the committed create/drop DDL
 * probe and every later statement are skipped, so a refused connection issues
 * nothing but read-only identity queries. Only the verdict is recorded, never
 * the connected role name.
 */
export async function runConnectedProbes(sql: DatabaseClient, record: Record): Promise<boolean> {
  let failed = false;
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

  const creatorRefusal = applicationCreatorRefusal(await readApplicationCreatorIdentity(sql));
  record({
    section: "Database preflight",
    check: `Connection is the application creator (${APPLICATION_CREATOR})`,
    status: creatorRefusal ? "fail" : "pass",
    detail: creatorRefusal
      ? `application DDL must run as a direct ${APPLICATION_CREATOR} session (login and effective role). A separate login would create objects under its own default privileges, and a SET ROLE session is refused as a stricter direct-login policy. Remaining probes were skipped and nothing was changed.`
      : `session and effective role are ${APPLICATION_CREATOR}`,
  });
  if (creatorRefusal) return true;

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
  return failed;
}
