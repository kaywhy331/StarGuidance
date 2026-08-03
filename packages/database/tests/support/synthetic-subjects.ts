import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "../../src/postgres-client";

/**
 * Creates the disposable subjects the database verification suites operate on.
 *
 * Three environments have to be supported with identical assertions:
 *
 * - `supabase-admin` — the protected staging project. Subjects are genuine Auth
 *   identities created through the Admin API, which is also the evidence that
 *   Auth creation no longer fails now that migration 0002 removed the
 *   SECURITY DEFINER synchronisation trigger.
 * - `auth-shim` — CI, where an `auth.users` table is created before the
 *   migrations run. Migration 0001 therefore really does install the foreign
 *   key and the trigger, and migration 0002 really does remove them, without
 *   any credential.
 * - `plain` — a bare Postgres database with no `auth` schema at all.
 *
 * No address here belongs to a person: every one is a random label under a
 * prefix the cleanup utility recognises, at the reserved `.test` top-level
 * domain, which RFC 6761 guarantees can never resolve or receive mail.
 *
 * `example.com` is deliberately not used. Supabase's email validator rejects it
 * outright with `email_address_invalid`, so every synthetic identity failed to
 * be created; the reserved `.test` domain passes validation while remaining
 * undeliverable.
 */
export const SYNTHETIC_PREFIX = "sg-verify-";
export const SYNTHETIC_EMAIL_DOMAIN = "starguidance.test";

export type SubjectMode = "supabase-admin" | "auth-shim" | "plain";

export interface SyntheticSubject {
  readonly id: string;
  readonly email: string;
  /** Present only in `supabase-admin` mode: the Admin API creation status. */
  readonly httpStatus?: number;
}

const supabaseUrl = () => process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
const serviceRoleKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export async function authUsersPresent(sql: DatabaseClient): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    select to_regclass('auth.users') is not null as present`;
  return row?.present === true;
}

export async function detectSubjectMode(sql: DatabaseClient): Promise<SubjectMode> {
  if (!(await authUsersPresent(sql))) return "plain";
  return supabaseUrl() && serviceRoleKey() ? "supabase-admin" : "auth-shim";
}

export function syntheticEmail(label: string): string {
  return `${SYNTHETIC_PREFIX}${label}-${randomUUID()}@${SYNTHETIC_EMAIL_DOMAIN}`;
}

/**
 * Turns a rejected Admin API call into a message that says what happened.
 *
 * The provider's own error code is the whole diagnostic value here — an opaque
 * status turned one root cause into eight confusing downstream failures the
 * last time this broke. The address is deliberately not included: it would be
 * scrubbed from published evidence anyway.
 */
async function describeAdminFailure(response: Response): Promise<string> {
  let code = "";
  try {
    const body = (await response.json()) as { error_code?: string; code?: string; msg?: string };
    code = body.error_code ?? (typeof body.code === "string" ? body.code : "") ?? "";
    if (!code && body.msg) code = body.msg.replace(/"[^"]*"/g, "[redacted]");
  } catch {
    code = "";
  }
  return `status ${response.status}${code ? ` (${code})` : ""}`;
}

/**
 * Creates one subject. In `supabase-admin` mode the Admin API status code is
 * returned unread by the caller's assertions rather than thrown away, so a
 * regression to the pre-0002 HTTP 500 is reported as exactly that.
 */
export async function createSubject(
  sql: DatabaseClient,
  mode: SubjectMode,
  label: string,
): Promise<SyntheticSubject> {
  const email = syntheticEmail(label);

  if (mode === "supabase-admin") {
    const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey() as string,
        authorization: `Bearer ${serviceRoleKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password: `Sg!${randomUUID()}${randomUUID()}`,
        email_confirm: true,
      }),
    });
    const httpStatus = response.status;
    if (!response.ok) {
      // Fail loudly and specifically. Returning a subject with an empty id used
      // to push an invalid UUID into every later query, which buried the real
      // cause under a pile of `invalid input syntax for type uuid` errors.
      throw new Error(
        `Supabase Auth refused to create the synthetic subject: ${await describeAdminFailure(response)}`,
      );
    }
    const body = (await response.json()) as { id?: string };
    if (!body.id) throw new Error("The Supabase Admin API returned no subject identifier");
    return { id: body.id, email, httpStatus };
  }

  const id = randomUUID();
  if (mode === "auth-shim") {
    await sql`insert into auth.users (id, email) values (${id}, ${email})`;
  }
  return { id, email };
}

/** Removes the Auth identity, which cascades into every owned application row. */
export async function deleteSubject(
  sql: DatabaseClient,
  mode: SubjectMode,
  subject: SyntheticSubject,
): Promise<void> {
  if (!subject.id) return;
  if (mode === "supabase-admin") {
    await fetch(`${supabaseUrl()}/auth/v1/admin/users/${subject.id}`, {
      method: "DELETE",
      headers: {
        apikey: serviceRoleKey() as string,
        authorization: `Bearer ${serviceRoleKey()}`,
      },
    }).catch(() => undefined);
    return;
  }
  if (mode === "auth-shim") {
    await sql`delete from auth.users where id = ${subject.id}`;
    return;
  }
  await sql`delete from users where id = ${subject.id}`;
}

export async function authSubjectExists(
  sql: DatabaseClient,
  mode: SubjectMode,
  id: string,
): Promise<boolean> {
  if (mode === "supabase-admin") {
    const response = await fetch(`${supabaseUrl()}/auth/v1/admin/users/${id}`, {
      headers: {
        apikey: serviceRoleKey() as string,
        authorization: `Bearer ${serviceRoleKey()}`,
      },
    });
    return response.status === 200;
  }
  if (mode === "auth-shim") {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::integer as count from auth.users where id = ${id}`;
    return (row?.count ?? 0) > 0;
  }
  return false;
}
