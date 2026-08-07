import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXPECTED_MIGRATIONS } from "../src/migration-manifest";

/**
 * Guards the migration history itself.
 *
 * Applied migrations are immutable: editing 0000 or 0001 would silently diverge
 * every database that already ran them, because Drizzle records only a hash of
 * the file it applied and never re-applies it. The digests below therefore pin
 * the applied history, and the trigger assertions make sure no future migration
 * quietly reintroduces the auth.users synchronisation trigger that migration
 * 0002 removed.
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

interface JournalEntry {
  idx: number;
  tag: string;
}

function read(tag: string): string {
  return readFileSync(join(migrationsDir, `${tag}.sql`), "utf8");
}

function digest(tag: string): string {
  return createHash("sha256").update(read(tag), "utf8").digest("hex");
}

/**
 * Strips SQL comments so the escalation scan reads executable statements only.
 * Migration 0002's header names the constructs it deliberately avoids, and that
 * prose must not be mistaken for the constructs themselves.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function executableSql(tag: string): string {
  return stripComments(read(tag));
}

const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
};

/**
 * Pinned digests of the migrations that have already been applied to the
 * staging database. A failure here means an applied migration was edited, which
 * is never a valid correction — add a new migration instead.
 */
const IMMUTABLE_DIGESTS: Readonly<Record<string, string>> = {
  "0000_busy_centennial": "fea39ca2ff2c3ccbf425adeaea261de6c9a05eeed7cf16665516da03630871cb",
  "0001_supabase_staging": "c3d16aaa2337cde908ec42da0c73ef3287d3cb3cf83c78822d64972cca678727",
  "0002_remove_auth_user_sync_trigger":
    "f5148ce8cdaaacaede22250f916b0fd9c2c18e116da147adea6398d160452f32",
  "0003_webhook_replay_lease": "ba0cfa16d9a3256e98c43d2a62b6b5e6cad5bcae328ccec0a61f45088f62b9f9",
  "0004_server_actor_role": "32dd231cbe55ef316ef71896b1fc9f11af1772c4fdc0722cd58efc3b2fa76aad",
  "0005_bumpy_moon_knight": "e63e5b2af79a8b635292feffe0441a18f22a28fa4700dc1bc58d010a6fc4b794",
  "0006_rate_limit_buckets": "c4f29725cc7ba2e54f77a24b585e4cb8e596262cbe03b184b7f8dfbe635141c8",
  "0007_interpretation_jobs": "ca141a5257796e0e3c23caba1413cf8bb606fcb499eb39c5d94655c5831e4bee",
  "0008_interpretation_jobs_subject_rls":
    "d5aecc953a81ec0a4a42b4876593248969144d53f3099ccdcc89f5a413340557",
};

describe("migration history", () => {
  it("keeps every applied migration byte-identical", () => {
    for (const [tag, expected] of Object.entries(IMMUTABLE_DIGESTS)) {
      expect(digest(tag), `${tag}.sql was edited after it was applied`).toBe(expected);
    }
  });

  it("orders the corrective migration after the migration that created the trigger", () => {
    const tags = journal.entries.sort((a, b) => a.idx - b.idx).map(({ tag }) => tag);
    expect(tags).toEqual(EXPECTED_MIGRATIONS);
    expect(Object.keys(IMMUTABLE_DIGESTS)).toEqual(EXPECTED_MIGRATIONS);
  });

  it("never recreates the auth.users synchronisation trigger after 0002", () => {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const correctiveIndex = files.indexOf("0002_remove_auth_user_sync_trigger.sql");
    expect(correctiveIndex, "the corrective migration must exist").toBeGreaterThanOrEqual(0);

    for (const file of files.slice(correctiveIndex + 1)) {
      const sql = stripComments(readFileSync(join(migrationsDir, file), "utf8"));
      expect(sql, `${file} must not recreate the trigger`).not.toMatch(
        /create\s+(or\s+replace\s+)?trigger\s+sync_authenticated_user_after_insert/i,
      );
      expect(sql, `${file} must not recreate the sync function`).not.toMatch(
        /create\s+(or\s+replace\s+)?function\s+public\.sync_authenticated_user/i,
      );
    }
  });

  it("removes both the trigger and the function in the corrective migration", () => {
    const sql = executableSql("0002_remove_auth_user_sync_trigger");
    expect(sql).toMatch(
      /drop\s+trigger\s+if\s+exists\s+sync_authenticated_user_after_insert\s+on\s+auth\.users/i,
    );
    expect(sql).toMatch(/drop\s+function\s+if\s+exists\s+public\.sync_authenticated_user\(\)/i);
  });

  it("introduces no privilege escalation in the corrective migration", () => {
    const sql = executableSql("0002_remove_auth_user_sync_trigger");
    const forbidden: Array<[RegExp, string]> = [
      [/\bbypassrls\b/i, "a BYPASSRLS role"],
      [/disable\s+row\s+level\s+security/i, "disabling row level security"],
      [/\bsecurity\s+definer\b/i, "a SECURITY DEFINER function"],
      [/create\s+policy/i, "a new policy"],
      [/\bto\s+service_role\b/i, "a service-role grant"],
      [/drop\s+policy/i, "dropping a policy"],
      [/\brevoke\b/i, "revoking an existing grant"],
    ];
    for (const [pattern, description] of forbidden) {
      expect(sql, `migration 0002 must not introduce ${description}`).not.toMatch(pattern);
    }
  });

  it("keeps the server actor non-login, non-inheriting, and subject-scoped", () => {
    const sql = executableSql("0004_server_actor_role");
    expect(sql).toMatch(/create\s+role\s+starguidance_app\s+nologin/i);
    expect(sql).toMatch(/noinherit/i);
    expect(sql).toMatch(/nobypassrls/i);
    expect(sql).toMatch(/revoke\s+all[\s\S]*from\s+public,\s*authenticated/i);
    expect(sql).not.toMatch(/\bbypassrls\b(?!\s*\))/i);
    expect(sql).not.toMatch(/security\s+definer/i);
  });

  it("scrubs legacy plaintext profile metadata and enforces retry-safe cardinality", () => {
    const sql = executableSql("0005_bumpy_moon_knight");
    expect(sql).toMatch(/derived_payload"\s*=\s*"derived_payload"\s*-\s*'metadata'/i);
    expect(sql).toMatch(/set\s+"idempotency_key"\s*=\s*"id"::text/i);
    expect(sql).toMatch(/birth_profiles_user_unique/i);
    expect(sql).toMatch(/follow_up_questions_reading_unique/i);
    expect(sql).toMatch(/reading_sessions_user_idempotency_unique/i);
  });

  it("keeps rate_limit_buckets forced-RLS and reachable only by starguidance_app", () => {
    const sql = executableSql("0006_rate_limit_buckets");
    expect(sql).toMatch(/alter\s+table\s+"rate_limit_buckets"\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+"rate_limit_buckets"\s+force\s+row\s+level\s+security/i);
    expect(sql).toMatch(/create\s+policy[\s\S]*on\s+"rate_limit_buckets"/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"rate_limit_buckets"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).toMatch(/grant[\s\S]*on\s+table\s+"rate_limit_buckets"\s+to\s+starguidance_app/i);
    expect(sql).not.toMatch(/\bbypassrls\b/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bto\s+(anon|service_role)\b/i);
  });

  it("keeps interpretation_jobs forced-RLS and reachable only by starguidance_app", () => {
    const sql = executableSql("0007_interpretation_jobs");
    expect(sql).toMatch(/alter\s+table\s+"interpretation_jobs"\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+"interpretation_jobs"\s+force\s+row\s+level\s+security/i);
    expect(sql).toMatch(/create\s+policy[\s\S]*on\s+"interpretation_jobs"/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"interpretation_jobs"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).not.toMatch(/\bbypassrls\b/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bto\s+(anon|service_role)\b/i);
    // Unlike payment_webhook_events (migration 0004), starguidance_app
    // deliberately keeps INSERT here too: POST /api/readings enqueues a job in
    // the same actor-bound transaction as the reading it belongs to (see this
    // migration's own inline comment).
    expect(sql).toMatch(
      /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+"interpretation_jobs"\s+to\s+starguidance_app/i,
    );
  });

  it("subject-binds the interpretation_jobs actor policy and names the system path (0008)", () => {
    const sql = executableSql("0008_interpretation_jobs_subject_rls");
    expect(sql).toMatch(/drop\s+policy\s+"interpretation_jobs_app_only"/i);
    // The request path: scoped to the app role and bound to the verified
    // subject in both directions (visibility and new rows).
    expect(sql).toMatch(
      /create\s+policy\s+"interpretation_jobs_subject"[\s\S]*to\s+starguidance_app[\s\S]*using\s*\("user_id"\s*=\s*nullif\(current_setting\('request\.jwt\.claim\.sub',\s*true\),\s*''\)::uuid\)[\s\S]*with\s+check\s*\("user_id"\s*=\s*nullif\(current_setting\('request\.jwt\.claim\.sub',\s*true\),\s*''\)::uuid\)/i,
    );
    // The claim path: an explicit policy for the owning connection role, so
    // cross-user maintenance is a named, reviewable grant rather than the
    // absence of RLS (contrast payment_webhook_events).
    expect(sql).toMatch(
      /create\s+policy\s+"interpretation_jobs_system"[\s\S]*to\s+current_user[\s\S]*using\s*\(true\)/i,
    );
    // No RLS weakening while re-cutting the policies.
    expect(sql).not.toMatch(/no\s+force\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/\bbypassrls\b/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bto\s+(anon|service_role|public|authenticated)\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });
});
