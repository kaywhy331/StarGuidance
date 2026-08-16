import { createDatabaseClient } from "../src/postgres-client";
import { record, requiredEnv } from "./staging-result";

/**
 * Removes every synthetic verification identity and its cascaded application
 * rows, then proves the removal. Runs in the workflow's always() path so a
 * failed verification still cleans up, and fails the run when it cannot confirm.
 */
export const SYNTHETIC_EMAIL_PREFIX = "sg-verify-";

interface AdminUser {
  readonly id: string;
  readonly email?: string;
}

async function listSyntheticUsers(baseUrl: string, serviceKey: string): Promise<AdminUser[]> {
  const found: AdminUser[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    });
    if (!response.ok) throw new Error(`admin user listing failed with status ${response.status}`);
    const body = (await response.json()) as { users?: AdminUser[] };
    const users = body.users ?? [];
    if (users.length === 0) break;
    found.push(...users.filter((user) => user.email?.startsWith(SYNTHETIC_EMAIL_PREFIX)));
    if (users.length < 200) break;
  }
  return found;
}

async function main(): Promise<void> {
  const baseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  let deleted = 0;
  let remaining = Number.NaN;
  let orphanRows = Number.NaN;
  let failureDetail: string | undefined;

  try {
    for (const user of await listSyntheticUsers(baseUrl, serviceKey)) {
      const response = await fetch(`${baseUrl}/auth/v1/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      });
      if (response.ok) deleted += 1;
    }
    remaining = (await listSyntheticUsers(baseUrl, serviceKey)).length;

    const sql = createDatabaseClient(requiredEnv("DATABASE_URL"));
    try {
      const [row] = await sql<{ count: number }[]>`
        select count(*)::int as count from public.users
        where email like ${`${SYNTHETIC_EMAIL_PREFIX}%`}`;
      orphanRows = row?.count ?? -1;
    } finally {
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  } catch (error) {
    failureDetail = error instanceof Error ? error.message : "unknown cleanup failure";
  }

  const verified = !failureDetail && remaining === 0 && orphanRows === 0;
  record({
    section: "Cleanup",
    check: "Synthetic identities and rows removed and verified",
    status: verified ? "pass" : "fail",
    detail: verified
      ? `${deleted} synthetic identity(ies) deleted; 0 auth identities and 0 application rows remain`
      : (failureDetail ??
        `cleanup unverified: ${remaining} auth identity(ies) and ${orphanRows} application row(s) remain`),
  });

  if (!verified) process.exitCode = 1;
}

await main();
