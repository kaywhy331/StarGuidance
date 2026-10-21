import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auditBrowserBoundary,
  BROWSER_WITHHELD_TABLES,
  findBrowserDefaultAcls,
  findBrowserFutureObjectAccess,
  findPublicFunctionDefaultGaps,
  findBrowserReachableUnforcedTables,
  REFERENCE_TABLES,
} from "../src/browser-access-privileges";
import { runConnectedProbes } from "../scripts/preflight-probes";
import { accessFixtureRefusal } from "../src/access-fixture-guard";
import { EXPECTED_MIGRATION_LINEAGE } from "../src/migration-manifest";
import { createDatabaseClient, type DatabaseClient } from "../src/postgres-client";

/**
 * Applies the real Drizzle history to a scratch database that carries
 * Supabase-shaped platform default ACLs for both creator roles, then proves
 * migration 0029 with real privilege checks. It refuses to run unless the
 * caller marks the cluster as a disposable, socket-only fixture.
 *
 * Identity model (mirrors the observed hosted authority): the fixture's
 * bootstrap superuser is `fixtureadmin`. The application creator `postgres` is a
 * NON-superuser with INHERIT, BYPASSRLS and CREATEROLE and no membership in
 * `supabase_admin`; migrations run as that real login (`pg`). `sql` stays the
 * fixture superuser and only plays the platform: it sets up and acts as
 * `supabase_admin`, and performs owner remediation that real owners would do.
 */
const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const disposable = process.env.STARGUIDANCE_DISPOSABLE_POSTGRES_FIXTURE;
const describeDatabase = databaseUrl && disposable ? describe.sequential : describe.skip;

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const FIX = "0029_browser_role_privilege_boundary";
const CREATORS = ["postgres", "supabase_admin"] as const;
const BROWSER = ["anon", "authenticated"] as const;
const TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN";

const scratchName = `sg_access_${randomBytes(4).toString("hex")}`;
let admin: DatabaseClient;
let sql: DatabaseClient;
let pg: DatabaseClient;
let scratchUrl = "";
let workDir = "";
const privateBefore = new Map<string, string>();
let scenarioRoles: string[] = [];

let platformDefaultsBefore = "";
let membershipsBefore: string[] = [];

/** Every default ACL row of one creator, rendered for byte-for-byte comparison. */
async function creatorDefaults(creator: string): Promise<string> {
  const rows = await sql<{ line: string }[]>`
    select d.defaclnamespace || '|' || d.defaclobjtype::text || '|' || d.defaclacl::text as line
    from pg_default_acl d where d.defaclrole = ${creator}::regrole order by 1`;
  return rows.map(({ line }) => line).join("\n");
}

/** Role memberships (member|role|options), to prove no membership or elevation was added. */
async function memberships(): Promise<string[]> {
  const rows = await sql<{ line: string }[]>`
    select m.member::regrole::text || '|' || m.roleid::regrole::text || '|' ||
      m.admin_option || m.inherit_option || m.set_option as line
    from pg_auth_members m order by 1`;
  return rows.map(({ line }) => line);
}

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

/** A real login to the scratch database as `user` (the fixture trusts local socket logins). */
function connectAs(user: string): DatabaseClient {
  return postgres(scratchUrl, { user, max: 1, prepare: false, connect_timeout: 10 });
}

/** Runs work as the real `postgres` login and always rolls back. */
async function asPostgresRolledBack<T>(work: (tx: DatabaseClient) => Promise<T>): Promise<T> {
  const sentinel = new Error("rollback");
  let result: T | undefined;
  try {
    await pg.begin(async (tx) => {
      result = await work(tx as unknown as DatabaseClient);
      throw sentinel;
    });
  } catch (error) {
    if (error !== sentinel) throw error;
  }
  return result as T;
}

/**
 * Creates objects as `creator`. `postgres` is the real application login; any
 * other creator is a platform role the fixture superuser acts as.
 */
async function createFutureObjects(creator: string, suffix: string) {
  const client = creator === "postgres" ? pg : sql;
  await client.begin(async (tx) => {
    if (creator !== "postgres") await tx.unsafe(`set local role ${creator}`);
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
  expected: { browser: boolean; creator?: string; service?: boolean },
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
    for (const role of expected.service === false
      ? [expected.creator]
      : [expected.creator, "service_role"]) {
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
async function provision(browserNamed: boolean, setup = ""): Promise<void> {
  {
    admin = createDatabaseClient(databaseUrl as string, { max: 1 });
    await assertDisposableCluster();
    await admin.unsafe(`
      do $roles$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
        if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then create role supabase_admin nologin; end if;
        -- The observed hosted migration identity: not a superuser, but it inherits,
        -- bypasses RLS and creates roles. It has no membership in supabase_admin.
        if not exists (select 1 from pg_roles where rolname = 'postgres') then
          create role postgres login nosuperuser inherit bypassrls createrole;
        end if;
      end $roles$`);
    const [observed] = await admin<{ ok: boolean }[]>`
      select not rolsuper and rolinherit and rolbypassrls and rolcreaterole and rolcanlogin as ok
      from pg_roles where rolname = 'postgres'`;
    if (!observed?.ok)
      throw new Error(
        "Refusing to run: fixture postgres is not the observed non-superuser profile",
      );
    await admin.unsafe(`create database ${scratchName} owner postgres`);

    const url = new URL(databaseUrl as string);
    url.pathname = `/${scratchName}`;
    scratchUrl = url.toString();
    sql = createDatabaseClient(scratchUrl, { max: 1 });
    pg = connectAs("postgres");

    // Supabase-shaped platform state: Auth schema, schema USAGE, and creator
    // defaults granting everything to the browser roles and service_role, both
    // globally and for schema public. The Auth objects are owned by postgres so
    // migration 0001's foreign key and 0002's trigger removal can act on them.
    await sql.unsafe(`
      create schema auth authorization postgres;
      create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
        created_at timestamptz not null default now());
      alter table auth.users owner to postgres;
      grant usage on schema public to anon, authenticated, service_role;
      grant create on schema public to supabase_admin;
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

    // Scenario-specific synthetic roles and defaults, inside this scratch database.
    if (setup) await sql.unsafe(setup);

    // Real Drizzle ledger for 0000-0028 only, via a private journal copy.
    workDir = mkdtempSync(join(tmpdir(), "sg-access-"));
    mkdirSync(join(workDir, "meta"));
    const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((entry: { tag: string }) => entry.tag !== FIX);
    writeFileSync(join(workDir, "meta", "_journal.json"), JSON.stringify(journal));
    for (const { tag } of journal.entries as { tag: string }[]) {
      cpSync(join(migrationsDir, `${tag}.sql`), join(workDir, `${tag}.sql`));
    }
    const migrator = connectAs("postgres");
    try {
      await migrate(drizzle(migrator), { migrationsFolder: workDir });
    } finally {
      await migrator.end({ timeout: 5 });
    }
    for (const row of await privateSnapshot()) privateBefore.set(row.relname!, row.state!);
  }
}

async function teardown(): Promise<void> {
  await pg?.end({ timeout: 5 }).catch(() => undefined);
  await sql?.end({ timeout: 5 }).catch(() => undefined);
  await admin?.unsafe(`drop database if exists ${scratchName} with (force)`).catch(() => undefined);
  // Cluster-wide synthetic roles (and their memberships) made by a scenario.
  for (const role of scenarioRoles) {
    await admin?.unsafe(`drop role if exists ${role}`).catch(() => undefined);
  }
  scenarioRoles = [];
  await admin?.end({ timeout: 5 }).catch(() => undefined);
  if (workDir) rmSync(workDir, { recursive: true, force: true });
}

describeDatabase("function defaults without named browser grants", () => {
  beforeAll(() => provision(false), 180_000);
  afterAll(teardown);

  it("leaves effective browser EXECUTE only through implicit PUBLIC, then removes it", async () => {
    // No default names a browser role; the only path is PUBLIC in the global function rows.
    expect(await findBrowserDefaultAcls(sql)).toEqual(
      CREATORS.map((creator) => ({
        creator,
        origin: creator === "postgres" ? "application" : "platform",
        scope: "global",
        objectType: "function",
        grantee: "PUBLIC",
      })),
    );
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([...CREATORS].sort());
    const before = [];
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "bare");
      expect(await functionAclGrantees(`${future.table}_fn`)).not.toContain("anon");
      await expectFunctionExecution(`${future.table}_fn`, { browser: true });
      before.push(future);
    }
    const platformDefaults = await creatorDefaults("supabase_admin");
    await migrate(drizzle(pg), { migrationsFolder: migrationsDir });
    // Application scope is closed; the platform creator is a separate, unchanged residual.
    expect(await findPublicFunctionDefaultGaps(sql, "application")).toEqual([]);
    expect(await findPublicFunctionDefaultGaps(sql, "platform")).toEqual(["supabase_admin"]);
    expect(await creatorDefaults("supabase_admin")).toBe(platformDefaults);
    const future = await createFutureObjects("postgres", "bare2");
    await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "postgres" });
    const platformFuture = await createFutureObjects("supabase_admin", "bare2");
    await expectFunctionExecution(`${platformFuture.table}_fn`, { browser: true });
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
          expect(defaults).toContainEqual({
            creator,
            origin: creator === "postgres" ? "application" : "platform",
            scope,
            objectType,
            grantee: "anon",
          });
        }
      }
    }
    platformDefaultsBefore = await creatorDefaults("supabase_admin");
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

  it("runs as the observed non-superuser postgres with no authority over supabase_admin", async () => {
    const [identity] = await pg<Record<string, unknown>[]>`
      select session_user::text as session, current_user::text as effective,
        r.rolsuper, r.rolinherit, r.rolbypassrls, r.rolcreaterole,
        pg_has_role('postgres', 'supabase_admin', 'USAGE') as usage,
        pg_has_role('postgres', 'supabase_admin', 'SET') as set_role
      from pg_roles r where r.rolname = 'postgres'`;
    expect(identity).toEqual({
      session: "postgres",
      effective: "postgres",
      rolsuper: false,
      rolinherit: true,
      rolbypassrls: true,
      rolcreaterole: true,
      usage: false,
      set_role: false,
    });
    membershipsBefore = await memberships();
    expect(membershipsBefore.some((line) => line.split("|")[1] === "supabase_admin")).toBe(false);
  });

  it("applies 0029 through the Drizzle ledger with exact hash and timestamp lineage", async () => {
    const migrator = connectAs("postgres");
    try {
      await migrate(drizzle(migrator), { migrationsFolder: migrationsDir });
    } finally {
      await migrator.end({ timeout: 5 });
    }
    // No membership or privilege was added to make it work.
    expect(await memberships()).toEqual(membershipsBefore);
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
        await pg`
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
    await pg`update payment_webhook_events set processed_at = now() where provider_event_id = ${eventId}`;
    await pg`delete from payment_webhook_events where provider_event_id = ${eventId}`;
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

  it("denies browser and PUBLIC access on future postgres objects, in any schema, and keeps service_role", async () => {
    // Application scope: no postgres default reaches a browser role any more.
    expect(
      (await findBrowserDefaultAcls(sql)).filter((row) => row.origin === "application"),
    ).toEqual([]);
    scenarioRoles = ["sgx_public_probe"];
    await sql.unsafe(`
      create role sgx_public_probe nologin;
      create schema sgx_other authorization postgres;
      grant usage on schema sgx_other to public, anon, authenticated, service_role;
      grant usage on schema public to sgx_public_probe;`);
    const future = await createFutureObjects("postgres", "post");
    for (const role of [...BROWSER, "sgx_public_probe"]) {
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
    await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "postgres" });
    expect(await probe("sgx_public_probe", `select public.${future.table}_fn()`)).toBe("42501");
    expect(await probe("sgx_public_probe", `select 1 from public.${future.table}`)).toBe("42501");
    expect(await probe("anon", `select 1 from public.${future.table}`)).toBe("42501");

    // The GLOBAL function default applies in every schema, so a function in
    // another schema is not PUBLIC-executable either (and the schema default
    // cannot add it back: defaults combine additively and none grants PUBLIC).
    await pg.unsafe(`
      create function sgx_other.future_fn() returns int language sql as 'select 1';
      create table sgx_other.future_t (id serial primary key);`);
    for (const role of [...BROWSER, "sgx_public_probe"]) {
      const [fn] = await sql<{ ok: boolean }[]>`
        select has_function_privilege(${role}, 'sgx_other.future_fn()', 'EXECUTE') as ok`;
      expect(fn?.ok, `${role} has_function_privilege other schema`).toBe(false);
      expect(await probe(role, "select sgx_other.future_fn()"), `${role} call`).toBe("42501");
      expect(await probe(role, "select 1 from sgx_other.future_t"), `${role} select`).toBe("42501");
    }
    // Explicit service_role default (global) and the creator itself still work.
    expect(await probe("service_role", "select sgx_other.future_fn()")).toBe("ok");
    expect(await probe("postgres", "select sgx_other.future_fn()")).toBe("ok");
    // Existing function ACLs and bodies are not rewritten: only future ones change.
    expect(await findPublicFunctionDefaultGaps(sql, "application")).toEqual([]);
  });

  it("leaves the supabase_admin defaults unchanged and reports them as platform residual", async () => {
    expect(platformDefaultsBefore).not.toBe("");
    expect(await creatorDefaults("supabase_admin")).toBe(platformDefaultsBefore);
    // Actual platform-created objects keep the browser exposure, so the residual is real.
    const platform = await createFutureObjects("supabase_admin", "residual");
    for (const role of BROWSER) {
      expect(await can(role, platform.table, "SELECT, INSERT, UPDATE, DELETE"), role).toBe(true);
      const [seq] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege(${role}, ${`public.${platform.sequence}`}, 'USAGE') as ok`;
      expect(seq?.ok, `${role} platform sequence`).toBe(true);
    }
    await expectFunctionExecution(`${platform.table}_fn`, { browser: true });
    expect(await probe("anon", `select 1 from public.${platform.table}`)).toBe("ok");

    const audit = await auditBrowserBoundary(sql);
    // The platform-owned table is browser-reachable, but classified as residual, not app scope.
    expect(audit.reachableTables).toEqual([]);
    expect(audit.platformReachableTables).toEqual(
      BROWSER.map((role) => ({ role, table: platform.table, origin: "platform" })),
    );
    expect(audit.applicationDefaults).toEqual([]);
    expect(audit.applicationFutureAccess).toEqual([]);
    expect(audit.applicationScopeClean).toBe(true);
    expect(audit.platformResidualPresent).toBe(true);
    expect(audit.globallyClean).toBe(false);
    expect(new Set(audit.platformFutureAccess.map((row) => row.creator))).toEqual(
      new Set(["supabase_admin"]),
    );
    expect(audit.platformFutureAccess.map((row) => row.objectType).sort()).toEqual([
      "function",
      "function",
      "sequence",
      "sequence",
      "table",
      "table",
    ]);
  });

  it("is idempotent and the audit helper catches a hand-made regression", async () => {
    const statements = readFileSync(join(migrationsDir, `${FIX}.sql`), "utf8").split(
      "--> statement-breakpoint",
    );
    for (const statement of statements) await pg.unsafe(statement);
    expect(await creatorDefaults("supabase_admin")).toBe(platformDefaultsBefore);
    expect(await findBrowserReachableUnforcedTables(sql, "application")).toEqual([]);

    await sql.unsafe("grant select on public.decks to anon");
    expect(await findBrowserReachableUnforcedTables(sql, "application")).toEqual([
      { role: "anon", table: "decks", origin: "application" },
    ]);
    await sql.unsafe("alter default privileges for role postgres grant select on tables to anon");
    expect((await auditBrowserBoundary(sql)).applicationScopeClean).toBe(false);
    expect(await findBrowserDefaultAcls(sql)).toContainEqual({
      creator: "postgres",
      origin: "application",
      scope: "global",
      objectType: "table",
      grantee: "anon",
    });
  });
});

/** Catalog state that must be byte-identical after a rejected migration. */
async function aclSnapshot(defaultsOnly = false): Promise<string> {
  const rows = await sql<{ line: string }[]>`
    select d.defaclrole::regrole::text || '|' || d.defaclnamespace || '|' || d.defaclobjtype::text || '|' ||
      d.defaclacl::text as line from pg_default_acl d
    union all
    select 'rel|' || c.relname || '|' || coalesce(c.relacl::text, '') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'S') and not ${defaultsOnly}
    order by 1`;
  return rows.map(({ line }) => line).join("\n");
}

/**
 * Runs the real 0029 statements in one transaction. By default as the actual
 * `postgres` login; `via` picks another real login or the fixture superuser and
 * `role` an optional SET LOCAL ROLE on top of it (to model alternate principals).
 */
async function runFix(
  options: { via?: "postgres" | "root" | string; role?: string } = {},
): Promise<{ code: string; message: string }> {
  const statements = readFileSync(join(migrationsDir, `${FIX}.sql`), "utf8").split(
    "--> statement-breakpoint",
  );
  let message = "";
  const via = options.via ?? "postgres";
  const client = via === "postgres" ? pg : via === "root" ? sql : connectAs(via);
  const code = await sqlCode(async () => {
    await client.begin(async (tx) => {
      if (options.role) await tx.unsafe(`set local role ${options.role}`);
      try {
        for (const statement of statements) await tx.unsafe(statement);
      } catch (error) {
        message = (error as Error).message;
        throw error;
      }
    });
  });
  if (client !== pg && client !== sql) await client.end({ timeout: 5 });
  return { code, message };
}

function scenario(
  name: string,
  options: { setup: string; roles: string[]; browserNamed?: boolean },
  body: () => Promise<void>,
): void {
  describeDatabase(`0029 scenario: ${name}`, () => {
    beforeAll(async () => {
      scenarioRoles = options.roles;
      await provision(options.browserNamed ?? false, options.setup);
    }, 180_000);
    afterAll(teardown);
    it(name, body, 180_000);
  });
}

const createCreators = (...roles: string[]) =>
  roles
    .map((role) => `create role ${role} nologin; grant create on schema public to ${role};`)
    .join("\n");

/** Message of an error and of its cause chain (Drizzle wraps the driver error). */
function errorText(error: unknown): string {
  const parts: string[] = [];
  for (let current = error as { message?: string; cause?: unknown } | undefined; current;) {
    parts.push(String(current.message ?? current));
    current = current.cause as typeof current | undefined;
  }
  return parts.join(" <- ");
}

async function roleState(): Promise<string> {
  const rows = await sql<{ line: string }[]>`
    select rolname || '|' || rolsuper || rolinherit || rolcreaterole || rolcreatedb || rolcanlogin ||
      rolbypassrls as line from pg_roles where rolname !~ '^pg_' order by 1`;
  return rows.map(({ line }) => line).join("\n");
}

scenario(
  "schema-level PUBLIC function defaults: postgres is remediated, supabase_admin stays a residual",
  {
    roles: [],
    setup: CREATORS.map(
      (creator) =>
        `alter default privileges for role ${creator} in schema public grant execute on functions to public;`,
    ).join("\n"),
  },
  async () => {
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([...CREATORS].sort());
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "before");
      await expectFunctionExecution(`${future.table}_fn`, { browser: true });
    }
    const platformBefore = await creatorDefaults("supabase_admin");
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    // The explicit PUBLIC grant in the postgres schema default is gone too.
    expect(await findBrowserFutureObjectAccess(sql)).toEqual(
      ["anon", "authenticated"].map((role) => ({
        creator: "supabase_admin",
        origin: "platform",
        objectType: "function",
        role,
      })),
    );
    expect(await creatorDefaults("supabase_admin")).toBe(platformBefore);
    const future = await createFutureObjects("postgres", "after");
    await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "postgres" });
    const platform = await createFutureObjects("supabase_admin", "after");
    await expectFunctionExecution(`${platform.table}_fn`, { browser: true });
  },
);

scenario(
  "a postgres default inherited through a browser-role group is rejected, then fixed by the owner",
  {
    roles: ["sgx_group"],
    setup: `create role sgx_group nologin;
      grant sgx_group to anon, authenticated;
      ${CREATORS.map(
        (
          creator,
        ) => `alter default privileges for role ${creator} revoke execute on functions from public;
          alter default privileges for role ${creator} grant execute on functions to sgx_group;`,
      ).join("\n")}`,
  },
  async () => {
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "before");
      await expectFunctionExecution(`${future.table}_fn`, { browser: true });
    }
    expect(await findPublicFunctionDefaultGaps(sql)).toEqual([...CREATORS].sort());
    expect(await findBrowserDefaultAcls(sql)).toContainEqual({
      creator: "postgres",
      origin: "application",
      scope: "global",
      objectType: "function",
      grantee: "sgx_group",
    });

    const before = await aclSnapshot();
    const rejected = await runFix();
    expect(rejected.code).toBe("55000");
    expect(rejected.message).toMatch(/inherits the default privileges.*sgx_group/);
    expect(await aclSnapshot()).toBe(before);

    // Owner action for the application creator only; the group and memberships stay.
    await sql.unsafe(
      "alter default privileges for role postgres revoke execute on functions from sgx_group",
    );
    const platformBefore = await creatorDefaults("supabase_admin");
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(await creatorDefaults("supabase_admin")).toBe(platformBefore);
    const [membership] = await sql<{ ok: boolean }[]>`
      select pg_has_role('anon', 'sgx_group', 'USAGE') and pg_has_role('authenticated', 'sgx_group', 'USAGE') as ok`;
    expect(membership?.ok).toBe(true);
    const future = await createFutureObjects("postgres", "after");
    await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "postgres" });
    const reached = await findBrowserFutureObjectAccess(sql);
    expect(reached.filter((row) => row.origin === "application")).toEqual([]);
    // supabase_admin's group default is untouched and still reported.
    expect(reached.some((row) => row.creator === "supabase_admin")).toBe(true);
  },
);

const MATRIX = (["tables", "sequences", "functions"] as const).flatMap((kind) =>
  (["global", "public"] as const).map((scope) => ({
    kind,
    scope,
    role: `sgx_${kind}_${scope}`,
  })),
);

scenario(
  "other creators of every object kind and scope are untouched and reported, never closed",
  {
    roles: MATRIX.map(({ role }) => role),
    setup: `${createCreators(...MATRIX.map(({ role }) => role))}
      ${MATRIX.map(
        ({ kind, scope, role }) =>
          `alter default privileges for role ${role} ${scope === "public" ? "in schema public" : ""} grant all on ${kind} to anon, authenticated, service_role;`,
      ).join("\n")}`,
  },
  async () => {
    const reachedBefore = await findBrowserFutureObjectAccess(sql);
    for (const { role } of MATRIX) {
      expect(reachedBefore.filter((row) => row.creator === role).length, role).toBeGreaterThan(0);
    }
    const others = [...MATRIX.map(({ role }) => role), "supabase_admin"];
    const defaultsBefore = new Map<string, string>();
    for (const creator of others) defaultsBefore.set(creator, await creatorDefaults(creator));

    expect(await runFix()).toEqual({ code: "ok", message: "" });

    // Byte-for-byte unchanged, including the missing global function row (none added).
    for (const creator of others) {
      expect(await creatorDefaults(creator), creator).toBe(defaultsBefore.get(creator));
    }
    expect(await findBrowserFutureObjectAccess(sql)).toEqual(
      reachedBefore.filter((row) => row.origin === "platform"),
    );
    const audit = await auditBrowserBoundary(sql);
    expect(audit.applicationScopeClean).toBe(true);
    expect(audit.platformResidualPresent).toBe(true);
    expect(audit.globallyClean).toBe(false);
    for (const { kind, role } of MATRIX) {
      expect(
        audit.platformDefaults.some((row) => row.creator === role),
        role,
      ).toBe(true);
      const future = await createFutureObjects(role, "after");
      // Real objects confirm each residual: the browser privilege follows the granted kind.
      expect(await can("anon", future.table, "SELECT"), `${role} table`).toBe(kind === "tables");
      const [seq] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege('anon', ${`public.${future.sequence}`}, 'USAGE') as ok`;
      expect(seq?.ok, `${role} sequence`).toBe(kind === "sequences");
      const [fn] = await sql<{ ok: boolean }[]>`
        select has_function_privilege('anon', ${`public.${future.table}_fn()`}, 'EXECUTE') as ok`;
      expect(fn?.ok, `${role} function`).toBe(true);
    }
    // The application creator is still closed in the same database.
    const future = await createFutureObjects("postgres", "after");
    for (const browser of BROWSER) expect(await can(browser, future.table)).toBe(false);
    await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "postgres" });
  },
);

scenario(
  "partial authority: postgres does not own the targeted tables, so the trial rejects atomically",
  { roles: ["sgx_table_owner"], setup: "create role sgx_table_owner nologin;", browserNamed: true },
  async () => {
    const tables = BROWSER_WITHHELD_TABLES.map((table) => `public.${table}`);
    for (const table of tables) await sql.unsafe(`alter table ${table} owner to sgx_table_owner`);
    const before = await aclSnapshot();
    const defaultsBefore = await aclSnapshot(true);

    // Nothing to revoke with: REVOKE only warns, the effective check then fails.
    const rejected = await runFix();
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to table public\./);
    // The default ACL statements that succeeded inside the trial were rolled back.
    expect(await aclSnapshot(true)).toBe(defaultsBefore);
    expect(await aclSnapshot()).toBe(before);
    expect(await can("anon", "decks", "UPDATE")).toBe(true);
    expect((await auditBrowserBoundary(sql)).applicationScopeClean).toBe(false);

    // Owner action restores ownership; the same migration then applies.
    for (const table of tables) await sql.unsafe(`alter table ${table} owner to postgres`);
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([]);
  },
);

scenario(
  "REVOKE that only warns (SELECT without grant option on every target) is rejected atomically",
  {
    roles: ["sgx_w_owner"],
    browserNamed: true,
    setup: "create role sgx_w_owner nologin;",
  },
  async () => {
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`alter table public.${table} owner to sgx_w_owner`);
      await sql.unsafe(`grant select on public.${table} to postgres`);
    }
    // The warning is a real no-op: browser access survives postgres's REVOKE.
    const survives = await asPostgresRolledBack(async (tx) => {
      await tx.unsafe("revoke all on table public.decks from anon");
      const [row] = await tx<{ ok: boolean }[]>`
        select has_table_privilege('anon', 'public.decks', 'UPDATE') as ok`;
      return row?.ok;
    });
    expect(survives).toBe(true);

    const before = await aclSnapshot();
    const rejected = await runFix();
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to table public\.\w+: REVOKE left/);
    expect(await aclSnapshot()).toBe(before);
    expect(await can("anon", "decks", "UPDATE")).toBe(true);
  },
);

scenario(
  "a sequence grant by another grantor survives REVOKE and is rejected atomically",
  {
    roles: ["sgx_grantor"],
    browserNamed: true,
    setup: `create role sgx_grantor nologin; grant usage on schema public to sgx_grantor;`,
  },
  async () => {
    // The ten tables carry no serial column, so own a synthetic sequence by one.
    // The browser roles receive USAGE from the creator default, as on a real one.
    await pg.unsafe("create sequence public.sgx_seq owned by public.decks.id");
    const name = "public.sgx_seq";
    for (const role of BROWSER) {
      const [row] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege(${role}, ${name}, 'USAGE') as ok`;
      expect(row?.ok, `${role} before`).toBe(true);
    }
    await sql.unsafe(`grant usage on sequence ${name} to sgx_grantor with grant option`);
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role sgx_grantor");
      await tx.unsafe(`grant usage on sequence ${name} to anon, authenticated`);
    });

    const before = await aclSnapshot();
    const rejected = await runFix();
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to sequence .*REVOKE left/);
    expect(await aclSnapshot()).toBe(before);

    // Owner action: withdraw the other grantor's grant chain, then it succeeds.
    await sql.unsafe(`revoke usage on sequence ${name} from sgx_grantor cascade`);
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    for (const role of BROWSER) {
      const [row] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege(${role}, ${name}, 'USAGE, SELECT, UPDATE') as ok`;
      expect(row?.ok, `${role} ${name}`).toBe(false);
    }
    expect(
      (await findBrowserFutureObjectAccess(sql)).filter((r) => r.origin === "application"),
    ).toEqual([]);
  },
);

for (const scope of ["", "in schema public"] as const) {
  const tag = scope ? "public" : "global";
  const group = `sgx_grp_${tag}`;
  scenario(
    `postgres defaults inherited through a browser group (${tag} scope) are rejected for every object kind`,
    {
      roles: [group],
      setup: `create role ${group} nologin; grant ${group} to anon, authenticated;`,
    },
    async () => {
      // Applied after the 0000-0028 history so the group does not alter that history's checks.
      for (const creator of CREATORS) {
        await sql.unsafe(`
          alter default privileges for role ${creator} revoke execute on functions from public;
          alter default privileges for role ${creator} ${scope} grant select on tables to ${group};
          alter default privileges for role ${creator} ${scope} grant usage on sequences to ${group};
          alter default privileges for role ${creator} ${scope} grant execute on functions to ${group};`);
      }
      const acls = await findBrowserDefaultAcls(sql);
      const reached = await findBrowserFutureObjectAccess(sql);
      for (const creator of CREATORS) {
        for (const objectType of ["table", "sequence", "function"] as const) {
          expect(acls).toContainEqual({
            creator,
            origin: creator === "postgres" ? "application" : "platform",
            scope: tag,
            objectType,
            grantee: group,
          });
          expect(
            reached.filter((r) => r.creator === creator && r.objectType === objectType).length,
          ).toBeGreaterThan(0);
        }
      }
      const before = await aclSnapshot();
      const rejected = await runFix();
      expect(rejected.code).toBe("55000");
      expect(rejected.message).toContain(group);
      expect(await aclSnapshot()).toBe(before);

      // Owner action for the application creator only.
      await sql.unsafe(`
        alter default privileges for role postgres ${scope} revoke all on tables from ${group};
        alter default privileges for role postgres ${scope} revoke all on sequences from ${group};
        alter default privileges for role postgres ${scope} revoke all on functions from ${group};`);
      const platformBefore = await creatorDefaults("supabase_admin");
      expect(await runFix()).toEqual({ code: "ok", message: "" });
      expect(await creatorDefaults("supabase_admin")).toBe(platformBefore);
      expect(
        (await findBrowserFutureObjectAccess(sql)).filter((r) => r.origin === "application"),
      ).toEqual([]);
      const future = await createFutureObjects("postgres", "after");
      for (const role of BROWSER) expect(await can(role, future.table)).toBe(false);
      await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "postgres" });
      // supabase_admin still reaches the browser group: a reported residual.
      const platform = await createFutureObjects("supabase_admin", "after");
      expect(await can("anon", platform.table, "SELECT")).toBe(true);
    },
  );
}

scenario(
  "a direct PG17 MAINTAIN grant is detected, rejected on warning-only REVOKE, and removed by an owner",
  {
    roles: ["sgx_m_owner"],
    browserNamed: true,
    setup: "create role sgx_m_owner nologin;",
  },
  async () => {
    // Browser roles keep ONLY a direct MAINTAIN grant (no ordinary DML).
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`revoke all on public.${table} from anon, authenticated`);
      await sql.unsafe(`grant maintain on public.${table} to anon, authenticated`);
    }
    for (const role of BROWSER) {
      expect(await can(role, "decks", "SELECT, INSERT, UPDATE, DELETE"), `${role} dml`).toBe(false);
      expect(await can(role, "decks", "MAINTAIN"), `${role} maintain`).toBe(true);
    }
    // Audit helper detects each browser role on every target.
    const reachable = await findBrowserReachableUnforcedTables(sql);
    expect(reachable.length).toBe(BROWSER_WITHHELD_TABLES.length * BROWSER.length);

    // Partial authority: owned by another role, postgres holds only SELECT.
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`alter table public.${table} owner to sgx_m_owner`);
      await sql.unsafe(`grant select on public.${table} to postgres`);
    }
    const before = await aclSnapshot();
    const rejected = await runFix();
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to table public\.\w+: REVOKE left/);
    expect(await aclSnapshot()).toBe(before);
    expect(await can("anon", "decks", "MAINTAIN")).toBe(true);

    // Owner authority restored: the migration succeeds and MAINTAIN is gone.
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`alter table public.${table} owner to postgres`);
    }
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    for (const table of BROWSER_WITHHELD_TABLES) {
      for (const role of BROWSER) {
        expect(await can(role, table, "MAINTAIN"), `${role} ${table}`).toBe(false);
      }
    }
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([]);
  },
);

scenario(
  "schema-level PUBLIC table and sequence defaults: postgres is remediated, supabase_admin remains",
  {
    roles: [],
    setup: CREATORS.map(
      (
        creator,
      ) => `alter default privileges for role ${creator} in schema public grant select on tables to public;
        alter default privileges for role ${creator} in schema public grant usage on sequences to public;`,
    ).join("\n"),
  },
  async () => {
    const acls = await findBrowserDefaultAcls(sql);
    for (const creator of CREATORS) {
      for (const objectType of ["table", "sequence"] as const) {
        expect(acls).toContainEqual({
          creator,
          origin: creator === "postgres" ? "application" : "platform",
          scope: "public",
          objectType,
          grantee: "PUBLIC",
        });
      }
      const future = await createFutureObjects(creator, "before");
      expect(await can("anon", future.table, "SELECT")).toBe(true);
    }
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(
      (await findBrowserFutureObjectAccess(sql)).filter((row) => row.origin === "application"),
    ).toEqual([]);
    const future = await createFutureObjects("postgres", "after");
    for (const role of BROWSER) {
      expect(await can(role, future.table)).toBe(false);
      const [seq] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege(${role}, ${`public.${future.sequence}`}, 'USAGE, SELECT') as ok`;
      expect(seq?.ok).toBe(false);
    }
    const platform = await createFutureObjects("supabase_admin", "after");
    expect(await can("anon", platform.table, "SELECT")).toBe(true);
  },
);

scenario(
  "an unauthorized alternate creator is rejected before any mutation, even with inherited authority",
  {
    roles: ["sgx_alt", "sgx_setonly"],
    browserNamed: true,
    setup: `create role sgx_alt login inherit nobypassrls; create role sgx_setonly login noinherit;
      grant postgres to sgx_alt with inherit true, set true;
      grant postgres to sgx_setonly with inherit false, set true;
      grant create on schema public to sgx_alt;`,
  },
  async () => {
    // sgx_alt really can administer postgres' objects and defaults by inheritance.
    const [inheritance] = await sql<{ usage: boolean; set_role: boolean }[]>`
      select pg_has_role('sgx_alt', 'postgres', 'USAGE') as usage,
        pg_has_role('sgx_alt', 'postgres', 'SET') as set_role`;
    expect(inheritance).toEqual({ usage: true, set_role: true });
    const alterAsAlt = await sqlCode(async () => {
      await sql.begin(async (tx) => {
        await tx.unsafe("set local role sgx_alt");
        await tx.unsafe(
          "alter default privileges for role postgres revoke all on tables from anon",
        );
        throw new Error("rollback");
      });
    });
    expect(alterAsAlt, "capable by inheritance").toBe("Error: rollback");

    const ledgerCount = async () =>
      Number(
        (await sql<{ n: string }[]>`select count(*) as n from drizzle.__drizzle_migrations`)[0]?.n,
      );
    const before = {
      acl: await aclSnapshot(),
      members: await memberships(),
      roles: await roleState(),
      ledger: await ledgerCount(),
      privateState: JSON.stringify(await privateSnapshot()),
    };
    expect(before.ledger).toBe(EXPECTED_MIGRATION_LINEAGE.length - 1);
    const unchanged = async (label: string) => {
      expect(await aclSnapshot(), `${label} acl`).toBe(before.acl);
      expect(await memberships(), `${label} memberships`).toEqual(before.members);
      expect(await roleState(), `${label} role attributes`).toBe(before.roles);
      expect(await ledgerCount(), `${label} ledger`).toBe(before.ledger);
      expect(JSON.stringify(await privateSnapshot()), `${label} private`).toBe(before.privateState);
      expect(
        (await auditBrowserBoundary(sql)).applicationScopeClean,
        `${label} no false pass`,
      ).toBe(false);
    };

    // The real migration runner as the inheriting alternate login.
    const alt = connectAs("sgx_alt");
    let runnerError = "";
    try {
      await migrate(drizzle(alt), { migrationsFolder: migrationsDir });
    } catch (error) {
      runnerError = errorText(error);
    } finally {
      await alt.end({ timeout: 5 });
    }
    expect(runnerError).toMatch(/refuses to run/);
    expect(runnerError).toMatch(/session_user "sgx_alt", current_user "sgx_alt"/);
    await unchanged("drizzle runner as sgx_alt");

    const cases: Array<[string, Parameters<typeof runFix>[0], RegExp]> = [
      ["alt login", { via: "sgx_alt" }, /session_user "sgx_alt", current_user "sgx_alt"/],
      [
        "alt login then SET ROLE postgres",
        { via: "sgx_alt", role: "postgres" },
        /session_user "sgx_alt", current_user "postgres"/,
      ],
      [
        "SET-only member then SET ROLE postgres",
        { via: "sgx_setonly", role: "postgres" },
        /session_user "sgx_setonly", current_user "postgres"/,
      ],
      ["fixture superuser", { via: "root" }, /current_user "[a-z]+"/],
      [
        "fixture superuser then SET ROLE postgres",
        { via: "root", role: "postgres" },
        /current_user "postgres"/,
      ],
      [
        "fixture superuser then SET ROLE supabase_admin",
        { via: "root", role: "supabase_admin" },
        /current_user "supabase_admin"/,
      ],
    ];
    for (const [label, options, pattern] of cases) {
      const rejected = await runFix(options);
      expect(rejected.code, label).toBe("42501");
      expect(rejected.message, label).toMatch(
        /refuses to run: application DDL must be created by role "postgres"/,
      );
      expect(rejected.message, label).toMatch(pattern);
      await unchanged(label);
    }

    // The direct postgres connection is the only thing that passes; no elevation needed.
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(await memberships()).toEqual(before.members);
    expect(await roleState()).toBe(before.roles);
    expect((await auditBrowserBoundary(sql)).applicationScopeClean).toBe(true);
  },
);

scenario(
  "F1: a required table drifting to another owner stays in application scope, with or without a browser grant",
  { roles: [], browserNamed: true, setup: "" },
  async () => {
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect((await auditBrowserBoundary(sql)).applicationScopeClean).toBe(true);

    // An unrelated platform-owned table stays a platform residual, never app scope.
    await sql.unsafe(`
      create table public.sgx_platform_t (id int);
      alter table public.sgx_platform_t owner to supabase_admin;
      grant select on public.sgx_platform_t to anon;`);
    let audit = await auditBrowserBoundary(sql);
    expect(audit.applicationScopeClean).toBe(true);
    expect(audit.platformReachableTables).toEqual([
      { role: "anon", table: "sgx_platform_t", origin: "platform" },
    ]);

    // Drift WITHOUT a browser grant: explicit, fail-closed, no residual mislabel.
    await sql.unsafe("alter table public.decks owner to supabase_admin");
    audit = await auditBrowserBoundary(sql);
    expect(audit.ownershipDrift).toEqual(["decks"]);
    expect(audit.reachableTables).toEqual([]);
    expect(audit.applicationScopeClean).toBe(false);

    // Drift WITH a browser grant (the reviewed reproducer).
    await sql.unsafe("grant select, insert, update, delete on public.decks to anon, authenticated");
    expect(await can("anon", "decks", "SELECT")).toBe(true);
    audit = await auditBrowserBoundary(sql);
    expect(audit.ownershipDrift).toEqual(["decks"]);
    expect(audit.reachableTables).toEqual(
      BROWSER.map((role) => ({ role, table: "decks", origin: "application" })),
    );
    expect(audit.platformReachableTables).toEqual([
      { role: "anon", table: "sgx_platform_t", origin: "platform" },
    ]);
    expect(audit.applicationScopeClean).toBe(false);
    expect(audit.globallyClean).toBe(false);

    // The migration itself still fails closed on that drift and changes nothing.
    const before = await aclSnapshot();
    const rejected = await runFix();
    expect(rejected.code).toBe("42501");
    expect(await aclSnapshot()).toBe(before);

    // Owner remediation restores application scope; the platform table stays residual.
    await sql.unsafe(`
      revoke all on public.decks from anon, authenticated;
      alter table public.decks owner to postgres;`);
    audit = await auditBrowserBoundary(sql);
    expect(audit.ownershipDrift).toEqual([]);
    expect(audit.applicationScopeClean).toBe(true);
    expect(audit.platformResidualPresent).toBe(true);
    expect(audit.globallyClean).toBe(false);
  },
);

/** Runs the real guarded entrypoint (scripts/migrate.ts) as one fixture identity. */
function runEntrypoint(user: string, folder: string) {
  const result = spawnSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", ".bin", "tsx"),
    [join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "migrate.ts")],
    {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        PGHOST: process.env.PGHOST ?? "",
        PGPORT: process.env.PGPORT ?? "",
        // Private socket only (PGHOST), identity via PGUSER; never TCP.
        PGUSER: user,
        DATABASE_URL: `postgresql:///${scratchName}`,
        STARGUIDANCE_MIGRATIONS_DIR: folder,
      },
      encoding: "utf8",
      timeout: 90_000,
    },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

scenario(
  "F2: the guarded migration entrypoint refuses non-postgres identities on every invocation, including after 0029",
  {
    roles: ["sgx_alt", "sgx_setonly"],
    browserNamed: true,
    setup: `create role sgx_alt login inherit; create role sgx_setonly login noinherit;
      grant postgres to sgx_alt with inherit true, set true;
      grant postgres to sgx_setonly with inherit false, set true;`,
  },
  async () => {
    const entries = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
    const synthetic = mkdtempSync(join(tmpdir(), "sg-later-"));
    try {
      // 1. The real folder (revised 0029 pending) through the entrypoint as postgres.
      const first = runEntrypoint("postgres", migrationsDir);
      expect(first.status, first.output).toBe(0);
      const ledgerCount = async () =>
        Number(
          (await sql<{ n: string }[]>`select count(*) as n from drizzle.__drizzle_migrations`)[0]
            ?.n,
        );
      expect(await ledgerCount()).toBe(EXPECTED_MIGRATION_LINEAGE.length);

      // 2. A synthetic LATER migration (test-only temp folder, never added to the repo).
      mkdirSync(join(synthetic, "meta"));
      for (const { tag } of entries.entries as { tag: string }[]) {
        cpSync(join(migrationsDir, `${tag}.sql`), join(synthetic, `${tag}.sql`));
      }
      const last = entries.entries[entries.entries.length - 1];
      const tag = "0030_sgx_synthetic_later";
      entries.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1000, tag });
      writeFileSync(join(synthetic, "meta", "_journal.json"), JSON.stringify(entries));
      writeFileSync(
        join(synthetic, `${tag}.sql`),
        `create table public.sgx_later_t (id serial primary key);--> statement-breakpoint
create function public.sgx_later_fn() returns int language sql as 'select 1';`,
      );

      const objects = async () =>
        (
          await sql<{ t: string | null; f: string | null }[]>`
          select to_regclass('public.sgx_later_t')::text as t,
            to_regprocedure('public.sgx_later_fn()')::text as f`
        )[0];
      const before = {
        acl: await aclSnapshot(),
        members: await memberships(),
        roles: await roleState(),
        ledger: await ledgerCount(),
      };
      expect(await objects()).toEqual({ t: null, f: null });

      // 3. Every unauthorized identity is refused before any change.
      for (const user of ["sgx_alt", "sgx_setonly", "fixtureadmin"]) {
        const refused = runEntrypoint(user, synthetic);
        expect(refused.status, `${user}: ${refused.output}`).toBe(3);
        expect(refused.output, user).toMatch(/Migration refused before any change/);
        expect(refused.output, user).not.toMatch(/postgresql:\/\//);
        expect(await objects(), `${user} objects`).toEqual({ t: null, f: null });
        expect(await ledgerCount(), `${user} ledger`).toBe(before.ledger);
        expect(await aclSnapshot(), `${user} acl`).toBe(before.acl);
        expect(await memberships(), `${user} memberships`).toEqual(before.members);
        expect(await roleState(), `${user} roles`).toBe(before.roles);
      }

      // 4. The direct postgres session applies it: owned by postgres, closed to browsers.
      const allowed = runEntrypoint("postgres", synthetic);
      expect(allowed.status, allowed.output).toBe(0);
      expect(await objects()).toEqual({ t: "sgx_later_t", f: "sgx_later_fn()" });
      expect(await ledgerCount()).toBe(before.ledger + 1);
      await expectFunctionExecution("sgx_later_fn", { browser: false, creator: "postgres" });
      expect(await memberships()).toEqual(before.members);

      // 5. A second invocation with nothing pending is a clean no-op.
      const again = runEntrypoint("postgres", synthetic);
      expect(again.status, again.output).toBe(0);
      expect(await ledgerCount()).toBe(before.ledger + 1);
    } finally {
      rmSync(synthetic, { recursive: true, force: true });
    }
  },
);

scenario(
  "F3: a refused creator identity stops the preflight before its committed DDL probe",
  {
    roles: ["sgx_alt"],
    browserNamed: true,
    setup: `create role sgx_alt login inherit; grant postgres to sgx_alt with inherit true, set true;`,
  },
  async () => {
    // Audit every DDL command the connections below issue.
    await sql.unsafe(`
      create table public.sgx_ddl_log (tag text);
      grant insert on public.sgx_ddl_log to public;
      create function public.sgx_log_ddl() returns event_trigger language plpgsql
        as $$ begin insert into public.sgx_ddl_log values (tg_tag); end $$;
      create event trigger sgx_ddl_audit on ddl_command_start execute function public.sgx_log_ddl();
      truncate public.sgx_ddl_log;`);
    const ddlTags = async () =>
      (await sql<{ tag: string }[]>`select tag from public.sgx_ddl_log order by tag`).map(
        ({ tag }) => tag,
      );
    const collect = async (client: DatabaseClient) => {
      const checks: Array<{ check: string; status: string }> = [];
      const failed = await runConnectedProbes(client, (entry) => {
        checks.push({ check: entry.check, status: entry.status });
        return entry;
      });
      return { failed, checks };
    };

    // Control: the direct postgres session runs the DDL probe, proving the audit sees it.
    const allowed = await collect(pg);
    expect(allowed.failed).toBe(false);
    expect(allowed.checks.map(({ check }) => check)).toContain("Transactional DDL succeeds");
    const probed = await ddlTags();
    expect(probed).toContain("CREATE TABLE");
    expect(probed).toContain("DROP TABLE");
    await sql.unsafe("truncate public.sgx_ddl_log");

    // Refused identities: failed, identity check recorded, no later probe, no DDL at all.
    const alt = connectAs("sgx_alt");
    try {
      for (const [label, client] of [
        ["inheriting login", alt],
        ["fixture superuser", sql],
      ] as const) {
        const refused = await collect(client);
        expect(refused.failed, label).toBe(true);
        expect(
          refused.checks.map(({ check }) => check),
          label,
        ).toEqual(["Connection established", "Connection is the application creator (postgres)"]);
        expect(refused.checks[1]?.status, label).toBe("fail");
        expect(await ddlTags(), `${label} ddl`).toEqual([]);
      }
    } finally {
      await alt.end({ timeout: 5 });
    }
  },
);
