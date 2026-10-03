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
  findBrowserFutureObjectAccess,
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
const TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN";

const scratchName = `sg_access_${randomBytes(4).toString("hex")}`;
let admin: DatabaseClient;
let sql: DatabaseClient;
let scratchUrl = "";
let workDir = "";
const privateBefore = new Map<string, string>();
let scenarioRoles: string[] = [];

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

async function runFix(role?: string): Promise<{ code: string; message: string }> {
  const statements = readFileSync(join(migrationsDir, `${FIX}.sql`), "utf8").split(
    "--> statement-breakpoint",
  );
  let message = "";
  const code = await sqlCode(async () => {
    await sql.begin(async (tx) => {
      if (role) await tx.unsafe(`set local role ${role}`);
      try {
        for (const statement of statements) await tx.unsafe(statement);
      } catch (error) {
        message = (error as Error).message;
        throw error;
      }
    });
  });
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

scenario(
  "schema-level PUBLIC function defaults are remediated for both creators",
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
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
    expect(await findBrowserDefaultAcls(sql)).toEqual([]);
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "after");
      await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator });
    }
  },
);

scenario(
  "a default inherited through a browser-role group is rejected, then fixed by the owner",
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
      scope: "global",
      objectType: "function",
      grantee: "sgx_group",
    });

    const before = await aclSnapshot();
    const rejected = await runFix();
    expect(rejected.code).toBe("55000");
    expect(rejected.message).toMatch(/inherits the default privileges.*sgx_group/);
    expect(await aclSnapshot()).toBe(before);

    // Owner action: withdraw the group default; the group and memberships stay.
    for (const creator of CREATORS) {
      await sql.unsafe(
        `alter default privileges for role ${creator} revoke execute on functions from sgx_group`,
      );
    }
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    const [membership] = await sql<{ ok: boolean }[]>`
      select pg_has_role('anon', 'sgx_group', 'USAGE') and pg_has_role('authenticated', 'sgx_group', 'USAGE') as ok`;
    expect(membership?.ok).toBe(true);
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "after");
      await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator });
    }
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
  },
);

scenario(
  "an extra creator found only through global table defaults stays in scope",
  {
    roles: ["sgx_tables"],
    setup: `${createCreators("sgx_tables")}
      alter default privileges for role sgx_tables grant select on tables to anon;`,
  },
  async () => {
    expect(await findBrowserDefaultAcls(sql)).toContainEqual({
      creator: "sgx_tables",
      scope: "global",
      objectType: "table",
      grantee: "anon",
    });
    const early = await createFutureObjects("sgx_tables", "before");
    await expectFunctionExecution(`${early.table}_fn`, { browser: true });
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    // A durable global function row keeps the creator visible to later audits.
    const [row] = await sql<{ n: string }[]>`
      select count(*)::text as n from pg_default_acl
      where defaclrole = 'sgx_tables'::regrole and defaclobjtype = 'f' and defaclnamespace = 0`;
    expect(row?.n).toBe("1");
    const future = await createFutureObjects("sgx_tables", "after");
    await expectFunctionExecution(`${future.table}_fn`, {
      browser: false,
      creator: "sgx_tables",
      service: false,
    });
    for (const role of BROWSER) expect(await can(role, future.table)).toBe(false);
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
  },
);

scenario(
  "an extra creator with schema function defaults naming anon and service_role is fixed",
  {
    roles: ["sgx_funcs"],
    setup: `${createCreators("sgx_funcs")}
      alter default privileges for role sgx_funcs in schema public grant execute on functions to anon, service_role;`,
  },
  async () => {
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    const future = await createFutureObjects("sgx_funcs", "after");
    // service_role keeps its explicit schema default.
    await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator: "sgx_funcs" });
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
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
  "extra creators discovered from every object kind and scope are covered",
  {
    roles: MATRIX.map(({ role }) => role),
    setup: `${createCreators(...MATRIX.map(({ role }) => role))}
      ${MATRIX.map(
        ({ kind, scope, role }) =>
          `alter default privileges for role ${role} ${scope === "public" ? "in schema public" : ""} grant all on ${kind} to anon, authenticated, service_role;`,
      ).join("\n")}`,
  },
  async () => {
    const reached = await findBrowserFutureObjectAccess(sql);
    for (const { role } of MATRIX) {
      expect(reached.filter((row) => row.creator === role).length, role).toBeGreaterThan(0);
    }
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
    expect(await findBrowserDefaultAcls(sql)).toEqual([]);
    for (const { kind, role } of MATRIX) {
      const future = await createFutureObjects(role, "after");
      for (const browser of BROWSER) {
        expect(await can(browser, future.table), `${browser} ${role} table`).toBe(false);
        const [seq] = await sql<{ ok: boolean }[]>`
          select has_sequence_privilege(${browser}, ${`public.${future.sequence}`},
            'USAGE, SELECT, UPDATE') as ok`;
        expect(seq?.ok, `${browser} ${role} sequence`).toBe(false);
      }
      // Explicit service_role defaults are preserved for exactly the granted kind.
      expect(
        await can("service_role", future.table, "SELECT, INSERT"),
        `${role} service table`,
      ).toBe(kind === "tables");
      const [serviceSeq] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege('service_role', ${`public.${future.sequence}`}, 'USAGE') as ok`;
      expect(serviceSeq?.ok, `${role} service sequence`).toBe(kind === "sequences");
      await expectFunctionExecution(`${future.table}_fn`, {
        browser: false,
        creator: role,
        service: kind === "functions",
      });
      if (kind !== "functions") {
        expect(await probe("service_role", `select public.${future.table}_fn()`)).toBe("42501");
      }
    }
  },
);

scenario(
  "executor authority is proven by execution, not by SET membership",
  {
    roles: ["sgx_set_exec", "sgx_owner_exec", "sgx_table_owner"],
    setup: `create role sgx_set_exec nologin;
      create role sgx_owner_exec nologin;
      create role sgx_table_owner nologin;
      grant postgres, supabase_admin to sgx_set_exec with inherit false, set true;
      grant postgres, supabase_admin to sgx_owner_exec with inherit true, set true;`,
  },
  async () => {
    const [authority] = await sql<{ set: boolean; usage: boolean }[]>`
      select pg_has_role('sgx_set_exec', 'postgres', 'SET') and pg_has_role('sgx_set_exec', 'supabase_admin', 'SET') as set,
        pg_has_role('sgx_set_exec', 'postgres', 'USAGE') or pg_has_role('sgx_set_exec', 'supabase_admin', 'USAGE') as usage`;
    expect(authority).toEqual({ set: true, usage: false });
    const before = await aclSnapshot();
    const defaultsBefore = await aclSnapshot(true);

    // SET-only membership passes pg_has_role(..., 'SET') yet cannot alter defaults.
    const setOnly = await runFix("sgx_set_exec");
    expect(setOnly.code).toBe("42501");
    expect(setOnly.message).toMatch(
      /cannot change default privileges created by role "(postgres|supabase_admin)"/,
    );
    expect(await aclSnapshot()).toBe(before);

    // Creator authority without authority over the targeted tables: the trial
    // pass rejects it after the default ACL statements already succeeded in it.
    const tables = BROWSER_WITHHELD_TABLES.map((table) => `public.${table}`);
    for (const table of tables) await sql.unsafe(`alter table ${table} owner to sgx_table_owner`);
    const ownership = await runFix("sgx_owner_exec");
    expect(ownership.code).toBe("42501");
    expect(ownership.message).toMatch(/cannot change access to table public\./);
    // The default ACLs it changed in the trial pass were rolled back.
    expect(await aclSnapshot(true)).toBe(defaultsBefore);
    for (const table of tables) await sql.unsafe(`alter table ${table} owner to postgres`);

    // Positive: a non-superuser executor with inherited creator privileges succeeds.
    const [executor] = await sql<{ ok: boolean }[]>`
      select not rolsuper and not rolcreaterole and not rolbypassrls as ok from pg_roles where rolname = 'sgx_owner_exec'`;
    expect(executor?.ok).toBe(true);
    expect(await runFix("sgx_owner_exec")).toEqual({ code: "ok", message: "" });
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([]);
  },
);

const ownerAclRoles = ["sgx_w_exec", "sgx_w_owner", "sgx_s_exec", "sgx_grantor"];

scenario(
  "REVOKE that only warns (SELECT without grant option on every target) is rejected atomically",
  {
    roles: ownerAclRoles,
    browserNamed: true,
    setup: `create role sgx_w_exec nologin; create role sgx_w_owner nologin;
      grant postgres, supabase_admin to sgx_w_exec with inherit true, set true;`,
  },
  async () => {
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`alter table public.${table} owner to sgx_w_owner`);
      await sql.unsafe(`grant select on public.${table} to sgx_w_exec`);
    }
    // The warning is a real no-op: browser access survives the executor's REVOKE.
    const survives = await asRole("sgx_w_exec", async (tx) => {
      await tx.unsafe("revoke all on table public.decks from anon");
      const [row] = await tx<{ ok: boolean }[]>`
        select has_table_privilege('anon', 'public.decks', 'UPDATE') as ok`;
      return row?.ok;
    });
    expect(survives).toBe(true);

    const before = await aclSnapshot();
    const rejected = await runFix("sgx_w_exec");
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to table public\.\w+: REVOKE left/);
    expect(await aclSnapshot()).toBe(before);
    expect(await can("anon", "decks", "UPDATE")).toBe(true);
  },
);

scenario(
  "a sequence grant by another grantor survives REVOKE and is rejected atomically",
  {
    roles: ownerAclRoles,
    browserNamed: true,
    setup: `create role sgx_s_exec nologin; create role sgx_grantor nologin;
      grant usage on schema public to sgx_grantor;
      grant postgres, supabase_admin to sgx_s_exec with inherit true, set true;`,
  },
  async () => {
    // The ten tables carry no serial column, so own a synthetic sequence by one.
    // The browser roles receive USAGE from the creator default, as on a real one.
    await sql.unsafe("create sequence public.sgx_seq owned by public.decks.id");
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
    const rejected = await runFix("sgx_s_exec");
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to sequence .*REVOKE left/);
    expect(await aclSnapshot()).toBe(before);

    // Owner action: withdraw the other grantor's grant chain, then it succeeds.
    await sql.unsafe(`revoke usage on sequence ${name} from sgx_grantor cascade`);
    expect(await runFix("sgx_s_exec")).toEqual({ code: "ok", message: "" });
    for (const role of BROWSER) {
      const [row] = await sql<{ ok: boolean }[]>`
        select has_sequence_privilege(${role}, ${name}, 'USAGE, SELECT, UPDATE') as ok`;
      expect(row?.ok, `${role} ${name}`).toBe(false);
    }
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
  },
);

for (const scope of ["", "in schema public"] as const) {
  const tag = scope ? "public" : "global";
  const group = `sgx_grp_${tag}`;
  scenario(
    `defaults inherited through a browser group (${tag} scope) are rejected for every object kind`,
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
          expect(acls).toContainEqual({ creator, scope: tag, objectType, grantee: group });
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

      for (const creator of CREATORS) {
        await sql.unsafe(`
          alter default privileges for role ${creator} ${scope} revoke all on tables from ${group};
          alter default privileges for role ${creator} ${scope} revoke all on sequences from ${group};
          alter default privileges for role ${creator} ${scope} revoke all on functions from ${group};`);
      }
      expect(await runFix()).toEqual({ code: "ok", message: "" });
      expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
      for (const creator of CREATORS) {
        const future = await createFutureObjects(creator, "after");
        for (const role of BROWSER) expect(await can(role, future.table)).toBe(false);
        await expectFunctionExecution(`${future.table}_fn`, { browser: false, creator });
      }
    },
  );
}

scenario(
  "a direct PG17 MAINTAIN grant is detected, rejected on warning-only REVOKE, and removed by an owner",
  {
    roles: ["sgx_m_exec", "sgx_m_owner"],
    browserNamed: true,
    setup: `create role sgx_m_exec nologin; create role sgx_m_owner nologin;
      grant postgres, supabase_admin to sgx_m_exec with inherit true, set true;`,
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

    // Partial authority: owned by another role, executor holds only SELECT.
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`alter table public.${table} owner to sgx_m_owner`);
      await sql.unsafe(`grant select on public.${table} to sgx_m_exec`);
    }
    const before = await aclSnapshot();
    const rejected = await runFix("sgx_m_exec");
    expect(rejected.code).toBe("42501");
    expect(rejected.message).toMatch(/cannot change access to table public\.\w+: REVOKE left/);
    expect(await aclSnapshot()).toBe(before);
    expect(await can("anon", "decks", "MAINTAIN")).toBe(true);

    // Valid owner-equivalent executor succeeds and MAINTAIN is gone.
    for (const table of BROWSER_WITHHELD_TABLES) {
      await sql.unsafe(`alter table public.${table} owner to postgres`);
    }
    expect(await runFix("sgx_m_exec")).toEqual({ code: "ok", message: "" });
    for (const table of BROWSER_WITHHELD_TABLES) {
      for (const role of BROWSER) {
        expect(await can(role, table, "MAINTAIN"), `${role} ${table}`).toBe(false);
      }
    }
    expect(await findBrowserReachableUnforcedTables(sql)).toEqual([]);
  },
);

scenario(
  "schema-level PUBLIC table and sequence defaults are remediated",
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
        expect(acls).toContainEqual({ creator, scope: "public", objectType, grantee: "PUBLIC" });
      }
      const future = await createFutureObjects(creator, "before");
      expect(await can("anon", future.table, "SELECT")).toBe(true);
    }
    expect(await runFix()).toEqual({ code: "ok", message: "" });
    expect(await findBrowserFutureObjectAccess(sql)).toEqual([]);
    for (const creator of CREATORS) {
      const future = await createFutureObjects(creator, "after");
      for (const role of BROWSER) {
        expect(await can(role, future.table)).toBe(false);
        const [seq] = await sql<{ ok: boolean }[]>`
          select has_sequence_privilege(${role}, ${`public.${future.sequence}`}, 'USAGE, SELECT') as ok`;
        expect(seq?.ok).toBe(false);
      }
    }
  },
);
