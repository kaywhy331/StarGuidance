import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  BROWSER_WITHHELD_TABLES,
  findBrowserDefaultAcls,
  findPublicFunctionDefaultGaps,
  findBrowserReachableUnforcedTables,
  REFERENCE_TABLES,
} from "../src/browser-access-privileges";
import { accessFixtureRefusal } from "../src/access-fixture-guard";
import { EXPECTED_MIGRATION_LINEAGE } from "../src/migration-manifest";
import { createDatabaseClient, type DatabaseClient } from "../src/postgres-client";

/**
 * Applies the real Drizzle history to a scratch database that carries
 * Supabase-shaped platform default ACLs for both creator roles, then proves
 * migration 0029 with real privilege checks. It refuses to run unless the
 * caller marks the cluster as a disposable, socket-only fixture.
 */
const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const disposable = process.env.STARGUIDANCE_DISPOSABLE_POSTGRES_FIXTURE;
const describeDatabase = databaseUrl && disposable ? describe.sequential : describe.skip;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const FIX = "0029_browser_role_privilege_boundary";
const CREATORS = ["postgres", "supabase_admin"] as const;
const BROWSER = ["anon", "authenticated"] as const;
const TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER";

const scratchName = `sg_access_${randomBytes(4).toString("hex")}`;
let admin: DatabaseClient;
let sql: DatabaseClient;
let scratchUrl = "";
let workDir = "";
const privateBefore = new Map<string, string>();

function privateSnapshot(): Promise<Record<string, string>[]> {
  return sql<Record<string, string>[]>`
    select c.relname, coalesce(c.relacl::text, '') || '|' || c.relrowsecurity || '|' ||
      c.relforcerowsecurity as state
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname <> all(${sql.array(BROWSER_WITHHELD_TABLES as unknown as string[])})
    order by c.relname`;
}

async function sqlCode(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
    return "ok";
  } catch (error) {
    return (error as { code?: string }).code ?? String(error);
  }
}

/** Runs work under a role and always rolls back, so probes never persist. */
async function asRole<T>(role: string, work: (tx: DatabaseClient) => Promise<T>): Promise<T> {
  const sentinel = new Error("rollback");
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      result = await work(tx as unknown as DatabaseClient);
      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  return result as T;
}

async function probe(role: string, statement: string): Promise<string> {
  const sentinel = new Error("rollback");
  let code = "ok";
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      try {
        await tx.savepoint(async (inner) => {
          await inner.unsafe(statement);
        });
      } catch (error) {
        code = (error as { code?: string }).code ?? String(error);
      }
      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  return code;
}

async function can(role: string, table: string, privileges = TABLE_PRIVILEGES): Promise<boolean> {
  const [row] = await sql<{ ok: boolean }[]>`
    select has_table_privilege(${role}, ${`public.${table}`}, ${privileges}) as ok`;
  return row?.ok === true;
}

async function createFutureObjects(creator: string, suffix: string) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${creator}`);
    await tx.unsafe(`
      create table public.future_${suffix}_${creator} (id serial primary key, note text);
      create function public.future_${suffix}_${creator}_fn() returns int language sql as 'select 1';
    `);
  });
  return { table: `future_${suffix}_${creator}`, sequence: `future_${suffix}_${creator}_id_seq` };
}

async function functionAclGrantees(name: string): Promise<string[]> {
  const rows = await sql<{ grantee: string }[]>`
    select coalesce(g.rolname, 'PUBLIC') as grantee
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    left join pg_roles g on g.oid = a.grantee
    where p.pronamespace = 'public'::regnamespace and p.proname = ${name}`;
  return rows.map(({ grantee }) => grantee);
}

/** Verifies manifest, connected server and postmaster.pid before any role/database write. */
async function assertDisposableCluster(): Promise<void> {
  const manifest = JSON.parse(readFileSync(disposable as string, "utf8")) as unknown;
  const [facts] = await admin<
    {
      dataDirectory: string;
      listenAddresses: string;
      clientAddress: string | null;
      port: string;
      socketDirectories: string;
      database: string;
      super: boolean;
    }[]
  >`
    select current_setting('data_directory') as "dataDirectory",
      current_setting('listen_addresses') as "listenAddresses",
      inet_server_addr()::text as "clientAddress", current_setting('port') as port,
      current_setting('unix_socket_directories') as "socketDirectories",
      current_database() as database,
      (select rolsuper from pg_roles where rolname = current_user) as super`;
  if (!facts?.super) throw new Error("Refusing to run: the fixture connection is not superuser");
  let postmasterPidLines: string[] | undefined;
  try {
    postmasterPidLines = readFileSync(join(facts.dataDirectory, "postmaster.pid"), "utf8").split(
      "\n",
    );
  } catch {
    postmasterPidLines = undefined;
  }
  const refusal = accessFixtureRefusal({
    manifest,
    server: { ...facts, port: Number(facts.port) },
    postmasterPidLines,
  });
  if (refusal) throw new Error(`Refusing to run against a non-fixture cluster: ${refusal}`);
}

/**
 * Effective EXECUTE (direct, PUBLIC, inherited) and a real SET LOCAL ROLE call
 * for both browser roles; after the fix the creator and service_role still call.
 */
async function expectFunctionExecution(
  fn: string,
  expected: { browser: boolean; creator?: string },
): Promise<void> {
  for (const role of BROWSER) {
    const [row] = await sql<{ ok: boolean }[]>`
      select has_function_privilege(${role}, ${`public.${fn}()`}, 'EXECUTE') as ok`;
    expect(row?.ok, `${role} has_function_privilege ${fn}`).toBe(expected.browser);
    expect(await probe(role, `select public.${fn}()`), `${role} call ${fn}`).toBe(
      expected.browser ? "ok" : "42501",
    );
  }
  if (expected.creator) {
    for (const role of [expected.creator, "service_role"]) {
      expect(await probe(role, `select public.${fn}()`), `${role} call ${fn}`).toBe("ok");
    }
  }
}

/**
 * Creates the scratch database with Supabase-shaped creator defaults and the
 * real 0000-0028 Drizzle history. `browserNamed` selects defaults that name
 * the browser roles; otherwise they name only service_role, leaving the
 * browser roles exposed to functions solely through implicit PUBLIC EXECUTE.
 */
async function provision(browserNamed: boolean): Promise<void> {
  {
    admin = createDatabaseClient(databaseUrl as string, { max: 1 });
    await assertDisposableCluster();
    await admin.unsafe(`
      do $roles$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
        if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'limited_migrator') then create role limited_migrator nologin; end if;
      end $roles$`);
    await admin.unsafe(`create database ${scratchName}`);

    const url = new URL(databaseUrl as string);
    url.pathname = `/${scratchName}`;
    scratchUrl = url.toString();
    sql = createDatabaseClient(scratchUrl, { max: 1 });

    // Supabase-shaped platform state: Auth schema, schema USAGE, and creator
    // defaults granting everything to the browser roles and service_role, both
    // globally and for schema public.
    await sql.unsafe(`
      create schema auth;
      create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
        created_at timestamptz not null default now());
      grant usage on schema public to anon, authenticated, service_role;
      grant create on schema public to supabase_admin, limited_migrator;
      grant usage on schema public to limited_migrator;
    `);
    for (const creator of CREATORS) {
      for (const scope of ["", "in schema public"]) {
        for (const kind of ["tables", "sequences", "functions"]) {
          await sql.unsafe(
            `alter default privileges for role ${creator} ${scope} grant all on ${kind} to ${
              browserNamed ? "anon, authenticated, service_role" : "service_role"
            }`,
          );
        }
      }
    }

    // Real Drizzle ledger for 0000-0028 only, via a private journal copy.
    workDir = mkdtempSync(join(tmpdir(), "sg-access-"));
    mkdirSync(join(workDir, "meta"));
    const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag !== FIX);
    writeFileSync(join(workDir, "meta", "_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries as { tag: string }[]) {
      cpSync(join(migrationsDir, `${tag}.sql`), join(workDir, `${tag}.sql`));
    }
    const migrator = createDatabaseClient(scratchUrl, { max: 1 });
    try {
      await migrate(drizzle(migrator), { migrationsFolder: workDir });
    } finally {
      await migrator.end({ timeout: 5 });
    }
    for (const row of await privateSnapshot()) privateBefore.set(row.relname!, row.state!);
  }
}

async function teardown(): Promise<void> {
  await sql?.end({ timeout: 5 }).catch(() => undefined);
  await admin?.unsafe(`drop database if exists ${scratchName} with (force)`).catch(() => undefined);
  await admin?.end({ timeout: 5 }).catch(() => undefined);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
}

describeDatabase("function defaults without named browser grants", () => {
  beforeAll(() => provision(false), 180_000);
  afterAll(teardown);

  it("leaves effective browser EXECUTE only through implicit PUBLIC, then removes it", async () => {
    expect(await findBrowserDefaultAcls(sql)).toEqual([]);
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([...CREATORS].sort());
    const before = [];
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "bare");
      expect(await functionAclGrantees(`${future.table}_fn`)).not.toContain("anon");
      await expectFunctionExecution(`${future.table}_fn`, { browser: true });
      before.push(future);
    }
    await migrate(drizzle(sql), { migrationsFolder: migrationsDir });
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([]);
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "bare2");
      await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator });
    }
    // Functions created before the migration keep their ACL: the fix is forward-only.
    const [existing] = await sql<{ ok: boolean }[]>`
      select has_function_privilege('anon', ${`public.${before[0]!.table}_fn()`}, 'EXECUTE') as ok`;
    expect(existing?.ok).toBe(true);
  });
});

describeDatabase("browser-role privilege boundary (migration 0029)", () => {
  beforeAll(() => provision(true), 180_000);
  afterAll(teardown);

  it("reproduces the observed unsafe table grants before the fix", async () => {
    const reachable = await findBrowserReachableUnforcedTables(sql);
    const byRole = (role: string) =>
      reachable.filter((row) => row.role === role).map((r) => r.table);
    expect(byRole("anon").sort()).toEqual([...BROWSER_WITHHELD_TABLES].sort());
    // 0001/0004 already withheld the webhook ledger from authenticated.
    expect(byRole("authenticated").sort()).toEqual([...REFERENCE_TABLES].sort());

    expect(await probe("anon", "update public.decks set active = active")).toBe("ok");
    expect(await probe("anon", "delete from public.card_meanings")).toBe("ok");
    expect(await probe("anon", "select * from public.payment_webhook_events")).toBe("ok");
    expect(
      await probe(
        "anon",
        "insert into public.payment_webhook_events (provider_event_id, event_type) values ('evt_red', 'x')",
      ),
    ).toBe("ok");
    expect(await probe("authenticated", "update public.products set id = id")).toBe("ok");
    expect(await probe("authenticated", "select 1 from public.payment_webhook_events")).toBe(
      "42501",
    );
  });

  it("shows new objects from both creators inherit browser grants before the fix", async () => {
    const defaults = await findBrowserDefaultAcls(sql);
    for (const creator of CREATORS) {
      for (const scope of ["global", "public"] as const) {
        for (const objectType of ["table", "sequence", "function"] as const) {
          expect(defaults).toContainEqual({ creator, scope, objectType, grantee: "anon" });
        }
      }
    }
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([...CREATORS].sort());
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "pre");
      expect(await can("anon", future.table, "SELECT, INSERT, UPDATE, DELETE")).toBe(true);
      expect(await can("authenticated", future.table, "SELECT, INSERT, UPDATE, DELETE")).toBe(true);
      const [seq] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege('anon', ${`public.${future.sequence}`}, 'USAGE') as ok`;
      expect(seq?.ok).toBe(true);
      const grantees = await functionAclGrantees(`${future.table}_fn`);
      expect(grantees).toContain("anon");
      expect(grantees).toContain("PUBLIC");
      await expectFunctionExecution(`${future.table}_fn`, { browser: true });
      // The migration is scoped to the ten classes and does not retro-fix stray
      // tables, so drop these probes before the post-fix phase.
      await sql.unsafe(
        `drop table public.${future.table}; drop function public.${future.table}_fn()`,
      );
    }
  });

  it("fails closed and atomically when the executor cannot act as a creator", async () => {
    const statements = readFileSync(join(migrationsDir, `${FIX}.sql`), "utf8").split(
      "--> statement-breakpoint",
    );
    let message = "";
    const code = await sqlCode(async () => {
      await sql.begin(async (tx) => {
        await tx.unsafe("set local role limited_migrator");
        try {
          for (const statement of statements) await tx.unsafe(statement);
        } catch (error) {
          message = (error as Error).message;
          throw error;
        }
      });
    });
    expect(code).toBe("42501");
    expect(message).toMatch(/default privileges created by role "(postgres|supabase_admin)"/);
    expect(await can("anon", "decks", "UPDATE")).toBe(true);
    expect((await findBrowserDefaultAcls(sql)).length).toBeGreaterThan(0);
  });

  it("applies 0029 through the Drizzle ledger with exact hash and timestamp lineage", async () => {
    const migrator = createDatabaseClient(scratchUrl, { max: 1 });
    try {
      await migrate(drizzle(migrator), { migrationsFolder: migrationsDir });
    } finally {
      await migrator.end({ timeout: 5 });
    }
    const applied = await sql<{ hash: string; created_at: string }[]>`
      select hash, created_at from drizzle.__drizzle_migrations order by id`;
    expect(applied.map((row) => [row.hash, Number(row.created_at)])).toEqual(
      EXPECTED_MIGRATION_LINEAGE.map((entry) => [entry.sha256, entry.createdAt]),
    );
    // 0028's composite ownership key stays unvalidated; this reads catalog only.
    const [owner] = await sql<{ validated: boolean }[]>`
      select convalidated as validated from pg_constraint
      where conname = 'follow_up_questions_reading_owner_fk'`;
    expect(owner?.validated).toBe(false);
  });

  it("removes every browser privilege on the ten targeted tables", async () => {
    for (const table of BROWSER_WITHHELD_TABLES) {
      for (const role of BROWSER) expect(await can(role, table), `${role} ${table}`).toBe(false);
    }
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([]);
    expect(await probe("anon", "update public.decks set active = active")).toBe("42501");
    expect(await probe("anon", "select * from public.payment_webhook_events")).toBe("42501");
    expect(
      await probe(
        "anon",
        "insert into public.payment_webhook_events (provider_event_id, event_type) values ('evt_green', 'x')",
      ),
    ).toBe("42501");
    expect(await probe("authenticated", "select 1 from public.products")).toBe("42501");
    expect(await probe("authenticated", "delete from public.cards")).toBe("42501");
  });

  it("keeps schema USAGE, the app actor, service_role, and the connection role working", async () => {
    for (const role of BROWSER) {
      const [schema] = await sql<{ ok: boolean }[]>`
        select has_schema_privilege(${role}, 'public', 'USAGE') as ok`;
      expect(schema?.ok, `${role} schema usage`).toBe(true);
    }
    const [actor] = await sql<{ ok: boolean }[]>`
      select not rolcanlogin and not rolsuper and not rolcreaterole and not rolcreatedb
        and not rolinherit and not rolbypassrls as ok
      from pg_roles where rolname = 'starguidance_app'`;
    expect(actor?.ok).toBe(true);

    for (const table of REFERENCE_TABLES) {
      expect(await can("starguidance_app", table, "SELECT"), table).toBe(true);
      expect(await can("starguidance_app", table, "INSERT, UPDATE, DELETE"), table).toBe(false);
    }
    expect(await probe("starguidance_app", "select count(*) from public.cards")).toBe("ok");
    expect(await probe("starguidance_app", "select 1 from public.payment_webhook_events")).toBe(
      "42501",
    );

    // service_role keeps full access, including the webhook lease cycle.
    for (const table of BROWSER_WITHHELD_TABLES) {
      expect(await can("service_role", table, "SELECT, INSERT, UPDATE, DELETE"), table).toBe(true);
    }
    // The connection role (table owner) runs the real lease/idempotency SQL.
    const eventId = `evt_${randomBytes(4).toString("hex")}`;
    const claim = async () =>
      (
        await sql`
          insert into payment_webhook_events (
            provider_event_id, event_type, processing_started_at, attempt_count
          ) values (${eventId}, 'checkout.session.completed', now(), 1)
          on conflict (provider_event_id) do update set
            processing_started_at = now(),
            attempt_count = payment_webhook_events.attempt_count + 1
          where payment_webhook_events.processed_at is null
            and (payment_webhook_events.processing_started_at is null
              or payment_webhook_events.processing_started_at < now() - interval '5 minutes')
          returning id`
      ).length === 1;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
    await sql`update payment_webhook_events set processed_at = now() where provider_event_id = ${eventId}`;
    await sql`delete from payment_webhook_events where provider_event_id = ${eventId}`;
  });

  it("keeps private-table RLS positive for the actor and unchanged for the other 25 tables", async () => {
    const after = new Map<string, string>();
    for (const row of await privateSnapshot()) after.set(row.relname!, row.state!);
    expect(privateBefore.size).toBe(25);
    expect(after).toEqual(privateBefore);

    const [a, b] = [randomUUID(), randomUUID()];
    await sql`insert into auth.users (id, email) values (${a}, 'a@access.invalid'), (${b}, 'b@access.invalid')`;
    await sql`insert into public.users (id, email) values (${a}, 'a@access.invalid'), (${b}, 'b@access.invalid')`;
    const visible = await asRole("starguidance_app", async (tx) => {
      await tx`select set_config('request.jwt.claim.sub', ${a}, true)`;
      return tx<{ id: string }[]>`select id from public.users`;
    });
    expect(visible.map((row) => row.id)).toEqual([a]);
    expect(await can("authenticated", "users", "SELECT")).toBe(false);
    await sql`delete from auth.users where id in (${a}, ${b})`;
  });

  it("denies browser grants on future objects from both creators and keeps service_role", async () => {
    expect(await findBrowserDefaultAcls(sql)).toEqual([]);
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "post");
      for (const role of BROWSER) {
        expect(await can(role, future.table), `${role} ${future.table}`).toBe(false);
        const [seq] = await sql<{ ok: boolean }[]>`
          select has_sequence_privilege(${role}, ${`public.${future.sequence}`},
            'USAGE, SELECT, UPDATE') as ok`;
        expect(seq?.ok, `${role} ${future.sequence}`).toBe(false);
      }
      expect(await can("service_role", future.table, "SELECT, INSERT, UPDATE, DELETE")).toBe(true);
      const grantees = await functionAclGrantees(`${future.table}_fn`);
      expect(grantees).not.toContain("anon");
      expect(grantees).not.toContain("authenticated");
      expect(grantees).toContain("service_role");
      expect(grantees).not.toContain("PUBLIC");
      await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator });
    }
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([]);
  });

  it("is idempotent and the audit helper catches a hand-made regression", async () => {
    const statements = readFileSync(join(migrationsDir, `${FIX}.sql`), "utf8").split(
      "--> statement-breakpoint",
    );
    for (const statement of statements) await sql.unsafe(statement);
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([]);

    await sql.unsafe("grant select on public.decks to anon");
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([
      { role: "anon", table: "decks" },
    ]);
    await sql.unsafe(
      "alter default privileges for role supabase_admin grant select on tables to anon",
    );
    expect(await findBrowserDefaultAcls(sql)).toEqual([
      { creator: "supabase_admin", scope: "global", objectType: "table", grantee: "anon" },
    ]);
  });
});
