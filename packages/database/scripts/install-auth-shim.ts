import { createDatabaseClient } from "../src/postgres-client";
import { requiredEnv } from "./staging-result";

/**
 * Installs a minimal stand-in for Supabase's `auth.users` table.
 *
 * This exists so continuous integration exercises the real Supabase-shaped
 * migration path on a plain Postgres service: migration 0001 installs the
 * `public.users -> auth.users` foreign key and the synchronisation trigger only
 * when `auth.users` is present, and migration 0002 removes that trigger. Without
 * the shim neither statement would ever run outside the credential-gated staging
 * project, and a regression in either would surface only there.
 *
 * It is deliberately refused against a database that already has an `auth`
 * schema — a real Supabase project must never be reshaped by this script. Only
 * the columns the migrations and the verification suites touch are created.
 */
async function main(): Promise<void> {
  const sql = createDatabaseClient(requiredEnv("DATABASE_URL"));
  try {
    const [existing] = await sql<{ present: boolean }[]>`
      select exists (select 1 from pg_namespace where nspname = 'auth') as present`;
    if (existing?.present) {
      process.stdout.write(
        "An auth schema already exists; refusing to reshape it. No changes were made.\n",
      );
      return;
    }

    const [applied] = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_tables where schemaname = 'drizzle'`;
    if ((applied?.count ?? 0) > 0) {
      throw new Error(
        "Migrations have already been applied; install the auth shim before the first migration.",
      );
    }

    await sql.unsafe(`
      create schema auth;
      create table auth.users (
        id uuid primary key default gen_random_uuid(),
        email text unique,
        created_at timestamptz not null default now()
      );
    `);
    process.stdout.write("Installed the auth.users shim for migration verification.\n");
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

await main();
