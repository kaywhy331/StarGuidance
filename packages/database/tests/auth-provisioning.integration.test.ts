import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseTransaction } from "../src/postgres-client";
import {
  authSubjectExists,
  createSubject,
  deleteSubject,
  detectSubjectMode,
  SYNTHETIC_PREFIX,
  type SubjectMode,
  type SyntheticSubject,
} from "./support/synthetic-subjects";

/**
 * Proves the provisioning path that replaced the auth.users synchronisation
 * trigger removed by migration 0002.
 *
 * Before 0002 a SECURITY DEFINER trigger inserted into `public.users` inside
 * GoTrue's signup transaction. Forced row level security applies to SECURITY
 * DEFINER functions too, and `request.jwt.claim.sub` is unset there, so the
 * insert was rejected and Supabase Auth returned HTTP 500 for every signup.
 *
 * The replacement is the application boundary: requireUser() validates the
 * Supabase subject and repositories.users.ensure() inserts the row as the
 * `authenticated` role with the verified subject bound to
 * `request.jwt.claim.sub`. These tests exercise exactly that SQL and exactly
 * those policies. Nothing here is granted an exemption from row level security.
 */
const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;

let mode: SubjectMode = "plain";
let connectionBypassesRls = true;
let userA: SyntheticSubject;
let userB: SyntheticSubject;

function client() {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return sql;
}

/** Runs work exactly as the application does: authenticated, subject bound. */
async function asSubject<T>(subjectId: string, work: (tx: DatabaseTransaction) => Promise<T>) {
  return client().begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claim.sub', ${subjectId}, true)`;
    return work(tx as DatabaseTransaction);
  });
}

/** Runs work as `authenticated` with no verified subject at all. */
async function asUnidentifiedSession<T>(work: (tx: DatabaseTransaction) => Promise<T>) {
  return client().begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    return work(tx as DatabaseTransaction);
  });
}

/**
 * The statement `repositories.users.ensure()` issues, character for character,
 * so a policy regression fails here rather than only in the deployed suite.
 */
async function ensureUser(subjectId: string, email: string) {
  return asSubject(subjectId, async (tx) => {
    const [row] = await tx`
      insert into users (id, email)
      values (${subjectId}, ${email.toLowerCase()})
      on conflict (id) do update set email = excluded.email
      returning id, email, created_at`;
    if (!row) throw new Error("USER_SYNC_FAILED");
    return {
      id: String(row.id),
      email: String(row.email),
      createdAt: new Date(row.created_at as Date).toISOString(),
    };
  });
}

async function ownUserRowCount(subjectId: string): Promise<number> {
  return asSubject(subjectId, async (tx) => {
    const [row] = await tx<{ count: number }[]>`
      select count(*)::integer as count from users where id = ${subjectId}`;
    return row?.count ?? -1;
  });
}

describeDatabase("Auth identity provisioning after migration 0002", () => {
  beforeAll(async () => {
    mode = await detectSubjectMode(client());
    const [role] = await client()<{ bypasses: boolean }[]>`
      select coalesce(bool_or(rolsuper or rolbypassrls), false) as bypasses
      from pg_roles where rolname = current_user`;
    connectionBypassesRls = role?.bypasses === true;

    userA = await createSubject(client(), mode, "provision-a");
    userB = await createSubject(client(), mode, "provision-b");
  });

  afterAll(async () => {
    if (!sql) return;
    for (const subject of [userA, userB]) {
      if (subject?.id) await deleteSubject(sql, mode, subject).catch(() => undefined);
    }
    await sql`delete from users where email like ${`${SYNTHETIC_PREFIX}provision-%`}`;
    await sql.end({ timeout: 5 }).catch(() => undefined);
  });

  it("left no synchronisation trigger or function behind", async () => {
    const [trigger] = await client()<{ count: number }[]>`
      select count(*)::integer as count
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relname = 'users'
        and t.tgname = 'sync_authenticated_user_after_insert'`;
    expect(trigger?.count, "the auth.users sync trigger must not exist").toBe(0);

    const [routine] = await client()<{ count: number }[]>`
      select count(*)::integer as count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sync_authenticated_user'`;
    expect(routine?.count, "public.sync_authenticated_user() must not exist").toBe(0);
  });

  it("keeps every protection migration 0002 promised to preserve", async () => {
    const [users] = await client()<{ forced: boolean }[]>`
      select (c.relrowsecurity and c.relforcerowsecurity) as forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'users'`;
    expect(users?.forced, "public.users must keep forced RLS").toBe(true);

    const [policy] = await client()<{ count: number }[]>`
      select count(*)::integer as count from pg_policies
      where schemaname = 'public' and tablename = 'users' and policyname = 'users_self'`;
    expect(policy?.count).toBe(1);

    const [grants] = await client()<{ complete: boolean }[]>`
      select (
        has_table_privilege('authenticated', 'public.users', 'SELECT') and
        has_table_privilege('authenticated', 'public.users', 'INSERT') and
        has_table_privilege('authenticated', 'public.users', 'UPDATE') and
        has_table_privilege('authenticated', 'public.users', 'DELETE')
      ) as complete`;
    expect(grants?.complete, "the authenticated role must keep its grants").toBe(true);

    const [webhook] = await client()<{ granted: boolean }[]>`
      select has_table_privilege('authenticated', 'public.payment_webhook_events', 'select')
        as granted`;
    expect(webhook?.granted, "payment_webhook_events stays service-only").toBe(false);

    if (mode === "plain") return;
    const [foreignKey] = await client()<{ count: number }[]>`
      select count(*)::integer as count from pg_constraint
      where conname = 'users_auth_user_id_fk'
        and conrelid = 'public.users'::regclass
        and confrelid = 'auth.users'::regclass
        and confdeltype = 'c'`;
    expect(foreignKey?.count, "the ON DELETE CASCADE auth foreign key must survive").toBe(1);
  });

  it("creates an Auth identity without an error and without an application row", async () => {
    expect(userA.id, "the subject must have been created").not.toBe("");
    if (mode === "supabase-admin") {
      // The pre-0002 failure mode was exactly this status.
      expect(userA.httpStatus, "Supabase Auth creation must not fail").not.toBe(500);
      expect(userA.httpStatus).toBeLessThan(300);
    }
    // Queried as the subject itself, so an absent row cannot be confused with a
    // row that row level security is merely hiding.
    expect(await ownUserRowCount(userA.id), "Auth creation must not provision").toBe(0);
    expect(await ownUserRowCount(userB.id), "Auth creation must not provision").toBe(0);
  });

  it("provisions the application row on the first authenticated request", async () => {
    const provisioned = await ensureUser(userA.id, userA.email);
    expect(provisioned.id).toBe(userA.id);
    expect(provisioned.email).toBe(userA.email.toLowerCase());
    expect(await ownUserRowCount(userA.id)).toBe(1);

    await ensureUser(userB.id, userB.email);
    expect(await ownUserRowCount(userB.id)).toBe(1);
  });

  it("is idempotent when provisioning repeats", async () => {
    const first = await ensureUser(userA.id, userA.email);
    const second = await ensureUser(userA.id, userA.email);
    const third = await ensureUser(userA.id, userA.email);
    expect(second.createdAt).toBe(first.createdAt);
    expect(third.createdAt).toBe(first.createdAt);
    expect(await ownUserRowCount(userA.id)).toBe(1);
  });

  it("normalises an updated address to lower case", async () => {
    const changed = `${SYNTHETIC_PREFIX}provision-a-RENAMED-${randomUUID()}@EXAMPLE.com`;
    const updated = await ensureUser(userA.id, changed);
    expect(updated.email).toBe(changed.toLowerCase());
    const stored = await asSubject(userA.id, async (tx) => {
      const [row] = await tx`select email from users where id = ${userA.id}`;
      return String(row?.email);
    });
    expect(stored).toBe(changed.toLowerCase());
    // Restore so the deletion evidence below reads naturally.
    await ensureUser(userA.id, userA.email);
  });

  it("refuses to provision any subject other than the verified one", async () => {
    const foreignId = randomUUID();
    await expect(
      asSubject(userA.id, async (tx) => {
        await tx`insert into users (id, email)
          values (${foreignId}, ${`${SYNTHETIC_PREFIX}provision-forged@example.com`})`;
      }),
      "an authenticated caller must not insert an arbitrary user id",
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      asSubject(userA.id, async (tx) => {
        await tx`insert into users (id, email)
          values (${userB.id}, ${`${SYNTHETIC_PREFIX}provision-stolen@example.com`})
          on conflict (id) do update set email = excluded.email`;
      }),
      "an authenticated caller must not take over another subject",
    ).rejects.toMatchObject({ code: "42501" });

    // Neither attempt may have changed anything.
    expect(await ownUserRowCount(userB.id)).toBe(1);
    const [forged] = await client()<{ count: number }[]>`
      select count(*)::integer as count from users where id = ${foreignId}`;
    expect(forged?.count).toBe(0);
  });

  it("hides user rows from a session that carries no verified subject", async () => {
    const rows = await asUnidentifiedSession(async (tx) => {
      const [row] = await tx<{ count: number }[]>`select count(*)::integer as count from users`;
      return row?.count ?? -1;
    });
    expect(rows, "an unidentified authenticated session must see no user rows").toBe(0);

    await expect(
      asUnidentifiedSession(async (tx) => {
        await tx`insert into users (id, email)
          values (${randomUUID()}, ${`${SYNTHETIC_PREFIX}provision-anon@example.com`})`;
      }),
      "an unidentified authenticated session must not provision",
    ).rejects.toMatchObject({ code: "42501" });

    if (connectionBypassesRls) {
      // The migration role holds BYPASSRLS (Supabase) or is a superuser (CI), so
      // row level security cannot constrain it by design. The assertion above is
      // the meaningful one: nothing reaches a user row without a verified
      // subject unless it is the operator's own migration connection.
      return;
    }
    const [owner] = await client()<{ count: number }[]>`
      select count(*)::integer as count from users`;
    expect(owner?.count, "the migration owner must be subject to forced RLS").toBe(0);
  });

  it("keeps the two subjects isolated from each other", async () => {
    const aSeesB = await asSubject(userA.id, async (tx) => {
      const [row] = await tx<{ count: number }[]>`
        select count(*)::integer as count from users where id = ${userB.id}`;
      return row?.count ?? -1;
    });
    const bSeesA = await asSubject(userB.id, async (tx) => {
      const [row] = await tx<{ count: number }[]>`
        select count(*)::integer as count from users where id = ${userA.id}`;
      return row?.count ?? -1;
    });
    expect(aSeesB).toBe(0);
    expect(bSeesA).toBe(0);

    await asSubject(userA.id, async (tx) => {
      const updated =
        await tx`update users set email = ${`${SYNTHETIC_PREFIX}provision-hijack@example.com`}
        where id = ${userB.id} returning id`;
      expect(updated, "a cross-user update must affect no rows").toHaveLength(0);
      const deleted = await tx`delete from users where id = ${userB.id} returning id`;
      expect(deleted, "a cross-user delete must affect no rows").toHaveLength(0);
    });
    expect(await ownUserRowCount(userB.id)).toBe(1);
  });

  it("cascades an Auth deletion through owned application data and spares the other subject", async () => {
    if (mode === "plain") {
      // Without an auth schema there is no identity to delete; the cascade from
      // public.users itself is covered by the repository isolation suite.
      return;
    }
    const owned = {
      profile: randomUUID(),
      snapshot: randomUUID(),
    };
    await asSubject(userA.id, async (tx) => {
      await tx`insert into birth_profiles (id, user_id, encrypted_payload)
        values (${owned.profile}, ${userA.id}, '1.provision-a.encrypted')`;
      await tx`insert into profile_snapshots
        (id, user_id, profile_id, version, completeness, derived_payload, calculation_versions)
        values (${owned.snapshot}, ${userA.id}, ${owned.profile}, 1, 'core',
          ${tx.json({ snapshot: { id: owned.snapshot }, metadata: {} })},
          ${tx.json({ numerology: "v1" })})`;
      await tx`insert into audit_events (user_id, action, target_type, target_id, metadata)
        values (${userA.id}, 'test.provisioned', 'account', ${userA.id}, ${tx.json({})})`;
    });

    await deleteSubject(client(), mode, userA);
    expect(await authSubjectExists(client(), mode, userA.id)).toBe(false);

    for (const [table, column, value] of [
      ["users", "id", userA.id],
      ["birth_profiles", "id", owned.profile],
      ["profile_snapshots", "id", owned.snapshot],
      ["audit_events", "user_id", userA.id],
    ] as const) {
      const [row] = await client().unsafe<{ count: number }[]>(
        `select count(*)::integer as count from public.${table} where ${column} = $1`,
        [value],
      );
      expect(row?.count, `${table} must be cascaded away`).toBe(0);
    }

    expect(await authSubjectExists(client(), mode, userB.id)).toBe(true);
    expect(await ownUserRowCount(userB.id), "the other subject must survive intact").toBe(1);
  });

  it("fails the way staging failed when the trigger is present, and stops failing without it", async () => {
    if (mode !== "auth-shim") {
      // This reconstructs the removed trigger and creates two throwaway roles.
      // It is safe on the CI shim and must never touch a real Supabase project.
      return;
    }
    const label = `sg_rc_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const definer = `${label}_definer`;
    const signup = `${label}_signup`;
    const attempt = async () =>
      client().begin(async (tx) => {
        await tx.unsafe(`set local role ${signup}`);
        const rows = await tx`insert into auth.users (id, email)
          values (${randomUUID()}, ${`${SYNTHETIC_PREFIX}provision-rc-${randomUUID()}@example.com`})
          returning id`;
        return rows.length;
      });

    try {
      // GoTrue is not RLS-exempt and neither is the function owner, which is
      // precisely why FORCE ROW LEVEL SECURITY defeated the SECURITY DEFINER
      // trigger. A superuser connection would hide the defect, so both roles
      // are ordinary ones.
      await client().unsafe(`
        create role ${definer} nologin;
        create role ${signup} nologin;
        grant usage on schema public to ${definer};
        grant select, insert, update on public.users to ${definer};
        grant usage on schema auth to ${signup};
        grant select, insert on auth.users to ${signup};
        grant ${definer} to current_user;
        grant ${signup} to current_user;
        create function public.sync_authenticated_user()
        returns trigger language plpgsql security definer set search_path = ''
        as $rc$
        begin
          insert into public.users (id, email)
          values (new.id, coalesce(new.email, new.id::text || '@private.invalid'))
          on conflict (id) do update set email = excluded.email;
          return new;
        end
        $rc$;
        alter function public.sync_authenticated_user() owner to ${definer};
        create trigger sync_authenticated_user_after_insert
          after insert or update of email on auth.users
          for each row execute function public.sync_authenticated_user();
      `);

      await expect(
        attempt(),
        "the removed trigger must still reproduce the staging failure",
      ).rejects.toMatchObject({ code: "42501" });

      await client().unsafe(`
        drop trigger if exists sync_authenticated_user_after_insert on auth.users;
        drop function if exists public.sync_authenticated_user();
      `);

      await expect(
        attempt(),
        "removing the trigger must let Auth identity creation succeed",
      ).resolves.toBe(1);
    } finally {
      await client()
        .unsafe(
          `
        drop trigger if exists sync_authenticated_user_after_insert on auth.users;
        drop function if exists public.sync_authenticated_user();
        delete from auth.users where email like '${SYNTHETIC_PREFIX}provision-rc-%';
        revoke all on public.users from ${definer};
        revoke all on schema public from ${definer};
        revoke all on auth.users from ${signup};
        revoke all on schema auth from ${signup};
        revoke ${definer} from current_user;
        revoke ${signup} from current_user;
        drop role if exists ${definer};
        drop role if exists ${signup};
      `,
        )
        .catch(() => undefined);
    }
  });

  it("removes every synthetic row it created", async () => {
    await deleteSubject(client(), mode, userB);
    if (mode !== "plain") {
      expect(await authSubjectExists(client(), mode, userB.id)).toBe(false);
    }
    const [remaining] = await client()<{ count: number }[]>`
      select count(*)::integer as count from users
      where email like ${`${SYNTHETIC_PREFIX}provision-%`}`;
    expect(remaining?.count, "no synthetic application row may survive").toBe(0);
  });
});
